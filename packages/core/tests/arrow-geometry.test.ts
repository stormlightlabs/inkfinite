import { describe, expect, it } from 'vitest';
import {
	arrowHeadGeometry,
	arrowLabelPlacement,
	arrowShaftGeometry,
	pathLength,
	type ArrowStyle,
	type PathGeometry
} from '../src';

const quadratic: PathGeometry = {
	subpaths: [
		{
			segments: [
				{ type: 'move', to: { x: 0, y: 0 } },
				{ type: 'quadratic', control: { x: 0, y: 100 }, to: { x: 100, y: 100 } }
			],
			closed: false
		}
	],
	fill_rule: 'nonzero'
};

const diagonal: PathGeometry = {
	subpaths: [
		{
			segments: [
				{ type: 'move', to: { x: 0, y: 0 } },
				{ type: 'line', to: { x: 100, y: 100 } }
			],
			closed: false
		}
	],
	fill_rule: 'nonzero'
};

describe('path-aware arrow geometry', () => {
	it('orients heads from curve endpoint tangents', () => {
		const start = arrowHeadGeometry(quadratic, true);
		const end = arrowHeadGeometry(quadratic, false);

		expect(start?.tangent.y).toBeGreaterThan(0.99);
		expect(start?.direction.y).toBeLessThan(-0.99);
		expect(end?.tangent.x).toBeGreaterThan(0.99);
		expect(end?.direction.x).toBeGreaterThan(0.99);
	});

	it('places labels by path distance and local normal offset', () => {
		const placement = arrowLabelPlacement(diagonal, { text: 'route', align: 'center', offset: 10 });

		expect(placement?.distance).toBeCloseTo(pathLength(diagonal) / 2);
		expect(placement?.point.x).toBeCloseTo(50 - 10 / Math.sqrt(2));
		expect(placement?.point.y).toBeCloseTo(50 + 10 / Math.sqrt(2));
	});

	it('supports an explicit along-path label distance independently of its normal offset', () => {
		const placement = arrowLabelPlacement(diagonal, { text: 'route', align: 'center', offset: -8, distance: 25 });

		expect(placement?.distance).toBe(25);
		expect(placement?.point.x).toBeCloseTo((25 + 8) / Math.sqrt(2));
		expect(placement?.point.y).toBeCloseTo((25 - 8) / Math.sqrt(2));
	});

	it('trims the shaft for filled triangle heads without changing the route', () => {
		const style: ArrowStyle = { stroke: '#000', width: 2, headEndStyle: 'triangle' };
		const shaft = arrowShaftGeometry(diagonal, style);
		const first = shaft.subpaths[0]?.segments[0];

		expect(first?.type).toBe('move');
		if (first?.type === 'move') expect(first.to.x).toBe(0);
		const last = shaft.subpaths[0]?.segments.at(-1);
		expect(last?.type).toBe('line');
		if (last?.type === 'line') expect(last.to.x).toBeLessThan(100);
	});
});
