import {
	alignShapes,
	distributeShapes,
	EditorState,
	groupShapes,
	ShapeRecord,
	stackShapes,
	tidyShapes,
	ungroupShapes
} from '../src';
import { describe, expect, it } from 'vitest';

function stateWithShapes() {
	const state = EditorState.create();
	state.doc.pages.page = { id: 'page', name: 'Page', shapeIds: [] };
	state.ui.currentPageId = 'page';
	const shapes = [
		ShapeRecord.createRect('page', 30, 20, { w: 10, h: 10, fill: '#000', stroke: '#000', radius: 0 }, 'one'),
		ShapeRecord.createRect('page', 0, 0, { w: 20, h: 10, fill: '#000', stroke: '#000', radius: 0 }, 'two'),
		ShapeRecord.createRect('page', 80, 40, { w: 10, h: 20, fill: '#000', stroke: '#000', radius: 0 }, 'three')
	];
	state.doc.shapes = Object.fromEntries(shapes.map((shape) => [shape.id, shape]));
	state.doc.pages.page.shapeIds = shapes.map((shape) => shape.id);
	state.ui.selectionIds = shapes.map((shape) => shape.id);
	return state;
}

describe('layout commands', () => {
	it('aligns selected shapes using world-space bounds', () => {
		const state = stateWithShapes();
		const aligned = alignShapes(state, state.ui.selectionIds, 'left');

		expect(aligned.doc.shapes.one.x).toBe(0);
		expect(aligned.doc.shapes.two.x).toBe(0);
		expect(aligned.doc.shapes.three.x).toBe(0);
	});

	it('distributes selected shapes with equal edge gaps', () => {
		const state = stateWithShapes();
		const distributed = distributeShapes(state, state.ui.selectionIds, 'horizontal');
		const positions = ['one', 'two', 'three'].map((id) => distributed.doc.shapes[id].x);

		expect(positions).toEqual([45, 0, 80]);
		expect(distributed.doc.shapes.one.x - distributed.doc.shapes.two.x - 20).toBe(25);
		expect(distributed.doc.shapes.three.x - distributed.doc.shapes.one.x - 10).toBe(25);
	});

	it('stacks selected shapes in deterministic order and keeps locked anchors fixed', () => {
		const state = stateWithShapes();
		state.doc.shapes.two.locked = true;
		const stacked = stackShapes(state, state.ui.selectionIds, 'horizontal', 5);

		expect(stacked.doc.shapes.one.x).toBe(25);
		expect(stacked.doc.shapes.two.x).toBe(0);
		expect(stacked.doc.shapes.three.x).toBe(40);
	});

	it('tidies mixed-size selections into a stable grid', () => {
		const state = stateWithShapes();
		const tidied = tidyShapes(state, state.ui.selectionIds, 10);
		const bounds = state.ui.selectionIds.map((id) => {
			const shape = tidied.doc.shapes[id];
			return [shape.x, shape.y];
		});

		expect(bounds).toEqual([
			[30, 0],
			[0, 0],
			[0, 30]
		]);
	});

	it('groups and ungroups without changing child world positions or metadata', () => {
		const state = stateWithShapes();
		state.doc.shapes.one.metadata = {
			name: 'First',
			title: null,
			role: 'diagram.step',
			description: 'First step',
			body: null,
			tags: ['start'],
			source: 'plan.md',
			link: null,
			customMetadata: { priority: 1 },
			locked: false,
			agentEditable: true
		};
		const metadata = state.doc.shapes.one.metadata;
		const grouped = groupShapes(state, ['one', 'two']);
		const groupId = grouped.ui.selectionIds[0];
		const group = grouped.doc.shapes[groupId];
		expect(group?.type).toBe('container');
		expect(grouped.doc.shapes.one.groupId).toBe(groupId);
		expect(grouped.doc.shapes.two.groupId).toBe(groupId);
		expect(grouped.doc.shapes.one.metadata).toEqual(metadata);

		const ungrouped = ungroupShapes(grouped, [groupId]);
		expect(ungrouped.doc.shapes[groupId]).toBeUndefined();
		expect(ungrouped.doc.shapes.one.x).toBe(30);
		expect(ungrouped.doc.shapes.two.x).toBe(0);
		expect(ungrouped.doc.shapes.one.groupId).toBeUndefined();
		expect(ungrouped.doc.shapes.one.metadata).toEqual(metadata);
	});
});
