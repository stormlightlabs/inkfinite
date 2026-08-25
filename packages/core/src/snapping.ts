import { shapeBounds } from './geom';
import type { Box2, Vec2 } from './math';
import type { EditorState } from './reactivity';
import { getInteractiveShapesOnCurrentPage } from './reactivity';
import type { EditorShapeRecord } from './editor-model';

/** A line shown while an object is aligned to another object. */
export type SnapGuide = {
	axis: 'x' | 'y';
	position: number;
	kind: 'grid' | 'edge' | 'center' | 'corner' | 'gap' | 'handle';
	/** Optional world-space extent. Omitted guides span the viewport. */
	start?: number;
	end?: number;
};

/** Settings used by geometry snapping. */
export type SnapOptions = {
	snapEnabled: boolean;
	gridEnabled: boolean;
	gridSize: number;
	/** Enables object, handle, and equal-gap snapping. Defaults to true. */
	objectSnapEnabled?: boolean;
	/** Maximum world-space distance at which a target attracts a point. */
	snapDistance?: number;
};

/** Result of snapping a pointer or a translation. */
export type SnapResult = { point: Vec2; delta: Vec2; guides: SnapGuide[] };

const DEFAULT_SNAP_DISTANCE = 8;

type Feature = { position: number; kind: SnapGuide['kind'] };

/**
 * Snap a point to the grid and visible geometry on the current page.
 *
 * `excludedIds` prevents a selected shape from snapping to itself while it is
 * being moved or while one of its handles is being edited.
 */
export function snapPoint(
	state: EditorState,
	point: Vec2,
	excludedIds: Iterable<string> = [],
	options: SnapOptions
): SnapResult {
	const excluded = new Set(excludedIds);
	const distance = getSnapDistance(options);
	let snapped = { ...point };
	const guides: SnapGuide[] = [];

	if (options.snapEnabled && options.gridEnabled && validGridSize(options.gridSize)) {
		const x = Math.round(point.x / options.gridSize) * options.gridSize;
		const y = Math.round(point.y / options.gridSize) * options.gridSize;
		if (Math.abs(x - point.x) <= distance) {
			snapped.x = x;
			guides.push({ axis: 'x', position: x, kind: 'grid' });
		}
		if (Math.abs(y - point.y) <= distance) {
			snapped.y = y;
			guides.push({ axis: 'y', position: y, kind: 'grid' });
		}
	}

	if (options.snapEnabled && options.objectSnapEnabled !== false) {
		const candidates = getInteractiveShapesOnCurrentPage(state).filter((shape) => !excluded.has(shape.id));
		const xMatch = closestFeature(snapped.x, candidates, 'x', distance);
		const yMatch = closestFeature(snapped.y, candidates, 'y', distance);
		const corner = xMatch?.kind === 'edge' && yMatch?.kind === 'edge';
		if (xMatch) {
			snapped.x = xMatch.position;
			guides.push({ axis: 'x', position: xMatch.position, kind: corner ? 'corner' : xMatch.kind });
		}
		if (yMatch) {
			snapped.y = yMatch.position;
			guides.push({ axis: 'y', position: yMatch.position, kind: corner ? 'corner' : yMatch.kind });
		}
	}

	return { point: snapped, delta: { x: snapped.x - point.x, y: snapped.y - point.y }, guides };
}

/**
 * Snap a translated selection. The shapes in `movingShapes` must be the
 * snapshots from the beginning of the gesture, not the current preview.
 */
