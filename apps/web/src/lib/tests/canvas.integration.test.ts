import {
	Action,
	computeObstacleAwareOrthogonalPath,
	duplicateAndConnectSelection,
	EditorState,
	Modifiers,
	EditorPageRecord,
	PointerButtons,
	EditorShapeRecord,
	Store,
	SelectTool
} from '@inkfinite/core';
import { executeSelectionCommand } from '$editor/commands';
import { describe, expect, it } from 'vitest';

const modifiers = Modifiers.create();
const down = PointerButtons.create(true, false, false);
const up = PointerButtons.create();

function overlappingState(): EditorState {
	const page = EditorPageRecord.create('Canvas quality', 'page:quality');
	const back = EditorShapeRecord.createRect(
		page.id,
		0,
		0,
		{ w: 80, h: 50, fill: '#fff', stroke: '#111', radius: 4 },
		'shape:back'
	);
	const front = EditorShapeRecord.createRect(
		page.id,
		0,
		0,
		{ w: 80, h: 50, fill: '#fff', stroke: '#111', radius: 4 },
		'shape:front'
	);
	page.shapeIds = [back.id, front.id];
	return {
		...EditorState.create(),
		doc: {
			pages: { [page.id]: page },
			shapes: { [back.id]: back, [front.id]: front },
			bindings: {}
		},
		ui: { currentPageId: page.id, selectionIds: [front.id], toolId: 'select' as const }
	};
}

describe('canvas interaction quality in the browser runtime', () => {
	it('covers duplication, cycling, command execution, and automatic routing together', () => {
		const state = overlappingState();
		const duplicate = duplicateAndConnectSelection(state);
		expect(duplicate).not.toBeNull();
		expect(
			Object.values(duplicate!.doc.shapes).filter((shape) => shape.type === 'arrow')
		).toHaveLength(1);

		const tool = new SelectTool();
		const click = (current: typeof state) => {
			const pressed = tool.onAction(
				current,
				Action.pointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, down, modifiers)
			);
			return tool.onAction(
				pressed,
				Action.pointerUp({ x: 10, y: 10 }, { x: 10, y: 10 }, 0, up, modifiers)
			);
		};
		const cyclingStart = { ...state, ui: { ...state.ui, selectionIds: [] } };
		const first = click(cyclingStart);
		const cycled = click(first);
		expect(first.ui.selectionIds).toEqual(['shape:front']);
		expect(cycled.ui.selectionIds).toEqual(['shape:back']);

		const store = new Store(state);
		expect(executeSelectionCommand(store, 'convert-to-ellipse')).toBe(true);
		expect(store.getState().doc.shapes['shape:front']?.type).toBe('ellipse');

		const route = computeObstacleAwareOrthogonalPath(
			{ x: 0, y: 50 },
			{ x: 200, y: 50 },
			[{ min: { x: 75, y: 25 }, max: { x: 125, y: 75 } }],
			10
		);
		expect(route.length).toBeGreaterThan(2);
		expect(route).toEqual(
			computeObstacleAwareOrthogonalPath(
				{ x: 0, y: 50 },
				{ x: 200, y: 50 },
				[{ min: { x: 75, y: 25 }, max: { x: 125, y: 75 } }],
				10
			)
		);
	});
});
