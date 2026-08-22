import { describe, expect, it } from 'vitest';
import { Action, Modifiers, PointerButtons } from '../src/actions';
import { convertSelectedShapes, duplicateAndConnectSelection, duplicateSelection } from '../src/selection';
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
	it('duplicates and connects before an Alt+Shift drag', () => {
		const tool = new SelectTool();
		const state = selectionState();
		let next = tool.onAction(
			state,
			Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, Modifiers.create(false, true, true))
		);
		const duplicateId = next.ui.selectionIds[0];
		next = tool.onAction(
			next,
			Action.pointerMove({ x: 30, y: 20 }, { x: 30, y: 20 }, down, Modifiers.create(false, true, true))
		);

		expect(next.doc.shapes[duplicateId]).toMatchObject({ x: 20, y: 0 });
		expect(Object.values(next.doc.shapes).filter((shape) => shape.type === 'arrow')).toHaveLength(1);
	});

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

	it('cycles through overlapping shapes on repeated clicks at one point', () => {
		const page = PageRecord.create('Overlap page', 'page:overlap');
		const back = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 40, h: 30, fill: '', stroke: '', radius: 0 },
			'shape:back'
		);
		const front = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 40, h: 30, fill: '', stroke: '', radius: 0 },
			'shape:front'
		);
		page.shapeIds = [back.id, front.id];
		const state = {
			...EditorState.create(),
			doc: { pages: { [page.id]: page }, shapes: { [back.id]: back, [front.id]: front }, bindings: {} },
			ui: { currentPageId: page.id, selectionIds: [], toolId: 'select' as const }
		};
		const tool = new SelectTool();
		const click = (nextState: EditorState) => {
			const downState = tool.onAction(
				nextState,
				Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, Modifiers.create())
			);
			return tool.onAction(
				downState,
				Action.pointerUp({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, PointerButtons.create(), Modifiers.create())
			);
		};

		const first = click(state);
		const dragTool = new SelectTool();
		const dragStart = dragTool.onAction(
			first,
			Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, Modifiers.create())
		);
		const dragged = dragTool.onAction(
			dragStart,
			Action.pointerMove({ x: 20, y: 10 }, { x: 20, y: 10 }, down, Modifiers.create())
		);
		const dragEnd = dragTool.onAction(
			dragged,
			Action.pointerUp({ x: 20, y: 10 }, { x: 20, y: 10 }, 0, PointerButtons.create(), Modifiers.create())
		);
		expect(dragEnd.doc.shapes['shape:front']).toMatchObject({ x: 10, y: 0 });
		expect(dragEnd.doc.shapes['shape:back']).toMatchObject({ x: 0, y: 0 });

		const second = click(first);
		const third = click(second);
		expect(first.ui.selectionIds).toEqual(['shape:front']);
		expect(second.ui.selectionIds).toEqual(['shape:back']);
		expect(third.ui.selectionIds).toEqual(['shape:front']);
	});

	it('cycles independently inside a nested selection scope', () => {
		const page = PageRecord.create('Nested page', 'page:nested');
		const frame = ShapeRecord.createContainer(
			page.id,
			0,
			0,
			{ w: 50, h: 50, fill: '', stroke: '', radius: 0 },
			'shape:frame'
		);
		const back = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 40, h: 30, fill: '', stroke: '', radius: 0 },
			'shape:nested-back'
		);
		const front = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 40, h: 30, fill: '', stroke: '', radius: 0 },
			'shape:nested-front'
		);
		back.groupId = frame.id;
		front.groupId = frame.id;
		page.shapeIds = [frame.id, back.id, front.id];
		const state = {
			...EditorState.create(),
			doc: {
				pages: { [page.id]: page },
				shapes: { [frame.id]: frame, [back.id]: back, [front.id]: front },
				bindings: {}
			},
			ui: { currentPageId: page.id, selectionIds: [], toolId: 'select' as const, containerPath: [frame.id] }
		};
		const tool = new SelectTool();
		const click = (nextState: EditorState) => {
			const downState = tool.onAction(
				nextState,
				Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, Modifiers.create())
			);
			return tool.onAction(
				downState,
				Action.pointerUp({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, PointerButtons.create(), Modifiers.create())
			);
		};

		const first = click(state);
		const second = click(first);
		expect(first.ui.selectionIds).toEqual([front.id]);
		expect(second.ui.selectionIds).toEqual([back.id]);
	});

	it('duplicates selected roots and connects each copy to its source', () => {
		const state = selectionState();
		const next = duplicateAndConnectSelection(state);
		if (!next) throw new Error('expected a duplicate');
		const copiedId = next.ui.selectionIds[0];
		const arrows = Object.values(next.doc.shapes).filter((shape) => shape.type === 'arrow');
		const arrow = arrows[0];
		expect(Object.keys(next.doc.shapes)).toHaveLength(3);
		expect(next.doc.shapes[copiedId]).toMatchObject({ x: 160, y: 0 });
		expect(arrow).toBeDefined();
		if (!arrow || arrow.type !== 'arrow') throw new Error('expected a connector');
		expect(arrow.props.start.kind).toBe('bound');
		expect(arrow.props.end.kind).toBe('bound');
		expect(Object.values(next.doc.bindings)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ fromShapeId: arrow.id, toShapeId: 'shape:one', handle: 'start' }),
				expect.objectContaining({ fromShapeId: arrow.id, toShapeId: copiedId, handle: 'end' })
			])
		);
	});

	it('preserves semantic metadata through duplication and conversion', () => {
		const state = selectionState();
		const shape = state.doc.shapes['shape:one'];
		shape.metadata = {
			name: 'Gateway',
			title: null,
			role: 'architecture.service',
			description: 'Routes requests',
			body: null,
			tags: ['api'],
			source: 'architecture.md',
			link: null,
			customMetadata: { owner: 'platform', config: { retries: 2 } },
			locked: false,
			agentEditable: true,
			provenance: { actorId: 'actor:test', origin: 'human', timestamp: 42, source: 'seed' }
		};
		const duplicated = duplicateSelection(state, { x: 10, y: 10 });
		if (!duplicated) throw new Error('expected a duplicate');
		const duplicateId = duplicated.ui.selectionIds[0];
		expect(duplicated.doc.shapes[duplicateId]?.metadata).toEqual(shape.metadata);
		expect(duplicated.doc.shapes[duplicateId]?.metadata).not.toBe(shape.metadata);
		expect(duplicated.doc.shapes[duplicateId]?.metadata?.customMetadata).not.toBe(
			shape.metadata?.customMetadata
		);
		expect(
			(duplicated.doc.shapes[duplicateId]?.metadata?.customMetadata.config as { retries: number })
		).not.toBe(shape.metadata?.customMetadata.config);

		const next = convertSelectedShapes(state, 'ellipse');
		const converted = next.doc.shapes['shape:one'];
		expect(converted.metadata).toEqual(shape.metadata);
	});

	it('converts a selection while preserving its common shape fields', () => {
		const state = selectionState();
		const next = convertSelectedShapes(state, 'ellipse');
		const shape = next.doc.shapes['shape:one'];
		expect(shape.type).toBe('ellipse');
		expect(shape).toMatchObject({ x: 0, y: 0, rot: 0 });
		if (shape.type !== 'ellipse') throw new Error('expected ellipse');
		expect(shape.props).toEqual({ w: 40, h: 30, fill: '', stroke: '' });
	});

	it('does not convert shapes that participate in a connector binding', () => {
		const state = selectionState() as EditorState;
		const arrow = ShapeRecord.createArrow(
			state.doc.pages['page:selection']!.id,
			0,
			0,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 100, y: 0 }
				],
				start: { kind: 'free' },
				end: { kind: 'free' },
				style: { stroke: '#000', width: 2 }
			},
			'shape:arrow'
		);
		state.doc.shapes[arrow.id] = arrow;
		state.doc.bindings['binding:one'] = {
			id: 'binding:one',
			type: 'arrow-end',
			fromShapeId: arrow.id,
			toShapeId: 'shape:one',
			handle: 'end',
			anchor: { kind: 'center' }
		};
		const next = convertSelectedShapes(state, 'ellipse');
		expect(next.doc.shapes['shape:one']?.type).toBe('rect');
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
