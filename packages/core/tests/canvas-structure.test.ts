import { describe, expect, it } from 'vitest';
import {
	Action,
	computeCurvedPath,
	exportToSVG,
	FrameTool,
	PageRecord,
	SelectTool,
	ShapeRecord,
	Store,
	type EditorState
} from '../src';

const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
const down = { left: true, middle: false, right: false };
const up = { left: false, middle: false, right: false };

function frameState(): EditorState {
	const page = PageRecord.create('Canvas', 'page:canvas');
	const card = ShapeRecord.createRect(
		page.id,
		20,
		30,
		{ w: 80, h: 50, fill: '#fff', stroke: '#111', radius: 0 },
		'shape:card'
	);
	page.shapeIds = [card.id];
	const editor: EditorState = {
		doc: { pages: { [page.id]: page }, shapes: { [card.id]: card }, bindings: {} },
		ui: { currentPageId: page.id, activeLayerId: null, selectionIds: [], toolId: 'frame' },
		camera: { x: 0, y: 0, zoom: 1 }
	};
	return new Store(editor).getState();
}

describe('canvas structure', () => {
	it('creates titled frames, adopts enclosed children, and moves contents with the frame', () => {
		const tool = new FrameTool();
		let state = frameState();
		state = tool.onAction(state, Action.pointerDown({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, down, modifiers));
		state = tool.onAction(state, Action.pointerMove({ x: 200, y: 150 }, { x: 200, y: 150 }, down, modifiers));
		state = tool.onAction(state, Action.pointerUp({ x: 200, y: 150 }, { x: 200, y: 150 }, 0, up, modifiers));

		const frameId = state.ui.selectionIds[0];
		const frame = state.doc.shapes[frameId];
		expect(frame?.type).toBe('container');
		expect(frame?.props).toMatchObject({ title: 'Frame', w: 200, h: 150 });
		expect(state.doc.shapes['shape:card']?.groupId).toBe(frameId);

		const select = new SelectTool();
		state = select.onAction(state, Action.pointerDown({ x: 190, y: 140 }, { x: 190, y: 140 }, 0, down, modifiers));
		state = select.onAction(state, Action.pointerMove({ x: 210, y: 160 }, { x: 210, y: 160 }, down, modifiers));
		state = select.onAction(state, Action.pointerUp({ x: 210, y: 160 }, { x: 210, y: 160 }, 0, up, modifiers));
		expect(state.doc.shapes['shape:card']?.x).toBe(40);
		expect(state.doc.shapes['shape:card']?.y).toBe(50);
	});

	it('exports a selected frame together with its descendants and title', () => {
		let state = frameState();
		const frame = ShapeRecord.createContainer(
			'page:canvas',
			0,
			0,
			{ w: 200, h: 150, title: 'Systems', stroke: '#2563eb' },
			'shape:frame'
		);
		frame.groupId = undefined;
		state = new Store({
			...state,
			doc: {
				...state.doc,
				shapes: { ...state.doc.shapes, [frame.id]: frame },
				pages: { 'page:canvas': { ...state.doc.pages['page:canvas']!, shapeIds: [frame.id, 'shape:card'] } }
			},
			ui: { ...state.ui, selectionIds: [frame.id] }
		}).getState();
		state = new Store({
			...state,
			doc: {
				...state.doc,
				shapes: { ...state.doc.shapes, 'shape:card': { ...state.doc.shapes['shape:card']!, groupId: frame.id } }
			}
		}).getState();

		const svg = exportToSVG(state, { selectedOnly: true });
		expect(svg).toContain('Systems');
		expect(svg).toContain('width="80"');
	});

	it('samples curved arrow bends for rendering and hit testing', () => {
		const points = computeCurvedPath(
			[
				{ x: 0, y: 0 },
				{ x: 50, y: 80 },
				{ x: 100, y: 0 }
			],
			12
		);
		expect(points.length).toBeGreaterThan(3);
		expect(points.at(-1)).toEqual({ x: 100, y: 0 });
	});
});
