import { describe, expect, it } from 'vitest';
import { gridShapes } from './layout';
import { shapeBounds } from './geom';
import { EditorState } from './reactivity';
import { PageRecord, ShapeRecord } from './model';

describe('gridShapes', () => {
	it('places selected objects in stable rows and columns', () => {
		const page = PageRecord.create('Grid test', 'page:grid');
		const shapes = [
			ShapeRecord.createRect(page.id, 120, 80, { w: 40, h: 20, fill: '#fff', stroke: '#000', radius: 0 }, 'a'),
			ShapeRecord.createRect(page.id, 0, 0, { w: 80, h: 30, fill: '#fff', stroke: '#000', radius: 0 }, 'b'),
			ShapeRecord.createRect(page.id, 300, 200, { w: 20, h: 50, fill: '#fff', stroke: '#000', radius: 0 }, 'c')
		];
		page.shapeIds = shapes.map((shape) => shape.id);
		const state = EditorState.create();
		state.doc.pages[page.id] = page;
		for (const shape of shapes) state.doc.shapes[shape.id] = shape;
		state.ui.currentPageId = page.id;

		const next = gridShapes(
			state,
			shapes.map((shape) => shape.id),
			10
		);
		const bounds = shapes.map((shape) => shapeBounds(next.doc.shapes[shape.id]!));
		expect(bounds.map((bound) => [bound.min.x, bound.min.y])).toEqual([
			[90, 0],
			[0, 0],
			[0, 60]
		]);
	});
});
