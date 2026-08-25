import type { Mat3, Box2 } from './math';
import { Box2 as Box2Ops, Mat3 as Mat3Ops } from './math';
import type { PathGeometry, PathSegment, PathSubpath, TextPath } from './editor-model';
import type { Vec2 } from './math';

/** Default geometric error used by interactive path measurements. */
export const DEFAULT_PATH_METRIC_TOLERANCE = 0.25;

/** A flattened path with one polyline for each source subpath. */
export type FlattenedPath = { subpaths: FlattenedSubpath[]; length: number };

/** One flattened path subpath. */
export type FlattenedSubpath = { points: Vec2[]; closed: boolean; length: number };

/** A point and its source location on a native path. */
export type PathMetricPoint = {
	point: Vec2;
	tangent: Vec2;
	distance: number;
	subpathIndex: number;
	segmentIndex: number;
	t: number;
};

/** The nearest measured point and its distance from the query point. */
export type PathNearestPoint = PathMetricPoint & { distanceToPath: number };

type Sample = { point: Vec2; segmentIndex: number; t: number };
type Curve =
	| { type: 'line'; start: Vec2; end: Vec2 }
	| { type: 'quadratic'; start: Vec2; control: Vec2; end: Vec2 }
	| { type: 'cubic'; start: Vec2; control1: Vec2; control2: Vec2; end: Vec2 };
type Edge = {
	start: Sample;
	end: Sample;
	startDistance: number;
	length: number;
	segmentIndex: number;
	tStart: number;
	tEnd: number;
	curve: Curve;
};
type SegmentRange = { segmentIndex: number; startDistance: number; endDistance: number; tStart: number; tEnd: number };
type MetricSubpath = { samples: Sample[]; edges: Edge[]; ranges: SegmentRange[]; closed: boolean; length: number };
type Metrics = { subpaths: MetricSubpath[]; length: number };

/** Return a transformed copy of native path geometry. */
export function transformPathGeometry(geometry: PathGeometry, transform: Mat3): PathGeometry {
	const transformPoint = (point: Vec2) => Mat3Ops.transformPoint(transform, point);
	return {
		...geometry,
		subpaths: geometry.subpaths.map((subpath) => ({
			...subpath,
			segments: subpath.segments.map((segment) => {
				switch (segment.type) {
					case 'move':
					case 'line':
						return { ...segment, to: transformPoint(segment.to) };
					case 'quadratic':
						return { ...segment, control: transformPoint(segment.control), to: transformPoint(segment.to) };
					case 'cubic':
						return {
							...segment,
							control_1: transformPoint(segment.control_1),
							control_2: transformPoint(segment.control_2),
							to: transformPoint(segment.to)
						};
				}
			})
		}))
	};
}

/** Flatten native path geometry using an adaptive geometric tolerance. */
export function flattenPath(geometry: PathGeometry, tolerance = DEFAULT_PATH_METRIC_TOLERANCE): FlattenedPath {
	const metrics = buildMetrics(geometry, tolerance);
	return {
		length: metrics.length,
		subpaths: metrics.subpaths.map((subpath) => ({
			points: subpath.samples.map((sample) => sample.point),
			closed: subpath.closed,
			length: subpath.length
		}))
	};
}

/** Return the measured length of all subpaths in source order. */
export function pathLength(geometry: PathGeometry, tolerance = DEFAULT_PATH_METRIC_TOLERANCE): number {
	return buildMetrics(geometry, tolerance).length;
}

/** Return the point, tangent, and source location at a distance along a path. */
export function pointAtPathDistance(
	geometry: PathGeometry,
	distance: number,
	tolerance = DEFAULT_PATH_METRIC_TOLERANCE
): PathMetricPoint | null {
	const metrics = buildMetrics(geometry, tolerance);
	const target = clampDistance(distance, metrics.length);
	let offset = 0;
	for (const [subpathIndex, subpath] of metrics.subpaths.entries()) {
		if (target <= offset + subpath.length || subpathIndex === metrics.subpaths.length - 1) {
			return locationAtSubpathDistance(subpath, subpathIndex, target - offset, offset);
		}
		offset += subpath.length;
	}
	return null;
}

/** Return the unit tangent at a distance along a path. */
export function tangentAtPathDistance(
	geometry: PathGeometry,
	distance: number,
	tolerance = DEFAULT_PATH_METRIC_TOLERANCE
): Vec2 | null {
	return pointAtPathDistance(geometry, distance, tolerance)?.tangent ?? null;
}

