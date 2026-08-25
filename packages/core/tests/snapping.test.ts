import { describe, expect, it } from 'vitest';
import { snapAngle, snapPoint, snapTranslation } from '../src/snapping';
import { EditorPageRecord, EditorShapeRecord } from '../src/editor-model';
import { EditorState } from '../src/reactivity';

const options = { snapEnabled: true, gridEnabled: false, gridSize: 25, snapDistance: 8 };

function stateWithShapes(shapes: ReturnType<typeof EditorShapeRecord.createRect>[]) {
	const page = EditorPageRecord.create('Snap page', 'page:snap');
	page.shapeIds = shapes.map((shape) => shape.id);
	return {
		...EditorState.create(),
		doc: {
			pages: { [page.id]: page },
			shapes: Object.fromEntries(shapes.map((shape) => [shape.id, shape])),
			bindings: {}
		},
		ui: { currentPageId: page.id, selectionIds: [], toolId: 'select' as const }
	};
}

describe('geometry snapping', () => {
	it('snaps a point to object edges and reports alignment guides', () => {
		const target = EditorShapeRecord.createRect(
			'page:snap',
			100,
			50,
			{ w: 40, h: 30, fill: '', stroke: '', radius: 0 },
			'shape:target'
		);
		const state = stateWithShapes([target]);
		const result = snapPoint(state, { x: 94, y: 76 }, [], options);

		expect(result.point).toEqual({ x: 100, y: 80 });
		expect(result.guides).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ axis: 'x', position: 100 }),
				expect.objectContaining({ axis: 'y', position: 80 })
			])
		);
	});

	it('snaps a moving selection to another shape while retaining its lead offset', () => {
		const moving = EditorShapeRecord.createRect(
			'page:snap',
			92,
			20,
			{ w: 20, h: 20, fill: '', stroke: '', radius: 0 },
			'shape:moving'
		);
		const target = EditorShapeRecord.createRect(
			'page:snap',
			100,
			20,
			{ w: 20, h: 20, fill: '', stroke: '', radius: 0 },
			'shape:target'
		);
		const state = stateWithShapes([moving, target]);
		const result = snapTranslation(state, [moving], { x: moving.x, y: moving.y }, { x: 0, y: 0 }, options);

		expect(result.point.x).toBe(90);
		expect(result.guides).toEqual(expect.arrayContaining([expect.objectContaining({ axis: 'x', position: 100 })]));
	});

	it('snaps line angles in fifteen-degree increments', () => {
		const point = snapAngle({ x: 0, y: 0 }, { x: 100, y: 20 });
		expect(Math.atan2(point.y, point.x) * (180 / Math.PI)).toBeCloseTo(15, 6);
	});
});
