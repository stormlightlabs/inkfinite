import { describe, expect, it } from 'vitest';
import { Action, EditorState, PageRecord, SelectTool, ShapeRecord, Store, hitTestPoint, shapeBounds } from '../src';

const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
const buttons = { left: true, middle: false, right: false };
const buttonsUp = { left: false, middle: false, right: false };

function nestedState() {
	const page = PageRecord.create('Page', 'page:one');
	const container = ShapeRecord.createContainer(page.id, 100, 50, { w: 100, h: 80 }, 'shape:container');
	container.editorTransform = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
	const child = ShapeRecord.createRect(
		page.id,
		120,
		70,
		{ w: 20, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
		'shape:child'
	);
	child.groupId = container.id;
	child.editorTransform = { a: 2, b: 0, c: 0, d: 2, e: 120, f: 70 };
	page.shapeIds = [container.id, child.id];
	const state = EditorState.create();
	state.doc = { pages: { [page.id]: page }, shapes: { [container.id]: container, [child.id]: child }, bindings: {} };
	state.ui.currentPageId = page.id;
	return new Store(state).getState();
}

function multiParentState() {
	const state = nestedState();
	const page = state.doc.pages['page:one']!;
	const layer = state.doc.layers?.[page.layerIds?.[0] ?? ''];
	const sibling = ShapeRecord.createContainer(page.id, 300, 40, { w: 100, h: 80 }, 'shape:sibling');
	sibling.editorTransform = { a: 1, b: 0, c: 0, d: 1, e: 300, f: 40 };
	const siblingChild = ShapeRecord.createRect(
		page.id,
		320,
		60,
		{ w: 20, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
		'shape:sibling-child'
	);
	siblingChild.groupId = sibling.id;
	siblingChild.editorTransform = { a: 1, b: 0, c: 0, d: 1, e: 320, f: 60 };
	const pages = { ...state.doc.pages, [page.id]: { ...page, shapeIds: [...page.shapeIds, sibling.id, siblingChild.id] } };
	const shapes = { ...state.doc.shapes, [sibling.id]: sibling, [siblingChild.id]: siblingChild };
	const layers = layer
		? { ...state.doc.layers, [layer.id]: { ...layer, shapeIds: [...layer.shapeIds, sibling.id, siblingChild.id] } }
		: state.doc.layers;
	return new Store({ ...state, doc: { ...state.doc, pages, layers, shapes } }).getState();
}

describe('hierarchical selection', () => {
	it('selects a nested SVG as its container before entering the child scope', () => {
		const tool = new SelectTool();
		const state = nestedState();
		const clicked = tool.onAction(
			state,
			Action.pointerDown({ x: 125, y: 75 }, { x: 125, y: 75 }, 0, buttons, modifiers)
		);

		expect(clicked.ui.selectionIds).toEqual(['shape:container']);

		const entered = tool.onAction(clicked, Action.keyDown('Enter', 'Enter', modifiers));
		expect(entered.ui.containerPath).toEqual(['shape:container']);
		expect(entered.ui.selectionIds).toEqual([]);

		const childSelected = tool.onAction(
			entered,
			Action.pointerDown({ x: 125, y: 75 }, { x: 125, y: 75 }, 0, buttons, modifiers)
		);
		expect(childSelected.ui.selectionIds).toEqual(['shape:child']);

		const left = tool.onAction(childSelected, Action.keyDown('Escape', 'Escape', modifiers));
		expect(left.ui.containerPath).toEqual([]);
		expect(left.ui.selectionIds).toEqual(['shape:container']);
	});

	it('moves and resizes a nested child in world coordinates', () => {
		const tool = new SelectTool();
		const state = nestedState();
		const entered = { ...state, ui: { ...state.ui, containerPath: ['shape:container'] } };
		const childSelected = tool.onAction(
			entered,
			Action.pointerDown({ x: 125, y: 75 }, { x: 125, y: 75 }, 0, buttons, modifiers)
		);
		const moved = tool.onAction(
			childSelected,
			Action.pointerMove({ x: 135, y: 85 }, { x: 135, y: 85 }, buttons, modifiers)
		);
		expect(moved.doc.shapes['shape:child']?.editorTransform?.e).toBe(130);
		expect(moved.doc.shapes['shape:child']?.editorTransform?.f).toBe(80);

		const child = moved.doc.shapes['shape:child'];
		expect(child).toBeDefined();
		const bounds = shapeBounds(child!);
		const resized = tool.onAction(
			moved,
			Action.pointerDown(
				{ x: bounds.max.x, y: bounds.max.y + 2 },
				{ x: bounds.max.x, y: bounds.max.y + 2 },
				0,
				buttons,
				modifiers
			)
		);
		const preview = tool.onAction(
			resized,
			Action.pointerMove(
				{ x: bounds.max.x + 10, y: bounds.max.y + 12 },
				{ x: bounds.max.x + 10, y: bounds.max.y + 12 },
				buttons,
				modifiers
			)
		);
		expect((preview.doc.shapes['shape:child'] as typeof child)?.props).toMatchObject({ w: 25, h: 16 });
		tool.onAction(preview, Action.pointerUp({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, buttonsUp, modifiers));
	});

	it('keeps selection at the current scope when shapes have different parents', () => {
		const tool = new SelectTool();
		const state = multiParentState();
		const first = tool.onAction(
			state,
			Action.pointerDown({ x: 325, y: 65 }, { x: 325, y: 65 }, 0, buttons, modifiers)
		);
		expect(first.ui.selectionIds).toEqual(['shape:sibling']);
		const multiple = tool.onAction(
			first,
			Action.pointerDown(
				{ x: 125, y: 75 },
				{ x: 125, y: 75 },
				0,
				buttons,
				{ ...modifiers, shift: true }
			)
		);
		expect(multiple.ui.selectionIds).toEqual(['shape:sibling', 'shape:container']);

		const entered = tool.onAction(
			{ ...state, ui: { ...state.ui, containerPath: ['shape:sibling'] } },
			Action.pointerDown({ x: 325, y: 65 }, { x: 325, y: 65 }, 0, buttons, modifiers)
		);
		expect(entered.ui.selectionIds).toEqual(['shape:sibling-child']);
	});

	it('maps hit testing through nested transforms and excludes locked or hidden hierarchy', () => {
		const state = nestedState();
		expect(hitTestPoint(state, { x: 125, y: 75 })).toBe('shape:child');

		const lockedContainer = { ...state.doc.shapes['shape:container']!, locked: true };
		const locked = new Store({
			...state,
			doc: { ...state.doc, shapes: { ...state.doc.shapes, [lockedContainer.id]: lockedContainer } },
			ui: { ...state.ui, selectionIds: [lockedContainer.id] }
		}).getState();
		expect(locked.ui.selectionIds).toEqual([]);
		expect(hitTestPoint(locked, { x: 125, y: 75 })).toBeNull();

		const layerId = locked.doc.pages['page:one']!.layerIds?.[0];
		const hiddenLayer = layerId && locked.doc.layers?.[layerId]
			? { ...locked.doc.layers[layerId]!, visible: false }
			: undefined;
		const hidden = hiddenLayer
			? new Store({
						...locked,
						doc: { ...locked.doc, layers: { ...locked.doc.layers, [layerId!]: hiddenLayer } }
					}).getState()
			: locked;
		expect(hitTestPoint(hidden, { x: 125, y: 75 })).toBeNull();
	});

	it('rotates a nested child around its local geometry center', () => {
		const tool = new SelectTool();
		const state = nestedState();
		const entered = { ...state, ui: { ...state.ui, containerPath: ['shape:container'] } };
		const selected = tool.onAction(
			entered,
			Action.pointerDown({ x: 125, y: 75 }, { x: 125, y: 75 }, 0, buttons, modifiers)
		);
		const ready = tool.onAction(
			selected,
			Action.pointerUp({ x: 125, y: 75 }, { x: 125, y: 75 }, 0, buttonsUp, modifiers)
		);
		const child = ready.doc.shapes['shape:child']!;
		const bounds = shapeBounds(child);
		const centerX = (bounds.min.x + bounds.max.x) / 2;
		const rotateHandle = { x: centerX, y: bounds.min.y - 40 };
		const started = tool.onAction(ready, Action.pointerDown(rotateHandle, rotateHandle, 0, buttons, modifiers));
		const rotated = tool.onAction(
			started,
			Action.pointerMove(
				{ x: centerX + 40, y: bounds.min.y },
				{ x: centerX + 40, y: bounds.min.y },
				buttons,
				modifiers
			)
		);
		const transform = rotated.doc.shapes['shape:child']?.editorTransform;
		expect(transform).toBeDefined();
		expect(Math.abs(transform!.a - 2) + Math.abs(transform!.b)).toBeGreaterThan(0);
	});
});