/** A glyph positioned against a supporting path. */
export type TextPathGlyph = { character: string; point: Vec2; angle: number; advance: number; bounds: Box2 };

/** Layout result shared by the canvas renderer, hit testing, and SVG export. */
export type TextPathLayout = { glyphs: TextPathGlyph[]; anchor: PathMetricPoint | null; bounds: Box2; length: number };

/**
 * Lay out a single-line text run along native path geometry.
 *
 * Distances and font size use the geometry's local coordinate system. Callers
 * can transform the resulting positions with the supporting shape's transform,
 * which keeps path attachments stable when that shape is moved or edited.
 */
export function layoutTextOnPath(
	geometry: PathGeometry,
	text: string,
	fontSize: number,
	attachment: Pick<TextPath, 'offset' | 'align' | 'side' | 'direction'>,
	measureText: (value: string) => number = (value) => fontSize * (value === ' ' ? 0.33 : 0.6)
): TextPathLayout {
	const length = pathLength(geometry);
	const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 1;
	const safeOffset = Number.isFinite(attachment.offset) ? attachment.offset : 0;
	const characters = Array.from(text.replaceAll(/\r?\n/g, ' '));
	const advances = characters.map((character) => {
		const measured = measureText(character);
		return Number.isFinite(measured) && measured > 0 ? measured : safeFontSize * 0.6;
	});
	const textWidth = advances.reduce((total, advance) => total + advance, 0);
	const start =
		attachment.align === 'center'
			? safeOffset - textWidth / 2
			: attachment.align === 'end'
				? safeOffset - textWidth
				: safeOffset;
	const orientedAnchorDistance = Math.max(0, Math.min(length, safeOffset));
	const anchorDistance =
		attachment.direction === 'reverse' ? length - orientedAnchorDistance : orientedAnchorDistance;
	const anchor = length > 0 ? pointAtPathDistance(geometry, anchorDistance) : null;
	const glyphs: TextPathGlyph[] = [];
	let advanceOffset = 0;
	for (const [index, character] of characters.entries()) {
		const advance = advances[index]!;
		const orientedDistance = start + advanceOffset + advance / 2;
		advanceOffset += advance;
		if (length <= 0 || orientedDistance < 0 || orientedDistance > length) continue;
		const distance = attachment.direction === 'reverse' ? length - orientedDistance : orientedDistance;
		const metric = pointAtPathDistance(geometry, distance);
		if (!metric) continue;
		const tangent =
			attachment.direction === 'reverse' ? { x: -metric.tangent.x, y: -metric.tangent.y } : metric.tangent;
		const angle = Math.atan2(tangent.y, tangent.x);
		const leftNormal = { x: tangent.y, y: -tangent.x };
		const normal = attachment.side === 'left' ? leftNormal : { x: -leftNormal.x, y: -leftNormal.y };
		const baseline = {
			x: metric.point.x + normal.x * (attachment.side === 'right' ? safeFontSize : 0),
			y: metric.point.y + normal.y * (attachment.side === 'right' ? safeFontSize : 0)
		};
		const top = { x: Math.sin(angle) * safeFontSize * 0.9, y: -Math.cos(angle) * safeFontSize * 0.9 };
		const axis = { x: (tangent.x * advance) / 2, y: (tangent.y * advance) / 2 };
		const corners = [
			{ x: baseline.x - axis.x, y: baseline.y - axis.y },
			{ x: baseline.x + axis.x, y: baseline.y + axis.y },
			{ x: baseline.x - axis.x + top.x, y: baseline.y - axis.y + top.y },
			{ x: baseline.x + axis.x + top.x, y: baseline.y + axis.y + top.y }
		];
		glyphs.push({ character, point: baseline, angle, advance, bounds: Box2Ops.fromPoints(corners) });
	}
	const points = glyphs.flatMap((glyph) => [glyph.bounds.min, glyph.bounds.max]);
	if (anchor) points.push(anchor.point);
	return { glyphs, anchor, bounds: Box2Ops.fromPoints(points), length };
}

