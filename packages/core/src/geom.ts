import getStroke from 'perfect-freehand';
import type { Box2, Vec2 } from './math';
import { Box2 as Box2Ops, Mat3, Vec2 as Vec2Ops } from './math';
import type {
	ArrowShape,
	BrushConfig,
	EllipseShape,
	LineShape,
	MarkdownShape,
	PathAnchorRef,
	PathControlRef,
	PathGeometry,
	PathSegment,
	PathSegmentRef,
	PathShape,
	RectShape,
	ShapeRecord,
	StrokePoint,
	StrokeShape,
	TextShape
} from './model';
import type { EditorState } from './reactivity';
import { getInteractiveShapesOnCurrentPage } from './reactivity';

const strokeOutlineCache = new WeakMap<StrokeShape, Vec2[]>();

/** Return the affine matrix that maps a shape's local geometry to world space. */
export function shapeTransform(shape: ShapeRecord): Mat3 {
	if (shape.editorTransform) {
		return [
			shape.editorTransform.a,
			shape.editorTransform.b,
			0,
			shape.editorTransform.c,
			shape.editorTransform.d,
			0,
			shape.editorTransform.e,
			shape.editorTransform.f,
			1
		];
	}
	return Mat3.fromTransform(shape.x, shape.y, shape.rot, 1, 1);
}

/** Transform one local point through a shape's complete world transform. */
export function localToWorld(shape: ShapeRecord, point: Vec2): Vec2 {
	return Mat3.transformPoint(shapeTransform(shape), point);
}

/** Transform one world point into shape-local coordinates. */
export function worldToLocal(point: Vec2, shape: ShapeRecord): Vec2 {
	const inverse = Mat3.invert(shapeTransform(shape));
	return inverse ? Mat3.transformPoint(inverse, point) : { x: point.x - shape.x, y: point.y - shape.y };
}

/** Returns local geometry bounds without applying the shape transform. */
export function localShapeBounds(shape: ShapeRecord): Box2 {
	switch (shape.type) {
		case 'rect':
		case 'ellipse':
		case 'container':
			return Box2Ops.create(0, 0, shape.props.w ?? 0, shape.props.h ?? 0);
		case 'line':
			return Box2Ops.fromPoints([shape.props.a, shape.props.b]);
		case 'arrow':
			return Box2Ops.fromPoints(shape.props.points ?? []);
		case 'text':
			return Box2Ops.create(0, 0, shape.props.w ?? shape.props.fontSize * 10, shape.props.fontSize * 1.2);
		case 'markdown':
			return Box2Ops.create(0, 0, shape.props.w, shape.props.h ?? shape.props.fontSize * 10);
		case 'image':
			return Box2Ops.create(0, 0, shape.props.w, shape.props.h);
		case 'stroke':
			return boundsFromOutline(shape.props.points.length >= 2 ? getStrokeOutline(shape) : []);
		case 'path':
			return pathGeometryBounds(shape.props);
	}
}

function transformLocalBounds(shape: ShapeRecord, bounds: Box2): Box2 {
	const corners = [
		bounds.min,
		{ x: bounds.max.x, y: bounds.min.y },
		bounds.max,
		{ x: bounds.min.x, y: bounds.max.y }
	];
	return Box2Ops.fromPoints(corners.map((point) => localToWorld(shape, point)));
}

/** Get the axis-aligned bounding box of a shape in world coordinates. */
export function shapeBounds(shape: ShapeRecord): Box2 {
	return transformLocalBounds(shape, localShapeBounds(shape));
}

