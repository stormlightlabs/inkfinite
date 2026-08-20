import { describe, expect, it } from 'vitest';
import { Action, EditorState, PageRecord, SelectTool, ShapeRecord, Store, shapeBounds } from '../src';

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