/** Find the closest point on a flattened path and its distance along the path. */
export function nearestPointOnPath(
	geometry: PathGeometry,
	query: Vec2,
	tolerance = DEFAULT_PATH_METRIC_TOLERANCE
): PathNearestPoint | null {
	const metrics = buildMetrics(geometry, tolerance);
	let best: PathNearestPoint | null = null;
	let offset = 0;
	for (const [subpathIndex, subpath] of metrics.subpaths.entries()) {
		for (const edge of subpath.edges) {
			const projection = projectToSegment(query, edge.start.point, edge.end.point);
			const ratio = projection.ratio;
			const t = edge.tStart + (edge.tEnd - edge.tStart) * ratio;
			const point = curvePoint(edge.curve, t);
			const distanceToPath = distance(query, point);
			const candidate: PathNearestPoint = {
				point,
				tangent: tangentForEdge(edge, t, subpath),
				distance: offset + edge.startDistance + edge.length * ratio,
				distanceToPath,
				subpathIndex,
				segmentIndex: edge.segmentIndex,
				t
			};
			if (
				best === null ||
				distanceToPath < best.distanceToPath - 1e-12 ||
				(Math.abs(distanceToPath - best.distanceToPath) <= 1e-12 && candidate.distance < best.distance)
			)
				best = candidate;
		}
		if (subpath.edges.length === 0 && subpath.samples[0]) {
			const sample = subpath.samples[0];
			const distanceToPath = distance(query, sample.point);
			if (best === null || distanceToPath < best.distanceToPath) {
				best = {
					point: sample.point,
					tangent: { x: 0, y: 0 },
					distance: offset,
					distanceToPath,
					subpathIndex,
					segmentIndex: 0,
					t: 0
				};
			}
		}
		offset += subpath.length;
	}
	return best;
}

/** Trim a path to the inclusive distance interval `[start, end]`. */
export function trimPathGeometry(
	geometry: PathGeometry,
	start: number,
	end: number,
	tolerance = DEFAULT_PATH_METRIC_TOLERANCE
): PathGeometry | null {
	const metrics = buildMetrics(geometry, tolerance);
	if (metrics.subpaths.length === 0) return null;
	if (metrics.length <= 0) {
		const first = geometry.subpaths[0]?.segments[0];
		return first
			? { subpaths: [{ segments: [{ ...first }], closed: false }], fill_rule: geometry.fill_rule }
			: null;
	}
	const from = clampDistance(start, metrics.length);
	const to = clampDistance(end, metrics.length);
	if (to < from) return null;
	if (from <= 0 && to >= metrics.length) return structuredClone(geometry);

	const subpaths: PathSubpath[] = [];
	let offset = 0;
	for (const [subpathIndex, metricSubpath] of metrics.subpaths.entries()) {
		const localStart = Math.max(0, from - offset);
		const localEnd = Math.min(metricSubpath.length, to - offset);
		if (localEnd < localStart) {
			offset += metricSubpath.length;
			continue;
		}
		const source = geometry.subpaths[subpathIndex]!;
		const segments: PathSegment[] = [];
		for (const range of metricSubpath.ranges) {
			const rangeStart = Math.max(localStart, range.startDistance);
			const rangeEnd = Math.min(localEnd, range.endDistance);
			if (
				rangeEnd < rangeStart ||
				Math.abs(rangeEnd - rangeStart) <= Number.EPSILON ||
				range.endDistance - range.startDistance <= Number.EPSILON
			)
				continue;
			const rangeLength = range.endDistance - range.startDistance;
			const t0 = range.tStart + ((rangeStart - range.startDistance) / rangeLength) * (range.tEnd - range.tStart);
			const t1 = range.tStart + ((rangeEnd - range.startDistance) / rangeLength) * (range.tEnd - range.tStart);
			const curve = sourceCurve(source, range.segmentIndex);
			const clampedStart = Math.max(0, Math.min(1, t0));
			const clampedEnd = Math.max(0, Math.min(1, t1));
			if (segments.length === 0) segments.push({ type: 'move', to: curvePoint(curve, clampedStart) });
			segments.push(curveToPathSegment(trimCurve(curve, clampedStart, clampedEnd)));
		}
		if (segments.length === 0) {
			const point = locationAtSubpathDistance(metricSubpath, subpathIndex, localStart, offset).point;
			segments.push({ type: 'move', to: point });
		}
		subpaths.push({ segments, closed: false });
		offset += metricSubpath.length;
	}
	return subpaths.length === 0 ? null : { subpaths, fill_rule: geometry.fill_rule };
}