/** Return exact local bounds for path endpoints and Bézier extrema. */
export function pathGeometryBounds(geometry: PathGeometry): Box2 {
	const points: Vec2[] = [];
	for (const subpath of geometry.subpaths) {
		const first = subpath.segments[0];
		if (!first || first.type !== 'move') continue;
		const start = first.to;
		let current = start;
		points.push(current);
		for (const segment of subpath.segments.slice(1)) {
			if (segment.type === 'move') {
				current = segment.to;
				points.push(current);
			} else if (segment.type === 'line') {
				points.push(current, segment.to);
				current = segment.to;
			} else if (segment.type === 'quadratic') {
				points.push(current, segment.to);
				const tx = quadraticExtremum(current.x, segment.control.x, segment.to.x);
				const ty = quadraticExtremum(current.y, segment.control.y, segment.to.y);
				if (tx !== null && tx > 0 && tx < 1)
					points.push(quadraticPoint(current, segment.control, segment.to, tx));
				if (ty !== null && ty > 0 && ty < 1)
					points.push(quadraticPoint(current, segment.control, segment.to, ty));
				current = segment.to;
			} else {
				points.push(current, segment.to);
				for (const [startValue, control1, control2, endValue] of [
					[current.x, segment.control_1.x, segment.control_2.x, segment.to.x],
					[current.y, segment.control_1.y, segment.control_2.y, segment.to.y]
				]) {
					const a = -startValue + 3 * control1 - 3 * control2 + endValue;
					const b = 2 * (startValue - 2 * control1 + control2);
					const c = control1 - startValue;
					for (const t of quadraticRoots(a, b, c)) {
						if (t > 0 && t < 1)
							points.push(cubicPoint(current, segment.control_1, segment.control_2, segment.to, t));
					}
				}
				current = segment.to;
			}
		}
		if (subpath.closed) points.push(current, start);
	}
	return points.length === 0 ? Box2Ops.create(0, 0, 0, 0) : Box2Ops.fromPoints(points);
}

/** Return every anchor destination in a native path. */
export function pathAnchorRefs(shape: PathShape): PathAnchorRef[] {
	return shape.props.subpaths.flatMap((subpath, subpathIndex) =>
		subpath.segments.map((_, segmentIndex) => ({ subpathIndex, segmentIndex }))
	);
}

/** Return the local position of a path anchor reference. */
export function pathAnchorPosition(shape: PathShape, anchor: PathAnchorRef): Vec2 | null {
	return shape.props.subpaths[anchor.subpathIndex]?.segments[anchor.segmentIndex]?.to ?? null;
}

/** Return the local Bézier controls and their owning anchor positions. */
export function pathControlHandles(shape: PathShape): Array<{ ref: PathControlRef; position: Vec2; anchor: Vec2 }> {
	const handles: Array<{ ref: PathControlRef; position: Vec2; anchor: Vec2 }> = [];
	for (const [subpathIndex, subpath] of shape.props.subpaths.entries()) {
		for (const [segmentIndex, segment] of subpath.segments.entries()) {
			if (segment.type === 'quadratic') {
				handles.push({
					ref: { subpathIndex, segmentIndex, control: 'quadratic' },
					position: segment.control,
					anchor: subpath.segments[segmentIndex - 1]?.to ?? segment.to
				});
			} else if (segment.type === 'cubic') {
				handles.push(
					{
						ref: { subpathIndex, segmentIndex, control: 'control_1' },
						position: segment.control_1,
						anchor: subpath.segments[segmentIndex - 1]?.to ?? segment.to
					},
					{
						ref: { subpathIndex, segmentIndex, control: 'control_2' },
						position: segment.control_2,
						anchor: segment.to
					}
				);
			}
		}
	}
	return handles;
}

/** Find the closest path anchor to a world point. */
export function hitTestPathAnchor(shape: PathShape, point: Vec2, tolerance = 10): PathAnchorRef | null {
	let closest: PathAnchorRef | null = null;
	let closestDistance = tolerance;
	for (const anchor of pathAnchorRefs(shape)) {
		const position = pathAnchorPosition(shape, anchor);
		if (!position) continue;
		const distance = Vec2Ops.dist(point, localToWorld(shape, position));
		if (distance <= closestDistance) {
			closestDistance = distance;
			closest = anchor;
		}
	}
	return closest;
}

/** Find the closest Bézier control handle to a world point. */
export function hitTestPathControl(shape: PathShape, point: Vec2, tolerance = 10): PathControlRef | null {
	let closest: PathControlRef | null = null;
	let closestDistance = tolerance;
	for (const handle of pathControlHandles(shape)) {
		const distance = Vec2Ops.dist(point, localToWorld(shape, handle.position));
		if (distance <= closestDistance) {
			closestDistance = distance;
			closest = handle.ref;
		}
	}
	return closest;
}

