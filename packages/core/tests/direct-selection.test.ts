import { describe, expect, it } from 'vitest';
import { Action, DirectSelectTool, Modifiers, EditorPageRecord, EditorShapeRecord, Store, hitTestPoint, shapeBounds } from '../src';
import type { PathProps, PathSelection } from '../src/editor-model';

const modifiers = Modifiers.create();
const buttons = { left: true, middle: false, right: false };
const buttonsUp = { left: false, middle: false, right: false };

function pointerDown(x: number, y: number, nextModifiers = modifiers) {
	return Action.pointerDown({ x, y }, { x, y }, 0, buttons, nextModifiers);
}

function pointerMove(x: number, y: number) {
	return Action.pointerMove({ x, y }, { x, y }, buttons, modifiers);
}

function pointerUp(x: number, y: number) {
	return Action.pointerUp({ x, y }, { x, y }, 0, buttonsUp, modifiers);
}

function createPathState() {
	const page = EditorPageRecord.create('Page', 'page:direct-selection');
	const geometry: PathProps = {
		subpaths: [
			{
				segments: [
					{ type: 'move', to: { x: 0, y: 0 } },
					{ type: 'line', to: { x: 100, y: 0 } },
					{ type: 'quadratic', control: { x: 150, y: 50 }, to: { x: 100, y: 100 } },
					{ type: 'cubic', control_1: { x: 100, y: 150 }, control_2: { x: 0, y: 150 }, to: { x: 0, y: 100 } }
				],
				closed: true
			},
			{
				segments: [
					{ type: 'move', to: { x: 200, y: 0 } },
					{ type: 'line', to: { x: 260, y: 0 } }
				],
				closed: false
			}
		],
		fill_rule: 'nonzero',
		fill: '#fff'
	};
	const path = EditorShapeRecord.createPath(page.id, 0, 0, geometry, 'path:direct');
	page.shapeIds = [path.id];
	const state = new Store({
		doc: { pages: { [page.id]: page }, shapes: { [path.id]: path }, bindings: {} },
		ui: { currentPageId: page.id, selectionIds: [], toolId: 'direct-select' },
		camera: { x: 0, y: 0, zoom: 1 }
	}).getState();
	return { state, path };
}

function anchorsFor(selection: PathSelection | undefined) {
	return selection?.anchors ?? [];
}