function buildMetrics(geometry: PathGeometry, tolerance: number): Metrics {
	const safeTolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : DEFAULT_PATH_METRIC_TOLERANCE;
	const subpaths = geometry.subpaths.map((subpath) => buildSubpath(subpath, safeTolerance));
	return { subpaths, length: subpaths.reduce((total, subpath) => total + subpath.length, 0) };
}

function buildSubpath(subpath: PathSubpath, tolerance: number): MetricSubpath {
	const first = subpath.segments[0];
	if (!first || first.type !== 'move')
		return { samples: [], edges: [], ranges: [], closed: subpath.closed, length: 0 };
	const start: Sample = { point: first.to, segmentIndex: 0, t: 0 };
	const result: MetricSubpath = { samples: [start], edges: [], ranges: [], closed: subpath.closed, length: 0 };
	let current = start;
	for (let segmentIndex = 1; segmentIndex < subpath.segments.length; segmentIndex += 1) {
		const curve = sourceCurve(subpath, segmentIndex);
		let segmentStart: Sample = { point: current.point, segmentIndex, t: 0 };
		for (const end of flattenCurve(curve, segmentIndex, tolerance)) {
			appendEdge(result, segmentStart, end, curve);
			segmentStart = end;
			current = end;
		}
	}
	if (subpath.closed) {
		const closing: Curve = { type: 'line', start: current.point, end: start.point };
		const closingStart: Sample = { point: current.point, segmentIndex: subpath.segments.length, t: 0 };
		const end: Sample = { point: start.point, segmentIndex: subpath.segments.length, t: 1 };
		appendEdge(result, closingStart, end, closing);
	}
	result.ranges = rangesFromEdges(result.edges);
	return result;
}

function appendEdge(subpath: MetricSubpath, start: Sample, end: Sample, curve: Curve): void {
	const edge: Edge = {
		start,
		end,
		startDistance: subpath.length,
		length: distance(start.point, end.point),
		segmentIndex: end.segmentIndex,
		tStart: start.t,
		tEnd: end.t,
		curve
	};
	subpath.edges.push(edge);
	subpath.samples.push(end);
	subpath.length += edge.length;
}

function rangesFromEdges(edges: Edge[]): SegmentRange[] {
	const ranges: SegmentRange[] = [];
	for (const edge of edges) {
		const previous = ranges.at(-1);
		if (previous?.segmentIndex === edge.segmentIndex) {
			previous.endDistance = edge.startDistance + edge.length;
			previous.tEnd = edge.tEnd;
		} else {
			ranges.push({
				segmentIndex: edge.segmentIndex,
				startDistance: edge.startDistance,
				endDistance: edge.startDistance + edge.length,
				tStart: edge.tStart,
				tEnd: edge.tEnd
			});
		}
	}
	return ranges;
}

function sourceCurve(subpath: PathSubpath, segmentIndex: number): Curve {
	if (segmentIndex === subpath.segments.length) {
		return {
			type: 'line',
			start: subpath.segments.at(-1)?.to ?? { x: 0, y: 0 },
			end: subpath.segments[0]?.to ?? { x: 0, y: 0 }
		};
	}
	const segment = subpath.segments[segmentIndex];
	const start = subpath.segments[segmentIndex - 1]?.to ?? segment?.to ?? { x: 0, y: 0 };
	if (!segment || segment.type === 'move') return { type: 'line', start, end: segment?.to ?? start };
	if (segment.type === 'line') return { type: 'line', start, end: segment.to };
	if (segment.type === 'quadratic') return { type: 'quadratic', start, control: segment.control, end: segment.to };
	return { type: 'cubic', start, control1: segment.control_1, control2: segment.control_2, end: segment.to };
}

function flattenCurve(curve: Curve, segmentIndex: number, tolerance: number): Sample[] {
	if (curve.type === 'line') return [{ point: curve.end, segmentIndex, t: 1 }];
	const result: Sample[] = [];
	if (curve.type === 'quadratic') {
		flattenQuadratic(curve.start, curve.control, curve.end, 0, 1, segmentIndex, tolerance, 0, result);
	} else {
		flattenCubic(curve.start, curve.control1, curve.control2, curve.end, 0, 1, segmentIndex, tolerance, 0, result);
	}
	return result;
}