/** Find the rendered path segment and curve parameter closest to a world point. */
export function hitTestPathSegment(shape: PathShape, point: Vec2, tolerance = 10): PathSegmentRef | null {
	let closest: PathSegmentRef | null = null;
	let closestDistance = tolerance;
	for (const [subpathIndex, subpath] of shape.props.subpaths.entries()) {
		const first = subpath.segments[0];
		if (!first || first.type !== 'move') continue;
		let current = first.to;
		for (const [segmentIndex, segment] of subpath.segments.slice(1).entries()) {
			const actualSegmentIndex = segmentIndex + 1;
			const sampleCount = segment.type === 'line' ? 1 : segment.type === 'quadratic' ? 32 : 48;
			for (let sample = 1; sample <= sampleCount; sample += 1) {
				const fromT = (sample - 1) / sampleCount;
				const toT = sample / sampleCount;
				const from = localToWorld(shape, samplePathSegment(current, segment, fromT));
				const to = localToWorld(shape, samplePathSegment(current, segment, toT));
				const distance = distanceToSegment(point, from, to);
				if (distance <= closestDistance) {
					closestDistance = distance;
					const segmentT = parameterOnSegment(point, from, to);
					closest = {
						subpathIndex,
						segmentIndex: actualSegmentIndex,
						t: Math.min(1, Math.max(0, fromT + (toT - fromT) * segmentT))
					};
				}
			}
			current = segment.to;
		}
		if (subpath.closed) {
			const from = localToWorld(shape, current);
			const to = localToWorld(shape, first.to);
			const distance = distanceToSegment(point, from, to);
			if (distance <= closestDistance) {
				closestDistance = distance;
				closest = {
					subpathIndex,
					segmentIndex: subpath.segments.length,
					t: parameterOnSegment(point, from, to)
				};
			}
		}
	}
	return closest;
}

/** Find a subpath whose rendered geometry is close to a world point. */
export function hitTestPathSubpath(shape: PathShape, point: Vec2, tolerance = 10): number | null {
	let closestSubpath: number | null = null;
	let closestDistance = tolerance;
	for (const [subpathIndex, subpath] of shape.props.subpaths.entries()) {
		const first = subpath.segments[0];
		if (!first || first.type !== 'move') continue;
		let current = first.to;
		for (const segment of subpath.segments.slice(1)) {
			const samples =
				segment.type === 'line'
					? [current, segment.to]
					: segment.type === 'quadratic'
						? [
								current,
								...Array.from({ length: 24 }, (_, index) =>
									quadraticPoint(current, segment.control, segment.to, (index + 1) / 24)
								)
							]
						: segment.type === 'cubic'
							? [
									current,
									...Array.from({ length: 32 }, (_, index) =>
										cubicPoint(
											current,
											segment.control_1,
											segment.control_2,
											segment.to,
											(index + 1) / 32
										)
									)
								]
							: [current, segment.to];
			for (let index = 1; index < samples.length; index += 1) {
				const from = localToWorld(shape, samples[index - 1]);
				const to = localToWorld(shape, samples[index]);
				const distance = distanceToSegment(point, from, to);
				if (distance < closestDistance) {
					closestDistance = distance;
					closestSubpath = subpathIndex;
				}
			}
			current = segment.to;
		}
		if (subpath.closed) {
			const distance = distanceToSegment(point, localToWorld(shape, current), localToWorld(shape, first.to));
			if (distance < closestDistance) {
				closestDistance = distance;
				closestSubpath = subpathIndex;
			}
		}
	}
	return closestSubpath;
}

function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
	const segment = Vec2Ops.sub(to, from);
	const lengthSq = Vec2Ops.lenSq(segment);
	if (lengthSq === 0) return Vec2Ops.dist(point, from);
	const t = parameterOnSegment(point, from, to);
	return Vec2Ops.dist(point, Vec2Ops.add(from, Vec2Ops.mulScalar(segment, t)));
}

function parameterOnSegment(point: Vec2, from: Vec2, to: Vec2): number {
	const segment = Vec2Ops.sub(to, from);
	const lengthSq = Vec2Ops.lenSq(segment);
	if (lengthSq === 0) return 0;
	return Math.max(0, Math.min(1, Vec2Ops.dot(Vec2Ops.sub(point, from), segment) / lengthSq));
}

