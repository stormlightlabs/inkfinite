import { describe, expect, it } from 'vitest';
import {
	createEditorReconciliationRequest,
	fromCanonicalDocumentSnapshot,
	toCanonicalDocumentSnapshot
} from '../src/persistence/canonical';
import { contentObjectToCard } from '../src/cards';
import { EditorBindingRecord, EditorLayerRecord, EditorPageRecord, EditorShapeRecord, type EditorDocument, type PathProps } from '../src/editor-model';

describe('toCanonicalDocumentSnapshot', () => {
	it('projects browser shapes into the canonical renderer input', () => {
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const rect = EditorShapeRecord.createRect(
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
			properties: { w: 40, h: 20, fill: 'red' },
			metadata: { agent_editable: true }
		});
	});

	it('round-trips native clip paths and filters through the canonical projection', () => {
		const page = EditorPageRecord.create('Page 1', 'page:effects');
		const rect = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 80, h: 60, fill: 'red', stroke: 'none', radius: 0 },
			'shape:effects'
		);
		rect.props.clipPath = {
			subpaths: [
				{
					segments: [
						{ type: 'move', to: { x: 0, y: 0 } },
						{ type: 'line', to: { x: 80, y: 0 } },
						{ type: 'line', to: { x: 40, y: 60 } }
					],
					closed: true
				}
			],
			fill_rule: 'nonzero'
		};
		rect.props.filter = { primitives: [{ type: 'blur', radius: 2 }] };
		page.shapeIds.push(rect.id);
		const snapshot = toCanonicalDocumentSnapshot(
			{ pages: { [page.id]: page }, shapes: { [rect.id]: rect }, bindings: {} },
			{ documentId: 'document:effects' }
		);
		expect(snapshot.document.shapes[rect.id]?.properties).toMatchObject({
			clip_path: rect.props.clipPath,
			filter: rect.props.filter
		});
		const roundTripped = fromCanonicalDocumentSnapshot(snapshot);
		expect(roundTripped.shapes[rect.id]?.props).toMatchObject({
			clipPath: rect.props.clipPath,
			filter: rect.props.filter
		});
	});

	it('round-trips typed relationships through the native projection', () => {
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const source = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 0 },
			'shape:source'
		);
		const target = EditorShapeRecord.createRect(
			page.id,
			100,
			0,
			{ w: 40, h: 20, fill: 'blue', stroke: 'none', radius: 0 },
			'shape:target'
		);
		page.shapeIds = [source.id, target.id];
		const relation = EditorBindingRecord.createRelation(source.id, target.id, 'depends_on', 'binding:depends-on');
		const document: EditorDocument = {
			pages: { [page.id]: page },
			shapes: { [source.id]: source, [target.id]: target },
			bindings: { [relation.id]: relation }
		};

		const snapshot = toCanonicalDocumentSnapshot(document, { documentId: 'document:relation' });
		expect(snapshot.document.bindings[relation.id]).toMatchObject({
			kind: 'relation',
			relation_type: 'depends_on',
			source_shape_id: source.id,
			target_shape_id: target.id
		});

		const roundTripped = fromCanonicalDocumentSnapshot(snapshot);
		expect(roundTripped.bindings[relation.id]).toMatchObject(relation);
	});

	it('persists card metadata and child ordering in the native container', () => {
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const cardShapes = contentObjectToCard(
			'page:one',
			{ x: 10, y: 20 },
			{
				title: 'Research note',
				body: 'Read the source',
				role: 'research.note',
				tags: ['source'],
				source: 'paper.pdf',
				link: 'https://example.com',
				customMetadata: { priority: 1 }
			}
		);
		page.shapeIds = cardShapes.map((shape) => shape.id);
		const snapshot = toCanonicalDocumentSnapshot(
			{
				pages: { [page.id]: page },
				shapes: Object.fromEntries(cardShapes.map((shape) => [shape.id, shape])),
				bindings: {}
			},
			{ documentId: 'document:card' }
		);
		const container = snapshot.document.shapes[cardShapes[0].id];
		expect(container.child_ids).toEqual(cardShapes.slice(1).map((shape) => shape.id));
		expect(container.metadata).toMatchObject({
			title: 'Research note',
			body: 'Read the source',
			role: 'research.note',
			tags: ['source'],
			source: 'paper.pdf',
			link: 'https://example.com',
			custom_metadata: { priority: 1 }
		});
	});

	it('preserves object metadata in canonical projection and patches', () => {
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const rect = EditorShapeRecord.createRect(
			page.id,
			10,
			20,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 4 },
			'shape:rect'
		);
		rect.metadata = {
			name: 'Gateway',
			title: null,
			role: 'architecture.service',
			description: 'Routes requests',
			body: null,
			tags: ['api'],
			source: 'architecture.md',
			link: null,
			customMetadata: { owner: 'platform' },
			locked: false,
			agentEditable: true,
			provenance: { actorId: 'actor:test', origin: 'human', timestamp: 42, source: 'seed' }
		};
		page.shapeIds.push(rect.id);
		const before: EditorDocument = { pages: { [page.id]: page }, shapes: { [rect.id]: rect }, bindings: {} };
		const snapshot = toCanonicalDocumentSnapshot(before, { documentId: 'document:metadata' });
		expect(snapshot.document.shapes[rect.id]?.metadata).toMatchObject({
			name: 'Gateway',
			role: 'architecture.service',
			description: 'Routes requests',
			tags: ['api'],
			source: 'architecture.md',
			custom_metadata: { owner: 'platform' },
			provenance: { actor_id: 'actor:test', source: 'seed' }
		});

		const after: EditorDocument = {
			...before,
			shapes: {
				[rect.id]: {
					...rect,
					metadata: { ...rect.metadata, role: 'architecture.gateway', tags: ['api', 'edge'] }
				}
			}
		};
		const request = createEditorReconciliationRequest(before, after, {
			actor_id: 'browser',
			origin: 'human',
			transaction_id: 'transaction:metadata',
			description: 'Update object metadata',
			timestamp: 1
		});
		expect(request.patches).toEqual([
			expect.objectContaining({
				type: 'shape',
				shape_id: rect.id,
				metadata: expect.objectContaining({
					role: 'architecture.gateway',
					tags: ['api', 'edge'],
					custom_metadata: { owner: 'platform' }
				})
			})
		]);
	});

	it('turns editor moves into semantic Rust reconciliation patches', () => {
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const rect = EditorShapeRecord.createRect(
			page.id,
			10,
			20,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 4 },
			'shape:rect'
		);
		page.shapeIds.push(rect.id);
		const before: EditorDocument = { pages: { [page.id]: page }, shapes: { [rect.id]: rect }, bindings: {} };
		const after: EditorDocument = { ...before, shapes: { [rect.id]: { ...rect, x: 30, y: 45 } } };

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

	it('turns a shape kind change into a native conversion patch', () => {
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const rect = EditorShapeRecord.createRect(
			page.id,
			10,
			20,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 4 },
			'shape:rect'
		);
		page.shapeIds.push(rect.id);
		const before: EditorDocument = { pages: { [page.id]: page }, shapes: { [rect.id]: rect }, bindings: {} };
		const after: EditorDocument = {
			...before,
			shapes: { [rect.id]: { ...rect, type: 'ellipse', props: { w: 40, h: 20, fill: 'red', stroke: 'none' } } }
		};

		const request = createEditorReconciliationRequest(before, after, {
			actor_id: 'browser',
			origin: 'human',
			transaction_id: 'transaction:convert',
			description: 'Convert rectangle',
			timestamp: 1
		});

		expect(request.patches).toEqual([
			expect.objectContaining({
				type: 'convert_shape',
				shape_id: rect.id,
				kind: 'ellipse',
				properties: { w: 40, h: 20, fill: 'red', stroke: 'none' }
			})
		]);
	});

	it('routes topology edits as canonical path patches', () => {
		const page = EditorPageRecord.create('Page 1', 'page:one');
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
		const path = EditorShapeRecord.createPath(page.id, 0, 0, props, 'shape:path');
		page.shapeIds.push(path.id);
		const before: EditorDocument = { pages: { [page.id]: page }, shapes: { [path.id]: path }, bindings: {} };
		const after: EditorDocument = {
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
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const back = EditorLayerRecord.create(page.id, 'Back', 'layer:back');
		page.layerIds = [back.id];
		const front = EditorLayerRecord.create(page.id, 'Front', 'layer:front');
		const nextPage = EditorPageRecord.create('Page 2', 'page:two');
		const nextLayer = EditorLayerRecord.create(nextPage.id, 'Default', 'layer:two');
		const before: EditorDocument = { pages: { [page.id]: page }, layers: { [back.id]: back }, shapes: {}, bindings: {} };
		const after: EditorDocument = {
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
		const page = EditorPageRecord.create('Page 1', 'page:one');
		const source = EditorLayerRecord.create(page.id, 'Source', 'layer:source');
		const destination = EditorLayerRecord.create(page.id, 'Destination', 'layer:destination');
		const shape = EditorShapeRecord.createRect(
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
		const before: EditorDocument = {
			pages: { [page.id]: page },
			layers: { [source.id]: source, [destination.id]: destination },
			shapes: { [shape.id]: shape },
			bindings: {}
		};
		const after: EditorDocument = {
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