describe('DirectSelectTool', () => {
	it('selects an individual anchor and adds another with shift', () => {
		const { state } = createPathState();
		const tool = new DirectSelectTool();

		let next = tool.onEnter(state);
		next = tool.onAction(next, pointerDown(0, 0));
		expect(anchorsFor(next.ui.pathSelection)).toEqual([{ subpathIndex: 0, segmentIndex: 0 }]);

		next = tool.onAction(next, pointerUp(0, 0));
		next = tool.onAction(next, pointerDown(100, 0, Modifiers.create(false, true)));
		expect(anchorsFor(next.ui.pathSelection)).toEqual([
			{ subpathIndex: 0, segmentIndex: 0 },
			{ subpathIndex: 0, segmentIndex: 1 }
		]);
	});

	it('selects every anchor in a complete subpath', () => {
		const { state } = createPathState();
		const tool = new DirectSelectTool();

		let next = tool.onEnter(state);
		next = tool.onAction(next, pointerDown(50, 0));
		expect(anchorsFor(next.ui.pathSelection)).toEqual([
			{ subpathIndex: 0, segmentIndex: 0 },
			{ subpathIndex: 0, segmentIndex: 1 },
			{ subpathIndex: 0, segmentIndex: 2 },
			{ subpathIndex: 0, segmentIndex: 3 }
		]);
	});

	it('moves selected anchors in path-local coordinates', () => {
		const { state, path } = createPathState();
		const tool = new DirectSelectTool();
		const selected = {
			...state,
			ui: {
				...state.ui,
				selectionIds: [path.id],
				pathSelection: { pathId: path.id, anchors: [{ subpathIndex: 0, segmentIndex: 0 }] }
			}
		};

		let next = tool.onEnter(selected);
		next = tool.onAction(next, pointerDown(0, 0));
		next = tool.onAction(next, pointerMove(10, 20));
		next = tool.onAction(next, pointerUp(10, 20));

		const updated = next.doc.shapes[path.id];
		expect(updated?.type).toBe('path');
		if (updated?.type === 'path') {
			expect(updated.props.subpaths[0].segments[0].to).toEqual({ x: 10, y: 20 });
			expect(updated.props.subpaths[0].segments[1].to).toEqual({ x: 100, y: 0 });
		}
	});

	it('moves a complete subpath and quadratic and cubic controls', () => {
		const { state, path } = createPathState();
		const tool = new DirectSelectTool();
		let next = tool.onEnter(state);
		next = tool.onAction(next, pointerDown(50, 0));
		next = tool.onAction(next, pointerMove(60, 20));
		next = tool.onAction(next, pointerUp(60, 20));

		const updated = next.doc.shapes[path.id];
		expect(updated?.type).toBe('path');
		if (updated?.type === 'path') {
			expect(updated.props.subpaths[0].segments[2]).toMatchObject({
				control: { x: 160, y: 70 },
				to: { x: 110, y: 120 }
			});
			expect(updated.props.subpaths[0].segments[3]).toMatchObject({
				control_1: { x: 110, y: 170 },
				control_2: { x: 10, y: 170 },
				to: { x: 10, y: 120 }
			});
		}
	});

	it('updates bounds and hit regions during a path-edit preview', () => {
		const page = EditorPageRecord.create('Page', 'page:direct-preview');
		const path = EditorShapeRecord.createPath(
			page.id,
			0,
			0,
			{
				subpaths: [
					{
						segments: [
							{ type: 'move', to: { x: 0, y: 0 } },
							{ type: 'line', to: { x: 100, y: 0 } },
							{ type: 'line', to: { x: 100, y: 100 } },
							{ type: 'line', to: { x: 0, y: 100 } }
						],
						closed: true
					}
				],
				fill_rule: 'nonzero',
				fill: '#fff'
			},
			'path:direct-preview'
		);
		page.shapeIds = [path.id];
		const state = new Store({
			doc: { pages: { [page.id]: page }, shapes: { [path.id]: path }, bindings: {} },
			ui: {
				currentPageId: page.id,
				selectionIds: [path.id],
				toolId: 'direct-select',
				pathSelection: { pathId: path.id, anchors: [] }
			},
			camera: { x: 0, y: 0, zoom: 1 }
		}).getState();
		const tool = new DirectSelectTool();

		let next = tool.onEnter(state);
		next = tool.onAction(next, pointerDown(50, 0));
		next = tool.onAction(next, pointerMove(200, 0));

		const previewPath = next.doc.shapes[path.id];
		expect(previewPath?.type).toBe('path');
		if (previewPath?.type === 'path') {
			expect(shapeBounds(previewPath)).toEqual({ min: { x: 150, y: 0 }, max: { x: 250, y: 100 } });
			expect(hitTestPoint(next, { x: 200, y: 50 })).toBe(path.id);
			expect(hitTestPoint(next, { x: 50, y: 50 })).toBeNull();
		}
	});

	it('edits stroke width points independently from the stroke path points', () => {
		const page = EditorPageRecord.create('Page', 'page:direct-width');
		const stroke = EditorShapeRecord.createStroke(
			page.id,
			0,
			0,
			{
				points: [
					[0, 0],
					[100, 0]
				],
				brush: { size: 10, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
				style: { color: '#000000', opacity: 1 }
			},
			'stroke:direct-width'
		);
		page.shapeIds = [stroke.id];
		const state = new Store({
			doc: { pages: { [page.id]: page }, shapes: { [stroke.id]: stroke }, bindings: {} },
			ui: { currentPageId: page.id, selectionIds: [stroke.id], toolId: 'direct-select' },
			camera: { x: 0, y: 0, zoom: 1 }
		}).getState();
		const tool = new DirectSelectTool();

		let next = tool.onEnter(state);
		next = tool.onAction(next, pointerDown(0, 5));
		next = tool.onAction(next, pointerMove(0, 15));
		next = tool.onAction(next, pointerUp(0, 15));

		const updated = next.doc.shapes[stroke.id];
		expect(updated?.type).toBe('stroke');
		if (updated?.type === 'stroke') {
			expect(updated.props.points).toEqual([
				[0, 0],
				[100, 0]
			]);
			expect(updated.props.widthProfile?.[0]?.width).toBe(30);
		}
	});

	it('drags quadratic and cubic control handles', () => {
		const { state, path } = createPathState();
		const tool = new DirectSelectTool();
		let next = tool.onEnter({
			...state,
			ui: { ...state.ui, selectionIds: [path.id], pathSelection: { pathId: path.id, anchors: [] } }
		});

		next = tool.onAction(next, pointerDown(150, 50));
		next = tool.onAction(next, pointerMove(160, 60));
		next = tool.onAction(next, pointerUp(160, 60));
		next = tool.onAction(next, pointerDown(100, 150));
		next = tool.onAction(next, pointerMove(120, 170));
		next = tool.onAction(next, pointerUp(120, 170));

		const updated = next.doc.shapes[path.id];
		expect(updated?.type).toBe('path');
		if (updated?.type === 'path') {
			expect(updated.props.subpaths[0].segments[2]).toMatchObject({ control: { x: 160, y: 60 } });
			expect(updated.props.subpaths[0].segments[3]).toMatchObject({ control_1: { x: 120, y: 170 } });
		}
	});
});
