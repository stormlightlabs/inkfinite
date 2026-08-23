import { describe, expect, it } from 'vitest';
import { graphLayout, gridShapes } from './layout';
import { shapeBounds } from './geom';
import { EditorState } from './reactivity';
import { BindingRecord, PageRecord, ShapeRecord } from './model';

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

describe('graphLayout', () => {
	function graphState() {
		const page = PageRecord.create('Graph test', 'page:graph');
		const shapes = [
			ShapeRecord.createRect(page.id, 300, 200, { w: 40, h: 20, fill: '#fff', stroke: '#000', radius: 0 }, 'a'),
			ShapeRecord.createRect(page.id, 0, 0, { w: 60, h: 30, fill: '#fff', stroke: '#000', radius: 0 }, 'b'),
			ShapeRecord.createRect(page.id, 150, 300, { w: 20, h: 40, fill: '#fff', stroke: '#000', radius: 0 }, 'c')
		];
		page.shapeIds = shapes.map((shape) => shape.id);
		const state = EditorState.create();
		state.doc.pages[page.id] = page;
		for (const shape of shapes) state.doc.shapes[shape.id] = shape;
		state.doc.bindings.ab = BindingRecord.createRelation('a', 'b', 'depends_on', 'ab');
		state.doc.bindings.bc = BindingRecord.createRelation('b', 'c', 'depends_on', 'bc');
		state.ui.currentPageId = page.id;
		return { state, shapes };
	}

	it('uses explicit relationships and keeps the selection origin', () => {
		const { state, shapes } = graphState();
		const next = graphLayout(state, shapes.map((shape) => shape.id), 'flow', 'top-to-bottom');
		const bounds = shapes.map((shape) => shapeBounds(next.doc.shapes[shape.id]!));
		expect(bounds.find((bound) => bound.min.x === 0 && bound.min.y === 0)).toBeDefined();
		const a = shapeBounds(next.doc.shapes.a!);
		const b = shapeBounds(next.doc.shapes.b!);
		const c = shapeBounds(next.doc.shapes.c!);
		expect(a.min.y).toBeLessThan(b.min.y);
		expect(b.min.y).toBeLessThan(c.min.y);
	});

	it('supports left-to-right and cyclic radial layouts deterministically', () => {
		const { state, shapes } = graphState();
		const leftToRight = graphLayout(state, shapes.map((shape) => shape.id), 'tree', 'left-to-right');
		expect(shapeBounds(leftToRight.doc.shapes.a!).min.x).toBeLessThan(shapeBounds(leftToRight.doc.shapes.b!).min.x);
		expect(shapeBounds(leftToRight.doc.shapes.b!).min.x).toBeLessThan(shapeBounds(leftToRight.doc.shapes.c!).min.x);
		state.doc.bindings.ca = BindingRecord.createRelation('c', 'a', 'depends_on', 'ca');
		const first = graphLayout(state, shapes.map((shape) => shape.id), 'radial');
		const second = graphLayout(state, shapes.map((shape) => shape.id), 'radial');
		expect(first.doc.shapes).toEqual(second.doc.shapes);
	});

	it('keeps locked graph nodes fixed', () => {
		const { state, shapes } = graphState();
		state.doc.shapes.b = { ...state.doc.shapes.b!, locked: true };
		const before = shapeBounds(state.doc.shapes.b!);
		const next = graphLayout(state, shapes.map((shape) => shape.id));
		expect(shapeBounds(next.doc.shapes.b!)).toEqual(before);
	});
});