function samplePathSegment(start: Vec2, segment: PathSegment, t: number): Vec2 {
	if (segment.type === 'line') return lerp(start, segment.to, t);
	if (segment.type === 'quadratic') return quadraticPoint(start, segment.control, segment.to, t);
	if (segment.type === 'cubic') return cubicPoint(start, segment.control_1, segment.control_2, segment.to, t);
	return segment.to;
}

function lerp(start: Vec2, end: Vec2, t: number): Vec2 {
	return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function quadraticExtremum(start: number, control: number, end: number): number | null {
	const denominator = start - 2 * control + end;
	return Math.abs(denominator) <= Number.EPSILON ? null : (start - control) / denominator;
}

function quadraticRoots(a: number, b: number, c: number): number[] {
	if (Math.abs(a) <= Number.EPSILON) return Math.abs(b) > Number.EPSILON ? [-c / b] : [];
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) return [];
	const root = Math.sqrt(discriminant);
	return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function quadraticPoint(start: Vec2, control: Vec2, end: Vec2, t: number): Vec2 {
	const inverse = 1 - t;
	return {
		x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
		y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
	};
}

function cubicPoint(start: Vec2, control1: Vec2, control2: Vec2, end: Vec2, t: number): Vec2 {
	const inverse = 1 - t;
	return {
		x:
			inverse ** 3 * start.x +
			3 * inverse ** 2 * t * control1.x +
			3 * inverse * t ** 2 * control2.x +
			t ** 3 * end.x,
		y:
			inverse ** 3 * start.y +
			3 * inverse ** 2 * t * control1.y +
			3 * inverse * t ** 2 * control2.y +
			t ** 3 * end.y
	};
}

/**
 * Compute outline polygon points for a stroke using perfect-freehand
 *
 * @param points - Array of stroke points [x, y, pressure?]
 * @param brush - Brush configuration
 * @returns Array of outline points [x, y]
 */
export function computeOutline(points: StrokePoint[], brush: BrushConfig): Vec2[] {
	if (points.length < 2) {
		return [];
	}

	const formattedPoints = points.map((p) => {
		if (p.length === 3 && p[2] !== undefined) {
			return [p[0], p[1], p[2]];
		}
		return [p[0], p[1]];
	});

	const outlinePoints = getStroke(formattedPoints, {
		size: brush.size,
		thinning: brush.thinning,
		smoothing: brush.smoothing,
		streamline: brush.streamline,
		simulatePressure: brush.simulatePressure
	});

	return outlinePoints.map((p) => ({ x: p[0], y: p[1] }));
}

/**
 * Return the computed freehand outline for a shape.
 *
 * Shape records are immutable in editor state, so object identity provides
 * automatic invalidation without retaining deleted strokes.
 */
export function getStrokeOutline(shape: StrokeShape): Vec2[] {
	const cached = strokeOutlineCache.get(shape);
	if (cached) {
		return cached;
	}

	const outline = computeOutline(shape.props.points, shape.props.brush);
	strokeOutlineCache.set(shape, outline);
	return outline;
}

/**
 * Compute bounding box from outline points
 *
 * @param outline - Array of outline points
 * @returns Bounding box containing all outline points
 */
export function boundsFromOutline(outline: Vec2[]): Box2 {
	if (outline.length === 0) {
		return Box2Ops.create(0, 0, 0, 0);
	}

	return Box2Ops.fromPoints(outline);
}

/**
 * Rotate a point around the origin
 *
 * @param p - Point to rotate
 * @param theta - Rotation angle in radians
 * @returns Rotated point
 */
/**
 * Check if a point is inside a rectangle shape
 *
 * @param p - Point in world coordinates
 * @param shape - Rectangle shape
 * @returns True if point is inside the rectangle
 */
export function pointInRect(p: Vec2, shape: RectShape): boolean {
	const { w, h } = shape.props;
	const localP = worldToLocal(p, shape);
	return localP.x >= 0 && localP.x <= w && localP.y >= 0 && localP.y <= h;
}

/**
 * Check if a point is inside an ellipse shape
 *
 * @param p - Point in world coordinates
 * @param shape - Ellipse shape
 * @returns True if point is inside the ellipse
 */
export function pointInEllipse(p: Vec2, shape: EllipseShape): boolean {
	const { w, h } = shape.props;

	const localP = worldToLocal(p, shape);

	const centerX = w / 2;
	const centerY = h / 2;
	const radiusX = w / 2;
	const radiusY = h / 2;

	const dx = localP.x - centerX;
	const dy = localP.y - centerY;
	return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
}

/**
 * Check if a point is near a line segment
 *
 * @param p - Point to test
 * @param a - Start point of segment
 * @param b - End point of segment
 * @param tolerance - Maximum distance from segment to be considered "near"
 * @returns True if point is within tolerance distance of the segment
 */
export function pointNearSegment(p: Vec2, a: Vec2, b: Vec2, tolerance: number): boolean {
	const ab = Vec2Ops.sub(b, a);
	const ap = Vec2Ops.sub(p, a);
	const abLengthSq = Vec2Ops.lenSq(ab);

	if (abLengthSq === 0) {
		return Vec2Ops.dist(p, a) <= tolerance;
	}

	const t = Math.max(0, Math.min(1, Vec2Ops.dot(ap, ab) / abLengthSq));
	const projection = Vec2Ops.add(a, Vec2Ops.mulScalar(ab, t));
	const distance = Vec2Ops.dist(p, projection);
	return distance <= tolerance;
}

/**
 * Check if a point is near a line or arrow shape
 *
 * @param p - Point in world coordinates
 * @param shape - Line or arrow shape
 * @param tolerance - Maximum distance from line to be considered a hit
 * @returns True if point is near the line
 */
export function pointNearLine(p: Vec2, shape: LineShape | ArrowShape, tolerance = 5): boolean {
	let points: Vec2[];
	if (shape.type === 'line') {
		points = [shape.props.a, shape.props.b];
	} else {
		if (!shape.props.points || shape.props.points.length < 2) {
			return false;
		}
		points = arrowPath(
			shape.props.points,
			shape.props.routing?.automatic ? 'orthogonal' : (shape.props.routing?.kind ?? 'straight')
		);
	}

	const localP = worldToLocal(p, shape);

	for (let i = 0; i < points.length - 1; i++) {
		if (pointNearSegment(localP, points[i], points[i + 1], tolerance)) {
			return true;
		}
	}

	return false;
}

/**
 * Check if a point is inside a text shape
 *
 * @param p - Point in world coordinates
 * @param shape - Text shape
 * @returns True if point is inside the text bounds
 */
export function pointInText(p: Vec2, shape: TextShape): boolean {
	const { fontSize, w } = shape.props;
	const localP = worldToLocal(p, shape);
	const width = w ?? fontSize * 10;
	const height = fontSize * 1.2;
	return localP.x >= 0 && localP.x <= width && localP.y >= 0 && localP.y <= height;
}

/**
 * Check if a point is inside a markdown block shape
 *
 * @param p - Point in world coordinates
 * @param shape - Markdown block shape
 * @returns True if point is inside the markdown block bounds
 */
export function pointInMarkdown(p: Vec2, shape: MarkdownShape): boolean {
	const { w, h, fontSize } = shape.props;
	const localP = worldToLocal(p, shape);
	const width = w;
	const height = h ?? fontSize * 10;
	return localP.x >= 0 && localP.x <= width && localP.y >= 0 && localP.y <= height;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 *
 * @param p - Point to test
 * @param polygon - Array of polygon vertices
 * @returns True if point is inside the polygon
 */
function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
	if (polygon.length < 3) return false;

	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x;
		const yi = polygon[i].y;
		const xj = polygon[j].x;
		const yj = polygon[j].y;

		const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}

	return inside;
}

