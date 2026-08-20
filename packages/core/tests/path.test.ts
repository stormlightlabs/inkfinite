import { describe, expect, it } from 'vitest';
import { hitTestPath, pathGeometryBounds, pointInPath, pointNearPath, shapeBounds } from '../src/geom';
import { ShapeRecord, type PathGeometry } from '../src/model';

describe('native path geometry', () => {
	const geometry: PathGeometry = {
		subpaths: [
			{
				segments: [
					{ type: 'move', to: { x: 0, y: 0 } },
					{ type: 'line', to: { x: 40, y: 0 } },
					{ type: 'quadratic', control: { x: 50, y: 10 }, to: { x: 40, y: 20 } },
					{ type: 'cubic', control_1: { x: 40, y: 30 }, control_2: { x: 0, y: 30 }, to: { x: 0, y: 20 } }
				],
				closed: true
			}
		],
		fill_rule: 'evenodd'
	};

	it('includes quadratic and cubic extrema in bounds', () => {
		const bounds = pathGeometryBounds(geometry);
		expect(bounds.min.x).toBe(0);
		expect(bounds.max.x).toBe(45);
		expect(bounds.min.y).toBe(0);
		expect(bounds.max.y).toBeGreaterThan(20);
	});

	it('applies the path shape transform to bounds and hits', () => {
		const shape = ShapeRecord.createPath('page', 10, 20, { ...geometry, fill: '#fff', stroke: '#000' }, 'path');
		const bounds = shapeBounds(shape);
		expect(bounds.min.x).toBe(10);
		expect(bounds.min.y).toBe(20);
		expect(pointInPath({ x: 20, y: 25 }, geometry)).toBe(true);
		expect(hitTestPath({ x: 20, y: 25 }, shape)).toBe(true);
		expect(hitTestPath({ x: 100, y: 100 }, shape)).toBe(false);
	});

	it('uses even-odd for compound path holes', () => {
		const compound: PathGeometry = {
			subpaths: [
				{
					segments: [
						{ type: 'move', to: { x: 0, y: 0 } },
						{ type: 'line', to: { x: 100, y: 0 } },
						{ type: 'line', to: { x: 100, y: 100 } },
						{ type: 'line', to: { x: 0, y: 100 } }
					],
					closed: true
				},
				{
					segments: [
						{ type: 'move', to: { x: 25, y: 25 } },
						{ type: 'line', to: { x: 75, y: 25 } },
						{ type: 'line', to: { x: 75, y: 75 } },
						{ type: 'line', to: { x: 25, y: 75 } }
					],
					closed: true
				}
			],
			fill_rule: 'evenodd'
		};
		expect(pointInPath({ x: 10, y: 10 }, compound)).toBe(true);
		expect(pointInPath({ x: 50, y: 50 }, compound)).toBe(false);
	});

	it('hits open path strokes with width and selection tolerance', () => {
		const shape = ShapeRecord.createPath(
			'page',
			0,
			0,
			{
				subpaths: [
					{
						segments: [
							{ type: 'move', to: { x: 0, y: 0 } },
							{ type: 'line', to: { x: 100, y: 0 } }
						],
						closed: false
					}
				],
				fill_rule: 'nonzero',
				stroke: '#000',
				stroke_width: 4
			},
			'line'
		);
		expect(pointNearPath({ x: 50, y: 4 }, shape, 1)).toBe(false);
		expect(pointNearPath({ x: 50, y: 4 }, shape, 3)).toBe(true);
	});
});