function flattenQuadratic(
	start: Vec2,
	control: Vec2,
	end: Vec2,
	tStart: number,
	tEnd: number,
	segmentIndex: number,
	tolerance: number,
	depth: number,
	output: Sample[]
): void {
	if (depth >= 24 || pointLineDistance(control, start, end) <= tolerance) {
		output.push({ point: end, segmentIndex, t: tEnd });
		return;
	}
	const first = midpoint(start, control);
	const second = midpoint(control, end);
	const middle = midpoint(first, second);
	const middleT = (tStart + tEnd) / 2;
	flattenQuadratic(start, first, middle, tStart, middleT, segmentIndex, tolerance, depth + 1, output);
	flattenQuadratic(middle, second, end, middleT, tEnd, segmentIndex, tolerance, depth + 1, output);
}

function flattenCubic(
	start: Vec2,
	control1: Vec2,
	control2: Vec2,
	end: Vec2,
	tStart: number,
	tEnd: number,
	segmentIndex: number,
	tolerance: number,
	depth: number,
	output: Sample[]
): void {
	if (
		depth >= 24 ||
		Math.max(pointLineDistance(control1, start, end), pointLineDistance(control2, start, end)) <= tolerance
	) {
		output.push({ point: end, segmentIndex, t: tEnd });
		return;
	}
	const first = midpoint(start, control1);
	const bridge = midpoint(control1, control2);
	const last = midpoint(control2, end);
	const second = midpoint(first, bridge);
	const third = midpoint(bridge, last);
	const middle = midpoint(second, third);
	const middleT = (tStart + tEnd) / 2;
	flattenCubic(start, first, second, middle, tStart, middleT, segmentIndex, tolerance, depth + 1, output);
	flattenCubic(middle, third, last, end, middleT, tEnd, segmentIndex, tolerance, depth + 1, output);
}

function locationAtSubpathDistance(
	subpath: MetricSubpath,
	subpathIndex: number,
	distanceAlongSubpath: number,
	pathOffset: number
): PathMetricPoint {
	const distanceAlong = clampDistance(distanceAlongSubpath, subpath.length);
	const edgeIndex = subpath.edges.findIndex((edge) => distanceAlong <= edge.startDistance + edge.length);
	const edge = subpath.edges[edgeIndex >= 0 ? edgeIndex : subpath.edges.length - 1];
	if (!edge) {
		const sample = subpath.samples[0] ?? { point: { x: 0, y: 0 }, segmentIndex: 0, t: 0 };
		return {
			point: sample.point,
			tangent: { x: 0, y: 0 },
			distance: pathOffset,
			subpathIndex,
			segmentIndex: 0,
			t: 0
		};
	}
	const ratio =
		edge.length <= Number.EPSILON
			? 0
			: Math.max(0, Math.min(1, (distanceAlong - edge.startDistance) / edge.length));
	const t = edge.tStart + (edge.tEnd - edge.tStart) * ratio;
	return {
		point: curvePoint(edge.curve, t),
		tangent: tangentForEdge(edge, t, subpath),
		distance: pathOffset + edge.startDistance + edge.length * ratio,
		subpathIndex,
		segmentIndex: edge.segmentIndex,
		t
	};
}

function tangentForEdge(edge: Edge, t: number, subpath: MetricSubpath): Vec2 {
	let tangent: Vec2;
	if (edge.curve.type === 'line') tangent = subtract(edge.curve.end, edge.curve.start);
	else if (edge.curve.type === 'quadratic') {
		tangent = add(
			scale(subtract(edge.curve.control, edge.curve.start), 1 - t),
			scale(subtract(edge.curve.end, edge.curve.control), t)
		);
	} else {
		const inverse = 1 - t;
		tangent = add(
			add(
				scale(subtract(edge.curve.control1, edge.curve.start), inverse * inverse),
				scale(subtract(edge.curve.control2, edge.curve.control1), 2 * inverse * t)
			),
			scale(subtract(edge.curve.end, edge.curve.control2), t * t)
		);
	}
	const normalized = normalize(tangent);
	if (normalized.x !== 0 || normalized.y !== 0) return normalized;
	for (const candidate of subpath.edges) {
		const fallback = normalize(subtract(candidate.end.point, candidate.start.point));
		if (fallback.x !== 0 || fallback.y !== 0) return fallback;
	}
	return { x: 0, y: 0 };
}

function projectToSegment(point: Vec2, start: Vec2, end: Vec2): { point: Vec2; ratio: number } {
	const direction = subtract(end, start);
	const lengthSquared = direction.x * direction.x + direction.y * direction.y;
	if (lengthSquared <= Number.EPSILON) return { point: start, ratio: 0 };
	const ratio = Math.max(
		0,
		Math.min(1, (subtract(point, start).x * direction.x + subtract(point, start).y * direction.y) / lengthSquared)
	);
	return { point: lerp(start, end, ratio), ratio };
}

