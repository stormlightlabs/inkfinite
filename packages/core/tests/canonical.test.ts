import { describe, expect, it } from 'vitest';
import { createEditorReconciliationRequest, toCanonicalDocumentSnapshot } from '../src/persistence/canonical';
import { LayerRecord, PageRecord, ShapeRecord, type Document, type PathProps } from '../src/model';

describe('toCanonicalDocumentSnapshot', () => {
	it('projects browser shapes into the canonical renderer input', () => {
		const page = PageRecord.create('Page 1', 'page:one');
		const rect = ShapeRecord.createRect(
			page.id,
			10,
			20,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 4 },
			'shape:rect'
		);
		page.shapeIds.push(rect.id);

		const snapshot = toCanonicalDocumentSnapshot(
			{
				board: { id: 'board:one', name: 'Board', createdAt: 0, updatedAt: 0 },
				doc: { pages: { [page.id]: page }, shapes: { [rect.id]: rect }, bindings: {} },
				order: { pageIds: [page.id] }
			},
			{ documentId: 'document:one' }
		);

		expect(snapshot.format).toBe('inkfinite.document');
		expect(snapshot.document.page_ids).toEqual(['page:one']);
		expect(snapshot.document.layers['layer:page:one:default'].shape_ids).toEqual(['shape:rect']);
		expect(snapshot.document.shapes['shape:rect']).toMatchObject({
			kind: 'rect',
			parent: { kind: 'layer', id: 'layer:page:one:default' },
			transform: { translation: { x: 10, y: 20 }, rotation: 0 },
			properties: { w: 40, h: 20, fill: 'red' }
		});
	});

	it('turns editor moves into semantic Rust reconciliation patches', () => {
		const page = PageRecord.create('Page 1', 'page:one');
		const rect = ShapeRecord.createRect(
			page.id,
			10,
			20,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 4 },
			'shape:rect'
		);
		page.shapeIds.push(rect.id);
		const before: Document = { pages: { [page.id]: page }, shapes: { [rect.id]: rect }, bindings: {} };
		const after: Document = { ...before, shapes: { [rect.id]: { ...rect, x: 30, y: 45 } } };

		const request = createEditorReconciliationRequest(before, after, {
			actor_id: 'browser',
			origin: 'human',
			transaction_id: 'transaction:test',
			description: 'Move rectangle',
			timestamp: 1
		});

		expect(request.patches).toHaveLength(1);
		expect(request.patches[0]).toMatchObject({
			type: 'shape',
			shape_id: 'shape:rect',
			transform: { e: 30, f: 45 }
		});
	});

	it('routes topology edits as canonical path patches', () => {
		const page = PageRecord.create('Page 1', 'page:one');
		const props: PathProps = {
			subpaths: [
				{
					segments: [
						{ type: 'move', to: { x: 0, y: 0 } },
						{ type: 'line', to: { x: 40, y: 0 } },
						{ type: 'line', to: { x: 40, y: 40 } }
					],
					closed: false
				}
			],
			fill_rule: 'nonzero',
			fill: '#fff'
		};
		const path = ShapeRecord.createPath(page.id, 0, 0, props, 'shape:path');
		page.shapeIds.push(path.id);
		const before: Document = { pages: { [page.id]: page }, shapes: { [path.id]: path }, bindings: {} };
		const after: Document = {
			...before,
			shapes: {
				[path.id]: {
					...path,
					props: {
						...path.props,
						subpaths: [
							{
								...path.props.subpaths[0],
								segments: [...path.props.subpaths[0].segments, { type: 'line', to: { x: 0, y: 40 } }]
							}
						]
					}
				}
			}
		};

		const request = createEditorReconciliationRequest(before, after, {
			actor_id: 'browser',
			origin: 'human',
			transaction_id: 'transaction:topology',
			description: 'Add path anchor',
			timestamp: 1,
			topologyEdits: [
				{ shapeId: path.id, operations: [{ type: 'add_anchor', subpath_index: 0, segment_index: 1, t: 0.5 }] }
			]
		});

		expect(request.patches).toHaveLength(1);
		expect(request.patches[0]).toMatchObject({
			type: 'path_topology',
			shape_id: path.id,
			operations: [{ type: 'add_anchor', segment_index: 1 }]
		});
	});

	it('reconciles page and layer structure as semantic patches', () => {
		const page = PageRecord.create('Page 1', 'page:one');
		const back = LayerRecord.create(page.id, 'Back', 'layer:back');
		page.layerIds = [back.id];
		const front = LayerRecord.create(page.id, 'Front', 'layer:front');
		const nextPage = PageRecord.create('Page 2', 'page:two');
		const nextLayer = LayerRecord.create(nextPage.id, 'Default', 'layer:two');
		const before: Document = { pages: { [page.id]: page }, layers: { [back.id]: back }, shapes: {}, bindings: {} };
		const after: Document = {
			pages: {
				[page.id]: { ...page, layerIds: [front.id, back.id] },
				[nextPage.id]: { ...nextPage, layerIds: [nextLayer.id] }
			},
			layers: { [front.id]: front, [back.id]: { ...back, name: 'Renamed back' }, [nextLayer.id]: nextLayer },
			shapes: {},
			bindings: {}
		};

		const request = createEditorReconciliationRequest(before, after, {
			actor_id: 'browser',
			origin: 'human',
			transaction_id: 'transaction:structure',
			description: 'Update structure',
			timestamp: 1
		});

		expect(request.patches.map((patch) => patch.type)).toEqual([
			'create_page',
			'create_layer',
			'create_layer',
			'patch_layer',
			'reorder_layer'
		]);
		expect(request.patches).toContainEqual(
			expect.objectContaining({ type: 'create_page', page: expect.objectContaining({ id: 'page:two' }) })
		);
		expect(request.patches).toContainEqual(
			expect.objectContaining({ type: 'reorder_layer', layer_id: 'layer:back' })
		);
	});

	it('reconciles a layer deletion with a native move disposition', () => {
		const page = PageRecord.create('Page 1', 'page:one');
		const source = LayerRecord.create(page.id, 'Source', 'layer:source');
		const destination = LayerRecord.create(page.id, 'Destination', 'layer:destination');
		const shape = ShapeRecord.createRect(
			page.id,
			10,
			20,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 4 },
			'shape:moved'
		);
		shape.layerId = source.id;
		page.layerIds = [source.id, destination.id];
		page.shapeIds = [shape.id];
		source.shapeIds = [shape.id];
		const before: Document = {
			pages: { [page.id]: page },
			layers: { [source.id]: source, [destination.id]: destination },
			shapes: { [shape.id]: shape },
			bindings: {}
		};
		const after: Document = {
			pages: { [page.id]: { ...page, layerIds: [destination.id], shapeIds: [shape.id] } },
			layers: { [destination.id]: { ...destination, shapeIds: [shape.id] } },
			shapes: { [shape.id]: { ...shape, layerId: destination.id } },
			bindings: {}
		};

		const request = createEditorReconciliationRequest(before, after, {
			actor_id: 'browser',
			origin: 'human',
			transaction_id: 'transaction:move-layer',
			description: 'Delete source layer',
			timestamp: 1
		});

		expect(request.patches).toContainEqual(
			expect.objectContaining({ type: 'reorder_layer', layer_id: destination.id })
		);
		expect(request.patches).toContainEqual(
			expect.objectContaining({
				type: 'delete_layer',
				layer_id: source.id,
				contents: { kind: 'move_to', destination_layer_id: destination.id }
			})
		);
	});
});