function pathPolylines(geometry: PathGeometry, closeOpenSubpaths: boolean): Vec2[][] {
	const result: Vec2[][] = [];
	for (const subpath of geometry.subpaths) {
		const first = subpath.segments[0];
		if (!first || first.type !== 'move') continue;
		const points: Vec2[] = [first.to];
		let current = first.to;
		for (const segment of subpath.segments.slice(1)) {
			if (segment.type === 'move') {
				current = segment.to;
				points.push(current);
			} else if (segment.type === 'line') {
				points.push(segment.to);
				current = segment.to;
			} else if (segment.type === 'quadratic') {
				for (let step = 1; step <= 24; step += 1) {
					points.push(quadraticPoint(current, segment.control, segment.to, step / 24));
				}
				current = segment.to;
			} else {
				for (let step = 1; step <= 32; step += 1) {
					points.push(cubicPoint(current, segment.control_1, segment.control_2, segment.to, step / 32));
				}
				current = segment.to;
			}
		}
		if ((closeOpenSubpaths || subpath.closed) && points.length > 1) points.push(first.to);
		result.push(points);
	}
	return result;
}

/** Test a local point against a native path's compound fill. */
export function pointInPath(point: Vec2, geometry: PathGeometry): boolean {
	let crossings = 0;
	let winding = 0;
	for (const polyline of pathPolylines(geometry, true)) {
		for (let index = 1; index < polyline.length; index += 1) {
			const from = polyline[index - 1];
			const to = polyline[index];
			if (from.y > point.y === to.y > point.y) continue;
			const x = from.x + ((point.y - from.y) * (to.x - from.x)) / (to.y - from.y);
			if (x <= point.x) continue;
			crossings += 1;
			if (to.y > from.y) winding += 1;
			else winding -= 1;
		}
	}
	return geometry.fill_rule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

/** Test a world point against a native path's stroked segments. */
export function pointNearPath(point: Vec2, shape: PathShape, tolerance = 5): boolean {
	const local = worldToLocal(point, shape);
	const radius = Math.max(0, shape.props.stroke_width ?? 2) / 2 + tolerance;
	for (const polyline of pathPolylines(shape.props, false)) {
		for (let index = 1; index < polyline.length; index += 1) {
			if (pointNearSegment(local, polyline[index - 1], polyline[index], radius)) return true;
		}
	}
	return false;
}

/** Test a world point against either the fill or stroke of a native path. */
export function hitTestPath(point: Vec2, shape: PathShape, tolerance = 5): boolean {
	const local = worldToLocal(point, shape);
	return (
		(Boolean(shape.props.fill) && pointInPath(local, shape.props)) ||
		(Boolean(shape.props.stroke) && pointNearPath(point, shape, tolerance))
	);
}

/**
 * Check if a point is inside a stroke shape
 *
 * Uses bounds check first for performance, then polygon containment test
 *
 * @param p - Point in world coordinates
 * @param shape - Stroke shape
 * @returns True if point is inside the stroke
 */
export function hitTestStroke(p: Vec2, shape: StrokeShape): boolean {
	const { points } = shape.props;

	if (points.length < 2) return false;

	const bounds = shapeBounds(shape);
	if (p.x < bounds.min.x || p.x > bounds.max.x || p.y < bounds.min.y || p.y > bounds.max.y) {
		return false;
	}

	const localP = worldToLocal(p, shape);

	const outline = getStrokeOutline(shape);
	return pointInPolygon(localP, outline);
}

/**
 * Perform hit testing to find which shape is under a point
 *
 * Uses reverse order (topmost shape wins) based on page.shapeIds order.
 * Line and arrow shapes use a tolerance for easier selection.
 *
 * @param state - Editor state
 * @param worldPoint - Point to test in world coordinates
 * @param tolerance - Tolerance for line/arrow hit testing (default: 5)
 * @returns Shape ID of the topmost shape under the point, or null if no hit
 */
export function hitTestPoint(state: EditorState, worldPoint: Vec2, tolerance = 5): string | null {
	const shapes = getInteractiveShapesOnCurrentPage(state);

	for (let index = shapes.length - 1; index >= 0; index--) {
		const shape = shapes[index];

		switch (shape.type) {
			case 'rect': {
				if (pointInRect(worldPoint, shape)) {
					return shape.id;
				}
				break;
			}
			case 'ellipse': {
				if (pointInEllipse(worldPoint, shape)) {
					return shape.id;
				}
				break;
			}
			case 'line': {
				if (pointNearLine(worldPoint, shape, tolerance)) return shape.id;
				break;
			}
			case 'arrow': {
				const resolved = resolveArrowEndpoints(state, shape.id);
				const points = resolved
					? arrowPath(
							[
								worldToLocal(resolved.a, shape),
								...shape.props.points.slice(1, -1),
								worldToLocal(resolved.b, shape)
							],
							shape.props.routing?.automatic ? 'orthogonal' : (shape.props.routing?.kind ?? 'straight')
						)
					: arrowPath(
							shape.props.points,
							shape.props.routing?.automatic ? 'orthogonal' : (shape.props.routing?.kind ?? 'straight')
						);
				const localPoint = worldToLocal(worldPoint, shape);
				if (
					points.some(
						(point, index) => index > 0 && pointNearSegment(localPoint, points[index - 1], point, tolerance)
					)
				) {
					return shape.id;
				}
				break;
			}
			case 'text': {
				if (pointInText(worldPoint, shape)) {
					return shape.id;
				}
				break;
			}
			case 'markdown': {
				if (pointInMarkdown(worldPoint, shape)) {
					return shape.id;
				}
				break;
			}
			case 'stroke': {
				if (hitTestStroke(worldPoint, shape)) {
					return shape.id;
				}
				break;
			}
			case 'path': {
				if (hitTestPath(worldPoint, shape, tolerance)) {
					return shape.id;
				}
				break;
			}
			case 'container': {
				if (Box2Ops.containsPoint(shapeBounds(shape), worldPoint)) return shape.id;
				break;
			}
		}
	}

	return null;
}

/**
 * Get the center point of a shape's bounding box in world coordinates
 *
 * @param shape - The shape to get center for
 * @returns Center point in world coordinates
 */
export function shapeCenter(shape: ShapeRecord): Vec2 {
	const bounds = shapeBounds(shape);
	return { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
}

/**
 * Compute anchor point on a shape's bounds given normalized coordinates
 *
 * @param shape - Target shape
 * @param nx - Normalized x coordinate in [-1, 1] where -1 is left edge, 1 is right edge, 0 is center
 * @param ny - Normalized y coordinate in [-1, 1] where -1 is top edge, 1 is bottom edge, 0 is center
 * @param offset - Optional offset distance to push the anchor point away from the shape (default: 0)
 * @returns World coordinates of the anchor point
 */
export function computeEdgeAnchor(shape: ShapeRecord, nx: number, ny: number, offset = 0): Vec2 {
	const bounds = shapeBounds(shape);
	const centerX = (bounds.min.x + bounds.max.x) / 2;
	const centerY = (bounds.min.y + bounds.max.y) / 2;
	const halfWidth = (bounds.max.x - bounds.min.x) / 2;
	const halfHeight = (bounds.max.y - bounds.min.y) / 2;

	const baseX = centerX + nx * halfWidth;
	const baseY = centerY + ny * halfHeight;

	if (offset === 0) {
		return { x: baseX, y: baseY };
	}

	const dx = baseX - centerX;
	const dy = baseY - centerY;
	const distance = Math.sqrt(dx * dx + dy * dy);

	if (distance < 0.01) {
		return { x: baseX, y: baseY };
	}

	const offsetX = (dx / distance) * offset;
	const offsetY = (dy / distance) * offset;
	return { x: baseX + offsetX, y: baseY + offsetY };
}

/**
 * Compute normalized anchor coordinates from a world point and target shape
 *
 * @param point - World coordinates of the point to anchor
 * @param shape - Target shape to anchor to
 * @returns Normalized coordinates {nx, ny} in [-1, 1]
 */
export function computeNormalizedAnchor(point: Vec2, shape: ShapeRecord): { nx: number; ny: number } {
	const bounds = shapeBounds(shape);
	const centerX = (bounds.min.x + bounds.max.x) / 2;
	const centerY = (bounds.min.y + bounds.max.y) / 2;
	const halfWidth = Math.max((bounds.max.x - bounds.min.x) / 2, 1);
	const halfHeight = Math.max((bounds.max.y - bounds.min.y) / 2, 1);

	const nx = Math.max(-1, Math.min(1, (point.x - centerX) / halfWidth));
	const ny = Math.max(-1, Math.min(1, (point.y - centerY) / halfHeight));

	return { nx, ny };
}

/**
 * Resolve arrow endpoints considering bindings
 *
 * If an arrow endpoint is bound to a target shape, returns the bound position
 * based on the binding anchor (center or edge with normalized coordinates).
 * Otherwise returns the arrow's stored endpoint.
 *
 * @param state - Editor state
 * @param arrowId - ID of the arrow shape
 * @returns Resolved endpoints {a, b} in world coordinates, or null if arrow not found
 */
export function resolveArrowEndpoints(state: EditorState, arrowId: string): { a: Vec2; b: Vec2 } | null {
	const arrow = state.doc.shapes[arrowId];
	if (!arrow || arrow.type !== 'arrow') return null;

	const points = arrow.props.points;
	if (!points || points.length < 2) return null;

	const firstPoint = points[0];
	const lastPoint = points[points.length - 1];
	let a = localToWorld(arrow, firstPoint);
	let b = localToWorld(arrow, lastPoint);

	const arrowStrokeWidth = arrow.props.style?.width ?? 2;
	const targetShapeStrokeWidth = 2;
	const offset = targetShapeStrokeWidth / 2 + arrowStrokeWidth / 2;

	for (const binding of Object.values(state.doc.bindings)) {
		if (binding.fromShapeId !== arrowId) continue;

		const targetShape = state.doc.shapes[binding.toShapeId];
		if (!targetShape) continue;

		let anchorPoint: Vec2;
		if (binding.anchor.kind === 'center') {
			anchorPoint = shapeCenter(targetShape);
		} else {
			anchorPoint = computeEdgeAnchor(targetShape, binding.anchor.nx, binding.anchor.ny, offset);
		}

		if (binding.handle === 'start') {
			a = anchorPoint;
		} else if (binding.handle === 'end') {
			b = anchorPoint;
		}
	}

	return { a, b };
}

/**
 * Compute orthogonal (Manhattan-style) routing between two points.
 *
 * The midpoint route gives bound arrows a deterministic path while leaving
 * stored bend points available for manual editing.
 */
export function computeOrthogonalPath(start: Vec2, end: Vec2): Vec2[] {
	const dx = end.x - start.x;
	const dy = end.y - start.y;

	if (Math.abs(dx) < 0.1 || Math.abs(dy) < 0.1) return [start, end];

	const midX = start.x + dx / 2;
	return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
}

/** Return a sampled quadratic path through arrow bend points. */
export function computeCurvedPath(points: readonly Vec2[], samplesPerCurve = 12): Vec2[] {
	if (points.length < 3) return points.map((point) => ({ ...point }));
	const samples = Math.max(2, Math.floor(samplesPerCurve));
	const output: Vec2[] = [{ ...points[0] }];
	const midpoint = (left: Vec2, right: Vec2): Vec2 => ({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
	let start = points[0];
	for (let index = 1; index < points.length - 1; index += 1) {
		const control = points[index];
		const end = midpoint(control, points[index + 1]);
		for (let step = 1; step <= samples; step += 1) {
			const t = step / samples;
			const inverse = 1 - t;
			output.push({
				x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
				y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
			});
		}
		start = end;
	}
	const control = points.at(-2)!;
	const end = points.at(-1)!;
	for (let step = 1; step <= samples; step += 1) {
		const t = step / samples;
		const inverse = 1 - t;
		output.push({
			x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
			y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
		});
	}
	return output;
}

/** Resolve the local polyline used to draw an arrow. */
export function arrowPath(points: readonly Vec2[], routing: 'straight' | 'curved' | 'orthogonal' = 'straight'): Vec2[] {
	if (points.length < 2) return points.map((point) => ({ ...point }));
	if (routing === 'orthogonal') return computeOrthogonalPath(points[0], points.at(-1)!);
	if (routing === 'curved') return computeCurvedPath(points);
	return points.map((point) => ({ ...point }));
}

/**
 * Compute the total length of a polyline
 */
export function computePolylineLength(points: Vec2[]): number {
	let length = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		length += Math.sqrt(dx * dx + dy * dy);
	}
	return length;
}

/**
 * Get a point at a specific distance along a polyline
 */
export function getPointAtDistance(points: Vec2[], targetDist: number): Vec2 {
	let accum = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		const segLen = Math.sqrt(dx * dx + dy * dy);
		if (accum + segLen >= targetDist) {
			const t = (targetDist - accum) / segLen;
			return { x: points[i - 1].x + dx * t, y: points[i - 1].y + dy * t };
		}
		accum += segLen;
	}
	return points[points.length - 1];
}