function trimCurve(curve: Curve, start: number, end: number): Curve {
	if (start <= Number.EPSILON && end >= 1 - Number.EPSILON) return curve;
	const [, right] = splitCurve(curve, start);
	const ratio = start >= 1 - Number.EPSILON ? 0 : (end - start) / (1 - start);
	return splitCurve(right, Math.max(0, Math.min(1, ratio)))[0];
}

function splitCurve(curve: Curve, t: number): [Curve, Curve] {
	const clamped = Math.max(0, Math.min(1, t));
	if (curve.type === 'line') {
		const middle = lerp(curve.start, curve.end, clamped);
		return [
			{ type: 'line', start: curve.start, end: middle },
			{ type: 'line', start: middle, end: curve.end }
		];
	}
	if (curve.type === 'quadratic') {
		const first = lerp(curve.start, curve.control, clamped);
		const second = lerp(curve.control, curve.end, clamped);
		const middle = lerp(first, second, clamped);
		return [
			{ type: 'quadratic', start: curve.start, control: first, end: middle },
			{ type: 'quadratic', start: middle, control: second, end: curve.end }
		];
	}
	const first = lerp(curve.start, curve.control1, clamped);
	const bridge = lerp(curve.control1, curve.control2, clamped);
	const last = lerp(curve.control2, curve.end, clamped);
	const firstBridge = lerp(first, bridge, clamped);
	const secondBridge = lerp(bridge, last, clamped);
	const middle = lerp(firstBridge, secondBridge, clamped);
	return [
		{ type: 'cubic', start: curve.start, control1: first, control2: firstBridge, end: middle },
		{ type: 'cubic', start: middle, control1: secondBridge, control2: last, end: curve.end }
	];
}

function curveToPathSegment(curve: Curve): PathSegment {
	if (curve.type === 'line') return { type: 'line', to: curve.end };
	if (curve.type === 'quadratic') return { type: 'quadratic', control: curve.control, to: curve.end };
	return { type: 'cubic', control_1: curve.control1, control_2: curve.control2, to: curve.end };
}

function curvePoint(curve: Curve, t: number): Vec2 {
	if (curve.type === 'line') return lerp(curve.start, curve.end, t);
	if (curve.type === 'quadratic') {
		const inverse = 1 - t;
		return {
			x: inverse * inverse * curve.start.x + 2 * inverse * t * curve.control.x + t * t * curve.end.x,
			y: inverse * inverse * curve.start.y + 2 * inverse * t * curve.control.y + t * t * curve.end.y
		};
	}
	const inverse = 1 - t;
	return {
		x:
			inverse ** 3 * curve.start.x +
			3 * inverse ** 2 * t * curve.control1.x +
			3 * inverse * t ** 2 * curve.control2.x +
			t ** 3 * curve.end.x,
		y:
			inverse ** 3 * curve.start.y +
			3 * inverse ** 2 * t * curve.control1.y +
			3 * inverse * t ** 2 * curve.control2.y +
			t ** 3 * curve.end.y
	};
}

function clampDistance(value: number, length: number): number {
	if (!Number.isFinite(value)) return value < 0 ? 0 : length;
	return Math.max(0, Math.min(length, value));
}

function pointLineDistance(point: Vec2, start: Vec2, end: Vec2): number {
	return distance(point, projectToSegment(point, start, end).point);
}

function distance(left: Vec2, right: Vec2): number {
	return Math.hypot(left.x - right.x, left.y - right.y);
}

function normalize(point: Vec2): Vec2 {
	const length = Math.hypot(point.x, point.y);
	return length <= Number.EPSILON ? { x: 0, y: 0 } : { x: point.x / length, y: point.y / length };
}

function midpoint(left: Vec2, right: Vec2): Vec2 {
	return lerp(left, right, 0.5);
}

function lerp(start: Vec2, end: Vec2, t: number): Vec2 {
	return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function subtract(left: Vec2, right: Vec2): Vec2 {
	return { x: left.x - right.x, y: left.y - right.y };
}

function add(left: Vec2, right: Vec2): Vec2 {
	return { x: left.x + right.x, y: left.y + right.y };
}

function scale(point: Vec2, factor: number): Vec2 {
	return { x: point.x * factor, y: point.y * factor };
}
