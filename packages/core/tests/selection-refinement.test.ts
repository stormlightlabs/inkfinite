import { describe, expect, it } from 'vitest';
import { Action, Modifiers, PointerButtons } from '../src/actions';
import { PageRecord, ShapeRecord } from '../src/model';
import { EditorState } from '../src/reactivity';
import { RectTool, SelectTool } from '../src/tools';

const down = PointerButtons.create(true, false, false);
function selectionState() {
	const page = PageRecord.create('Selection page', 'page:selection');
	const shape = ShapeRecord.createRect(page.id, 0, 0, { w: 40, h: 30, fill: '', stroke: '', radius: 0 }, 'shape:one');
	page.shapeIds = [shape.id];
	return {
		...EditorState.create(),
		doc: { pages: { [page.id]: page }, shapes: { [shape.id]: shape }, bindings: {} },
		ui: { currentPageId: page.id, selectionIds: [shape.id], toolId: 'select' as const }
	};
}

describe('selection and movement refinements', () => {
	it('constrains a selection drag to its dominant axis with Shift', () => {
		const tool = new SelectTool();
		const state = selectionState();
		let next = tool.onAction(
			state,
			Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, Modifiers.create())
		);
		next = tool.onAction(
			next,
			Action.pointerMove({ x: 40, y: 30 }, { x: 40, y: 30 }, down, Modifiers.create(false, true))
		);

		expect(next.doc.shapes['shape:one']).toMatchObject({ x: 30, y: 0 });
	});

	it('duplicates a selected shape before an Alt-drag', () => {
		const tool = new SelectTool();
		const state = selectionState();
		let next = tool.onAction(
			state,
			Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, Modifiers.create(false, false, true))
		);
		expect(Object.keys(next.doc.shapes)).toHaveLength(2);
		next = tool.onAction(
			next,
			Action.pointerMove({ x: 30, y: 20 }, { x: 30, y: 20 }, down, Modifiers.create(false, false, true))
		);
		const duplicateId = next.ui.selectionIds[0];
		expect(next.doc.shapes[duplicateId]).toMatchObject({ x: 20, y: 10 });
		expect(next.doc.shapes['shape:one']).toMatchObject({ x: 0, y: 0 });
	});

	it('uses Shift and Alt for square centered rectangle creation', () => {
		const tool = new RectTool();
		const page = PageRecord.create('Draw page', 'page:draw');
		const state = {
			...EditorState.create(),
			doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
			ui: { currentPageId: page.id, selectionIds: [], toolId: 'rect' as const }
		};
		let next = tool.onAction(
			state,
			Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, Modifiers.create(false, false, true))
		);
		next = tool.onAction(
			next,
			Action.pointerMove({ x: 20, y: 30 }, { x: 20, y: 30 }, down, Modifiers.create(false, true, true))
		);
		const shape = next.doc.shapes[next.ui.selectionIds[0]];
		expect(shape).toMatchObject({ x: -10, y: -10, props: { w: 40, h: 40 } });
	});
});