export function snapTranslation(
	state: EditorState,
	movingShapes: Iterable<EditorShapeRecord>,
	leadPosition: Vec2,
	delta: Vec2,
	options: SnapOptions
): SnapResult {
	const moving = [...movingShapes];
	if (!options.snapEnabled || moving.length === 0) {
		return { point: { x: leadPosition.x + delta.x, y: leadPosition.y + delta.y }, delta, guides: [] };
	}

	const movingIds = new Set(moving.map((shape) => shape.id));
	const movingBounds = combinedBounds(moving.map(shapeBounds));
	if (!movingBounds) {
		return { point: { x: leadPosition.x + delta.x, y: leadPosition.y + delta.y }, delta, guides: [] };
	}

	const distance = getSnapDistance(options);
	let nextDelta = { ...delta };
	const guides: SnapGuide[] = [];
	const targets = getInteractiveShapesOnCurrentPage(state).filter((shape) => !movingIds.has(shape.id));

	if (options.gridEnabled && validGridSize(options.gridSize)) {
		const gridDelta = {
			x:
				Math.round((leadPosition.x + delta.x) / options.gridSize) * options.gridSize -
				(leadPosition.x + delta.x),
			y: Math.round((leadPosition.y + delta.y) / options.gridSize) * options.gridSize - (leadPosition.y + delta.y)
		};
		if (Math.abs(gridDelta.x) <= distance) {
			nextDelta.x += gridDelta.x;
			guides.push({ axis: 'x', position: leadPosition.x + nextDelta.x, kind: 'grid' });
		}
		if (Math.abs(gridDelta.y) <= distance) {
			nextDelta.y += gridDelta.y;
			guides.push({ axis: 'y', position: leadPosition.y + nextDelta.y, kind: 'grid' });
		}
	}

	if (options.objectSnapEnabled !== false) {
		const xMatch = closestTranslationMatch(movingBounds, delta.x, targets, 'x', distance);
		const yMatch = closestTranslationMatch(movingBounds, delta.y, targets, 'y', distance);
		const corner = xMatch?.kind === 'edge' && yMatch?.kind === 'edge';
		if (xMatch) {
			nextDelta.x = xMatch.delta;
			guides.push({ axis: 'x', position: xMatch.position, kind: corner ? 'corner' : xMatch.kind });
		}
		if (yMatch) {
			nextDelta.y = yMatch.delta;
			guides.push({ axis: 'y', position: yMatch.position, kind: corner ? 'corner' : yMatch.kind });
		}

		const gapMatchX = equalGapMatch(movingBounds, delta.x, targets, 'x', distance);
		const gapMatchY = equalGapMatch(movingBounds, delta.y, targets, 'y', distance);
		if (gapMatchX && (!xMatch || Math.abs(gapMatchX.delta - delta.x) < Math.abs(xMatch.delta - delta.x))) {
			nextDelta.x = gapMatchX.delta;
			guides.push({ axis: 'x', position: gapMatchX.position, kind: 'gap' });
		}
		if (gapMatchY && (!yMatch || Math.abs(gapMatchY.delta - delta.y) < Math.abs(yMatch.delta - delta.y))) {
			nextDelta.y = gapMatchY.delta;
			guides.push({ axis: 'y', position: gapMatchY.position, kind: 'gap' });
		}
	}

	return {
		point: { x: leadPosition.x + nextDelta.x, y: leadPosition.y + nextDelta.y },
		delta: nextDelta,
		guides: uniqueGuides(guides)
	};
}

/** Snap a segment endpoint to a multiple of the given angle in degrees. */
export function snapAngle(start: Vec2, point: Vec2, stepDeg = 15): Vec2 {
	const dx = point.x - start.x;
	const dy = point.y - start.y;
	const length = Math.hypot(dx, dy);
	if (length === 0 || !Number.isFinite(stepDeg) || stepDeg <= 0) return point;
	const step = (stepDeg * Math.PI) / 180;
	const angle = Math.atan2(dy, dx);
	const snapped = Math.round(angle / step) * step;
	return { x: start.x + Math.cos(snapped) * length, y: start.y + Math.sin(snapped) * length };
}

