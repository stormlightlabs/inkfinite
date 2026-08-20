import { describe, expect, it } from 'vitest';
import { boundsFromOutline, computeOutline, pathGeometryBounds } from '../src/geom';
import type { BrushConfig, PathGeometry, StrokePoint } from '../src/model';
import fixture from '../../../fixtures/native/geometry/committed.json';

type BoundsFixture = { x: number; y: number; width: number; height: number };

function expectBounds(actual: { min: { x: number; y: number }; max: { x: number; y: number } }, expected: BoundsFixture) {
	expect(actual.min.x).toBeCloseTo(expected.x, 12);
	expect(actual.min.y).toBeCloseTo(expected.y, 12);
	expect(actual.max.x - actual.min.x).toBeCloseTo(expected.width, 12);
	expect(actual.max.y - actual.min.y).toBeCloseTo(expected.height, 12);
}

describe('committed geometry fixtures', () => {
	it('keeps TypeScript path previews aligned with canonical path bounds', () => {
		for (const testCase of fixture.path_cases) {
			const bounds = pathGeometryBounds(testCase.geometry as PathGeometry);
			expectBounds(bounds, testCase.expected_bounds);
		}
	});

	it('keeps the TypeScript freehand preview fixture explicit beside Rust committed bounds', () => {
		for (const testCase of fixture.stroke_cases) {
			const brush = testCase.brush as BrushConfig;
			const outline = computeOutline(testCase.points as StrokePoint[], brush);
			expect(outline.length).toBeGreaterThan(0);
			expectBounds(boundsFromOutline(outline), testCase.preview_bounds);
			for (const field of ['x', 'y', 'width', 'height'] as const) {
				expect(Math.abs(testCase.preview_bounds[field] - testCase.committed_bounds[field])).toBeLessThan(3);
			}
		}
	});
});
