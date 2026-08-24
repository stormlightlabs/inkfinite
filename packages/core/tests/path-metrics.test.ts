import { describe, expect, it } from 'vitest';
import { Mat3 } from '../src/math';
import {
	flattenPath,
	nearestPointOnPath,
	pathLength,
	pointAtPathDistance,
	tangentAtPathDistance,
	transformPathGeometry,
	trimPathGeometry
} from '../src/path-metrics';
import type { PathGeometry } from '../src/model';

const line: PathGeometry = {
	subpaths: [
		{
			segments: [
				{ type: 'move', to: { x: 0, y: 0 } },
				{ type: 'line', to: { x: 100, y: 0 } }
			],
			closed: false
		}
	],
	fill_rule: 'nonzero'
};

const curve: PathGeometry = {
	subpaths: [
		{
			segments: [
				{ type: 'move', to: { x: 0, y: 0 } },
				{ type: 'quadratic', control: { x: 50, y: 100 }, to: { x: 100, y: 0 } },
				{ type: 'cubic', control_1: { x: 120, y: -100 }, control_2: { x: 180, y: -100 }, to: { x: 200, y: 0 } }
			],
			closed: false
		}
	],
	fill_rule: 'nonzero'
};

describe('native path metrics', () => {
	it('flattens with geometric tolerance instead of fixed curve samples', () => {
		const coarse = flattenPath(curve, 10);
		const fine = flattenPath(curve, 0.1);
		expect(fine.subpaths[0]!.points.length).toBeGreaterThan(coarse.subpaths[0]!.points.length);
		expect(fine.subpaths[0]!.points[0]).toEqual({ x: 0, y: 0 });
		expect(fine.subpaths[0]!.points.at(-1)).toEqual({ x: 200, y: 0 });
	});

	it('measures, locates, and finds the nearest point on a line', () => {
		expect(pathLength(line, 0.1)).toBe(100);
		expect(pointAtPathDistance(line, 25, 0.1)).toMatchObject({
			point: { x: 25, y: 0 },
			tangent: { x: 1, y: 0 },
			t: 0.25
		});
		const nearest = nearestPointOnPath(line, { x: 40, y: 20 }, 0.1);
		expect(nearest).toMatchObject({ point: { x: 40, y: 0 }, distance: 40, distanceToPath: 20 });
	});

	it('uses curve tangents and retains curve commands when trimming', () => {
		const length = pathLength(curve, 0.1);
		const tangent = tangentAtPathDistance(curve, length / 4, 0.1);
		expect(tangent).not.toBeNull();
		expect(Math.hypot(tangent!.x, tangent!.y)).toBeCloseTo(1, 8);
		const trimmed = trimPathGeometry(curve, 10, 80, 0.1);
		expect(
			trimmed?.subpaths[0]?.segments.some((segment) => segment.type === 'quadratic' || segment.type === 'cubic')
		).toBe(true);
	});

	it('measures transformed and degenerate paths deterministically', () => {
		const geometry: PathGeometry = {
			subpaths: [
				{
					segments: [
						{ type: 'move', to: { x: 0, y: 0 } },
						{ type: 'line', to: { x: 0, y: 0 } },
						{ type: 'line', to: { x: 10, y: 0 } }
					],
					closed: false
				}
			],
			fill_rule: 'nonzero'
		};
		const transformed = transformPathGeometry(geometry, [0, 2, 0, -3, 0, 0, 5, 7, 1]);
		expect(pathLength(transformed, 0.1)).toBe(20);
		expect(pointAtPathDistance(transformed, 10, 0.1)?.point).toEqual({ x: 5, y: 17 });
		expect(nearestPointOnPath(transformed, { x: 8, y: 17 }, 0.1)?.distance).toBe(10);
		expect(Mat3.transformPoint(Mat3.translate(5, 7), { x: 1, y: 2 })).toEqual({ x: 6, y: 9 });
	});
});