function closestFeature(value: number, shapes: EditorShapeRecord[], axis: 'x' | 'y', distance: number): Feature | null {
	let match: Feature | null = null;
	let best = distance + Number.EPSILON;
	for (const shape of shapes) {
		const bounds = shapeBounds(shape);
		const features = axisFeatures(bounds, axis);
		for (const feature of features) {
			const difference = Math.abs(feature.position - value);
			if (difference < best) {
				best = difference;
				match = feature;
			}
		}
	}
	return match;
}

function closestTranslationMatch(
	moving: Box2,
	delta: number,
	shapes: EditorShapeRecord[],
	axis: 'x' | 'y',
	distance: number
): { delta: number; position: number; kind: SnapGuide['kind'] } | null {
	let match: { delta: number; position: number; kind: SnapGuide['kind'] } | null = null;
	let best = distance + Number.EPSILON;
	const movingFeatures = axisFeatures(moving, axis);
	for (const shape of shapes) {
		for (const target of axisFeatures(shapeBounds(shape), axis)) {
			for (const movingFeature of movingFeatures) {
				const difference = target.position - (movingFeature.position + delta);
				if (Math.abs(difference) < best) {
					best = Math.abs(difference);
					match = { delta: delta + difference, position: target.position, kind: target.kind };
				}
			}
		}
	}
	return match;
}

function equalGapMatch(
	moving: Box2,
	delta: number,
	shapes: EditorShapeRecord[],
	axis: 'x' | 'y',
	distance: number
): { delta: number; position: number } | null {
	const intervals = shapes
		.map((shape) => {
			const bounds = shapeBounds(shape);
			return axis === 'x' ? { min: bounds.min.x, max: bounds.max.x } : { min: bounds.min.y, max: bounds.max.y };
		})
		.sort((a, b) => a.min - b.min);
	let match: { delta: number; position: number } | null = null;
	let best = distance + Number.EPSILON;
	for (let index = 1; index < intervals.length; index += 1) {
		const previous = intervals[index - 1];
		const next = intervals[index];
		const gap = next.min - previous.max;
		if (gap <= 0) continue;
		const candidates = [
			{ position: previous.min - gap, edge: axis === 'x' ? moving.max.x : moving.max.y },
			{ position: next.max + gap, edge: axis === 'x' ? moving.min.x : moving.min.y }
		];
		for (const candidate of candidates) {
			const difference = candidate.position - (candidate.edge + delta);
			if (Math.abs(difference) < best) {
				best = Math.abs(difference);
				match = { delta: delta + difference, position: candidate.position };
			}
		}
	}
	return match;
}

function axisFeatures(bounds: Box2, axis: 'x' | 'y'): Feature[] {
	if (axis === 'x') {
		return [
			{ position: bounds.min.x, kind: 'edge' },
			{ position: (bounds.min.x + bounds.max.x) / 2, kind: 'center' },
			{ position: bounds.max.x, kind: 'edge' }
		];
	}
	return [
		{ position: bounds.min.y, kind: 'edge' },
		{ position: (bounds.min.y + bounds.max.y) / 2, kind: 'center' },
		{ position: bounds.max.y, kind: 'edge' }
	];
}

function combinedBounds(bounds: Box2[]): Box2 | null {
	if (bounds.length === 0) return null;
	return bounds.reduce((combined, next) => ({
		min: { x: Math.min(combined.min.x, next.min.x), y: Math.min(combined.min.y, next.min.y) },
		max: { x: Math.max(combined.max.x, next.max.x), y: Math.max(combined.max.y, next.max.y) }
	}));
}

function getSnapDistance(options: SnapOptions): number {
	return Number.isFinite(options.snapDistance) && (options.snapDistance ?? 0) > 0
		? (options.snapDistance as number)
		: DEFAULT_SNAP_DISTANCE;
}

function validGridSize(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

function uniqueGuides(guides: SnapGuide[]): SnapGuide[] {
	return guides.filter(
		(guide, index) =>
			guides.findIndex(
				(candidate) =>
					candidate.axis === guide.axis &&
					candidate.position === guide.position &&
					candidate.kind === guide.kind
			) === index
	);
}
