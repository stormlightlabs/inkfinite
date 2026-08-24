import getStroke from 'perfect-freehand';
import type { Box2, Vec2 } from './math';
import { Box2 as Box2Ops, Mat3, Vec2 as Vec2Ops } from './math';
import { arrowHeadGeometry, arrowLabelPlacement } from './arrow-geometry';
import type {
	ArrowShape,
	BindingRecord,
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
	ResolvedArrowGeometry,
	ShapeRecord,
	StrokePoint,
	StrokeShape,
	StrokeWidthPoint,
	TextShape
} from './model';
import type { EditorState } from './reactivity';
import { getInteractiveShapesOnCurrentPage, getShapesOnCurrentPage } from './reactivity';
import { flattenPath, nearestPointOnPath, transformPathGeometry } from './path-metrics';

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
		case 'arrow': {
			const style = shape.props.style;
			const routing = shape.props.routing;
			const geometry =
				routing?.kind === 'curved' && !routing.automatic
					? arrowPathGeometryFromProps(shape.props)
					: (shape.resolvedGeometry?.path ?? arrowPathGeometryFromProps(shape.props));
			let bounds = pathGeometryBounds(geometry);
			const addPoint = (point: Vec2) => {
				bounds = Box2Ops.expandToPoint(bounds, point);
			};
			if (style?.headEnd !== false) {
				const head = arrowHeadGeometry(geometry, false);
				if (head) {
					addPoint(head.tip);
					addPoint(head.left);
					addPoint(head.right);
				}
			}
			if (style?.headStart) {
				const head = arrowHeadGeometry(geometry, true);
				if (head) {
					addPoint(head.tip);
					addPoint(head.left);
					addPoint(head.right);
				}
			}
			if (shape.props.label?.text) {
				const placement = arrowLabelPlacement(geometry, shape.props.label);
				if (placement) {
					const halfWidth = (shape.props.label.text.length * 7 + 8) / 2;
					for (const point of [
						{ x: placement.point.x - halfWidth, y: placement.point.y - 9 },
						{ x: placement.point.x + halfWidth, y: placement.point.y - 9 },
						{ x: placement.point.x - halfWidth, y: placement.point.y + 9 },
						{ x: placement.point.x + halfWidth, y: placement.point.y + 9 }
					]) {
						addPoint(point);
					}
				}
			}
			return bounds;
		}
		case 'text':
			return Box2Ops.create(0, 0, shape.props.w ?? shape.props.fontSize * 10, shape.props.fontSize * 1.2);
		case 'markdown':
			return Box2Ops.create(0, 0, shape.props.w, shape.props.h ?? shape.props.fontSize * 10);
		case 'image':
		case 'reference':
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
	const worldGeometry = transformPathGeometry(shape.props, shapeTransform(shape));
	const nearest = nearestPointOnPath(worldGeometry, point, Math.max(0.01, tolerance / 4));
	if (!nearest || nearest.distanceToPath > tolerance) return null;
	return { subpathIndex: nearest.subpathIndex, segmentIndex: nearest.segmentIndex, t: nearest.t };
}

/** Find a subpath whose rendered geometry is close to a world point. */
export function hitTestPathSubpath(shape: PathShape, point: Vec2, tolerance = 10): number | null {
	const worldGeometry = transformPathGeometry(shape.props, shapeTransform(shape));
	const nearest = nearestPointOnPath(worldGeometry, point, Math.max(0.01, tolerance / 4));
	return nearest && nearest.distanceToPath <= tolerance ? nearest.subpathIndex : null;
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

/** A rendered width handle for an editable freehand stroke profile. */
export type StrokeWidthHandle = { index: number; center: Vec2; position: Vec2; width: number };

/** Return the stable renderer ID for a freehand width handle. */
export function strokeWidthHandleId(index: number): string {
	return `stroke-width-${index}`;
}

/** Return the profile used for rendering, deriving one from sampled pressure when absent. */
export function strokeWidthProfile(shape: StrokeShape): StrokeWidthPoint[] {
	if (shape.props.widthProfile && shape.props.widthProfile.length > 0) {
		return shape.props.widthProfile.map((point) => ({ ...point }));
	}
	const offsets = strokePointOffsets(shape.props.points);
	return shape.props.points.map((point, index) => ({
		offset: offsets[index] ?? 0,
		width: strokeWidthFromPressure(point[2], shape.props.brush)
	}));
}

/** Interpolate an absolute stroke width at a normalized centerline offset. */
export function strokeWidthAtOffset(profile: StrokeWidthPoint[], offset: number, fallback: number): number {
	if (profile.length === 0) return fallback;
	const sorted = [...profile].sort((left, right) => left.offset - right.offset);
	if (offset <= sorted[0]!.offset) return Math.max(0.01, sorted[0]!.width);
	const last = sorted[sorted.length - 1]!;
	if (offset >= last.offset) return Math.max(0.01, last.width);
	for (let index = 1; index < sorted.length; index += 1) {
		const next = sorted[index]!;
		const previous = sorted[index - 1]!;
		if (offset <= next.offset) {
			const span = next.offset - previous.offset;
			const amount = span <= Number.EPSILON ? 0 : (offset - previous.offset) / span;
			return Math.max(0.01, previous.width + (next.width - previous.width) * amount);
		}
	}
	return Math.max(0.01, last.width);
}

/** Return editable width handles in stroke-local coordinates. */
export function strokeWidthHandles(shape: StrokeShape): StrokeWidthHandle[] {
	const profile = strokeWidthProfile(shape);
	return profile.map((point, index) => {
		const centerline = strokeCenterlineAtOffset(shape.props.points, point.offset);
		const normal = { x: -centerline.tangent.y, y: centerline.tangent.x };
		return {
			index,
			center: centerline.point,
			position: {
				x: centerline.point.x + (normal.x * point.width) / 2,
				y: centerline.point.y + (normal.y * point.width) / 2
			},
			width: point.width
		};
	});
}

/** Find a freehand width handle under a world point. */
export function hitTestStrokeWidthHandle(shape: StrokeShape, point: Vec2, tolerance = 10): number | null {
	let closest: number | null = null;
	let closestDistance = tolerance;
	for (const handle of strokeWidthHandles(shape)) {
		const distance = Vec2Ops.dist(point, localToWorld(shape, handle.position));
		if (distance <= closestDistance) {
			closest = handle.index;
			closestDistance = distance;
		}
	}
	return closest;
}

/** Compute outline polygon points for a stroke using perfect-freehand. */
export function computeOutline(points: StrokePoint[], brush: BrushConfig, widthProfile?: StrokeWidthPoint[]): Vec2[] {
	if (points.length < 2) return [];

	const profile = widthProfile?.length ? widthProfile : undefined;
	const formattedPoints = profile
		? (() => {
				const offsets = strokePointOffsets(points);
				const widths = offsets.map((offset) => strokeWidthAtOffset(profile, offset, brush.size));
				const maxWidth = Math.max(...widths, 0.01);
				return points.map(
					(point, index) => [point[0], point[1], widths[index]! / maxWidth] as [number, number, number]
				);
			})()
		: points.map((point) =>
				point.length === 3 && point[2] !== undefined ? [point[0], point[1], point[2]] : [point[0], point[1]]
			);
	const options = profile
		? {
				size: Math.max(...profile.map((point) => point.width), 0.01) / 2,
				thinning: 1,
				smoothing: brush.smoothing,
				streamline: brush.streamline,
				simulatePressure: false
			}
		: {
				size: brush.size,
				thinning: brush.thinning,
				smoothing: brush.smoothing,
				streamline: brush.streamline,
				simulatePressure: brush.simulatePressure
			};
	return getStroke(formattedPoints, options).map((point) => ({ x: point[0], y: point[1] }));
}

function strokeWidthFromPressure(pressure: number | undefined, brush: BrushConfig): number {
	const normalized = pressure === undefined ? 0.5 : Math.max(0, Math.min(1, pressure));
	return Math.max(0.01, brush.size * (1 - brush.thinning + 2 * brush.thinning * normalized));
}

function strokePointOffsets(points: StrokePoint[]): number[] {
	if (points.length < 2) return points.map(() => 0);
	const distances = [0];
	for (let index = 1; index < points.length; index += 1) {
		distances.push(
			distances[index - 1]! +
				Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1])
		);
	}
	const total = distances.at(-1) ?? 0;
	return total <= Number.EPSILON
		? points.map((_, index) => index / (points.length - 1))
		: distances.map((distance) => distance / total);
}

function strokeCenterlineAtOffset(points: StrokePoint[], offset: number): { point: Vec2; tangent: Vec2 } {
	if (points.length === 0) return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
	const offsets = strokePointOffsets(points);
	const target = Math.max(0, Math.min(1, offset));
	for (let index = 1; index < points.length; index += 1) {
		if (target > offsets[index]!) continue;
		const from = points[index - 1]!;
		const to = points[index]!;
		const span = offsets[index]! - offsets[index - 1]!;
		const amount = span <= Number.EPSILON ? 0 : (target - offsets[index - 1]!) / span;
		const dx = to[0] - from[0];
		const dy = to[1] - from[1];
		const length = Math.hypot(dx, dy) || 1;
		return {
			point: { x: from[0] + dx * amount, y: from[1] + dy * amount },
			tangent: { x: dx / length, y: dy / length }
		};
	}
	const last = points[points.length - 1]!;
	const previous = points[points.length - 2] ?? last;
	const dx = last[0] - previous[0];
	const dy = last[1] - previous[1];
	const length = Math.hypot(dx, dy) || 1;
	return { point: { x: last[0], y: last[1] }, tangent: { x: dx / length, y: dy / length } };
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

	const outline = computeOutline(shape.props.points, shape.props.brush, shape.props.widthProfile);
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
	return flattenPath(geometry).subpaths.map((subpath) => {
		const points = subpath.points.map((point) => ({ ...point }));
		if ((closeOpenSubpaths || subpath.closed) && points.length > 1) {
			const first = points[0]!;
			const last = points.at(-1)!;
			if (first.x !== last.x || first.y !== last.y) points.push({ ...first });
		}
		return points;
	});
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
	const radius = Math.max(0, shape.props.stroke_width ?? 2) / 2 + tolerance;
	const worldGeometry = transformPathGeometry(shape.props, shapeTransform(shape));
	const nearest = nearestPointOnPath(worldGeometry, point, Math.max(0.01, radius / 4));
	return nearest !== null && nearest.distanceToPath <= radius;
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
 * Return every shape hit by a point in topmost-first draw order.
 *
 * Keeping the full hit stack lets the selection tool cycle through overlapping
 * objects while preserving `hitTestPoint`'s fast topmost-only API.
 */
export function hitTestPoints(state: EditorState, worldPoint: Vec2, tolerance = 5): string[] {
	const shapes = getInteractiveShapesOnCurrentPage(state);
	const hits: string[] = [];
	for (let index = shapes.length - 1; index >= 0; index -= 1) {
		const shape = shapes[index];
		if (hitTestShape(state, shape, worldPoint, tolerance)) hits.push(shape.id);
	}
	return hits;
}

/**
 * Perform hit testing to find which shape is under a point.
 *
 * @param state - Editor state
 * @param worldPoint - Point to test in world coordinates
 * @param tolerance - Tolerance for line/arrow hit testing (default: 5)
 * @returns Shape ID of the topmost shape under the point, or null if no hit
 */
export function hitTestPoint(state: EditorState, worldPoint: Vec2, tolerance = 5): string | null {
	return hitTestPoints(state, worldPoint, tolerance)[0] ?? null;
}

function hitTestShape(state: EditorState, shape: ShapeRecord, worldPoint: Vec2, tolerance: number): boolean {
	const localPoint = worldToLocal(worldPoint, shape);
	if (shape.props.clipPath && !pointInPath(localPoint, shape.props.clipPath)) return false;
	if (shape.props.maskEffect && !pointInPath(localPoint, shape.props.maskEffect.geometry)) return false;
	switch (shape.type) {
		case 'rect':
			return pointInRect(worldPoint, shape);
		case 'ellipse':
			return pointInEllipse(worldPoint, shape);
		case 'line':
			return pointNearLine(worldPoint, shape, tolerance);
		case 'arrow': {
			const style = shape.props.style;
			const geometry = arrowGeometryForShape(state, shape);
			if (!geometry) return false;
			const worldGeometry = transformPathGeometry(geometry.path, shapeTransform(shape));
			const nearest = nearestPointOnPath(worldGeometry, worldPoint, Math.max(0.01, tolerance / 4));
			if (nearest !== null && nearest.distanceToPath <= tolerance + (style?.width ?? 2) / 2) return true;

			const localPoint = worldToLocal(worldPoint, shape);
			const headHit = (atStart: boolean) => {
				const head = arrowHeadGeometry(geometry.path, atStart);
				if (!head) return false;
				if ((atStart ? style?.headStart : style?.headEnd !== false) === false) return false;
				if (
					pointNearSegment(localPoint, head.tip, head.left, tolerance) ||
					pointNearSegment(localPoint, head.tip, head.right, tolerance)
				)
					return true;
				const headStyle = atStart ? style?.headStartStyle : style?.headEndStyle;
				return headStyle === 'triangle' && pointInPolygon(localPoint, [head.tip, head.left, head.right]);
			};
			if (headHit(true) || headHit(false)) return true;

			if (shape.props.label?.text) {
				const placement = arrowLabelPlacement(geometry.path, shape.props.label);
				if (placement) {
					const halfWidth = (shape.props.label.text.length * 7 + 8) / 2 + tolerance;
					return (
						Math.abs(localPoint.x - placement.point.x) <= halfWidth &&
						Math.abs(localPoint.y - placement.point.y) <= 9 + tolerance
					);
				}
			}
			return false;
		}
		case 'text':
			return pointInText(worldPoint, shape);
		case 'markdown':
			return pointInMarkdown(worldPoint, shape);
		case 'stroke':
			return hitTestStroke(worldPoint, shape);
		case 'path':
			return hitTestPath(worldPoint, shape, tolerance);
		case 'container':
		case 'reference':
			return Box2Ops.containsPoint(shapeBounds(shape), worldPoint);
	}
	return false;
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

/** Pre-indexed bindings keyed by their source shape ID for repeated geometry work. */
export type BindingIndex = ReadonlyMap<string, readonly BindingRecord[]>;

/**
 * Resolve arrow endpoints considering bindings
 *
 * If an arrow endpoint is bound to a target shape, returns the bound position
 * based on the binding anchor (center or edge with normalized coordinates).
 * Otherwise returns the arrow's stored endpoint.
 *
 * @param state - Editor state
 * @param arrowId - ID of the arrow shape
 * @param bindingsBySource - Optional binding index reused across a render pass
 * @returns Resolved endpoints {a, b} in world coordinates, or null if arrow not found
 */
export function resolveArrowEndpoints(
	state: EditorState,
	arrowId: string,
	bindingsBySource?: BindingIndex
): { a: Vec2; b: Vec2 } | null {
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

	const bindings =
		bindingsBySource?.get(arrowId) ??
		Object.values(state.doc.bindings).filter((binding) => binding.fromShapeId === arrowId);
	for (const binding of bindings) {
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

type RouteObstacle = { minX: number; maxX: number; minY: number; maxY: number };
type RouteState = { cost: number; previous: number | null; node: number; direction: number };
const ROUTE_EPSILON = 1e-9;
const ROUTE_TURN_PENALTY = 12;

/**
 * Compute a deterministic orthogonal route around axis-aligned obstacles.
 *
 * This is the browser preview counterpart to `inkfinite_core::routing`; keep
 * its candidate grid, tie-breaking, and padding rules in sync with Rust.
 */
export function computeObstacleAwareOrthogonalPath(
	start: Vec2,
	end: Vec2,
	obstacles: readonly Box2[],
	padding = 12
): Vec2[] {
	if (Math.abs(start.x - end.x) <= ROUTE_EPSILON && Math.abs(start.y - end.y) <= ROUTE_EPSILON) {
		return [start, end];
	}
	const expanded = obstacles
		.map((obstacle) => ({
			minX: Math.min(obstacle.min.x, obstacle.max.x) - Math.max(0, padding),
			maxX: Math.max(obstacle.min.x, obstacle.max.x) + Math.max(0, padding),
			minY: Math.min(obstacle.min.y, obstacle.max.y) - Math.max(0, padding),
			maxY: Math.max(obstacle.min.y, obstacle.max.y) + Math.max(0, padding)
		}))
		.filter(
			(obstacle) => obstacle.maxX - obstacle.minX > ROUTE_EPSILON || obstacle.maxY - obstacle.minY > ROUTE_EPSILON
		);
	const fallback = computeOrthogonalPath(start, end);
	if (expanded.length === 0 || routeIsClear(fallback, expanded)) return fallback;

	const xValues = uniqueSorted([start.x, end.x, ...expanded.flatMap((obstacle) => [obstacle.minX, obstacle.maxX])]);
	const yValues = uniqueSorted([start.y, end.y, ...expanded.flatMap((obstacle) => [obstacle.minY, obstacle.maxY])]);
	const nodes: Vec2[] = [];
	for (const x of xValues) {
		for (const y of yValues) {
			const point = { x, y };
			if (!routePointInside(point, expanded)) nodes.push(point);
		}
	}
	const startIndex = ensureRouteNode(nodes, start);
	const endIndex = ensureRouteNode(nodes, end);
	const states: RouteState[] = Array.from({ length: nodes.length * 3 }, () => ({
		cost: Number.POSITIVE_INFINITY,
		previous: null,
		node: 0,
		direction: 2
	}));
	states[startIndex * 3 + 2] = { cost: 0, previous: null, node: startIndex, direction: 2 };
	const settled = new Set<number>();

	while (true) {
		let current = -1;
		for (let index = 0; index < states.length; index += 1) {
			const candidate = states[index];
			if (settled.has(index) || !Number.isFinite(candidate.cost)) continue;
			if (
				current < 0 ||
				candidate.cost < states[current].cost - ROUTE_EPSILON ||
				(Math.abs(candidate.cost - states[current].cost) <= ROUTE_EPSILON &&
					(candidate.node < states[current].node ||
						(candidate.node === states[current].node && candidate.direction < states[current].direction)))
			) {
				current = index;
			}
		}
		if (current < 0) break;
		settled.add(current);
		const currentNode = states[current].node;
		if (currentNode === endIndex) return simplifyRoute(reconstructRoute(states, nodes, current));
		for (let nextNode = 0; nextNode < nodes.length; nextNode += 1) {
			if (nextNode === currentNode || !routeAxisAligned(nodes[currentNode], nodes[nextNode])) continue;
			if (!routeSegmentIsClear(nodes[currentNode], nodes[nextNode], expanded)) continue;
			const direction = Math.abs(nodes[nextNode].x - nodes[currentNode].x) > ROUTE_EPSILON ? 0 : 1;
			const nextState = nextNode * 3 + direction;
			const distance =
				Math.abs(nodes[nextNode].x - nodes[currentNode].x) + Math.abs(nodes[nextNode].y - nodes[currentNode].y);
			const turn =
				states[current].direction < 2 && states[current].direction !== direction ? ROUTE_TURN_PENALTY : 0;
			const cost = states[current].cost + distance + turn;
			const existing = states[nextState];
			if (
				cost < existing.cost - ROUTE_EPSILON ||
				(Math.abs(cost - existing.cost) <= ROUTE_EPSILON &&
					current < (existing.previous ?? Number.POSITIVE_INFINITY))
			) {
				states[nextState] = { cost, previous: current, node: nextNode, direction };
			}
		}
	}
	return fallback;
}

/** Resolve an arrow into the native path representation used by all editor consumers. */
export function arrowGeometryForShape(
	state: EditorState,
	shape: ArrowShape,
	bindingsBySource?: BindingIndex
): ResolvedArrowGeometry | null {
	const resolved = resolveArrowEndpoints(state, shape.id, bindingsBySource);
	if (!resolved) return null;
	const waypoints = [
		worldToLocal(resolved.a, shape),
		...shape.props.points.slice(1, -1),
		worldToLocal(resolved.b, shape)
	];
	const routingConfig = shape.props.routing;
	const routing = routingConfig?.automatic ? 'orthogonal' : (routingConfig?.kind ?? 'straight');
	// Curved routing also depends on compact routing parameters. Recompute it
	// instead of accepting a projection cached before a bend or radius edit.
	if (
		routing !== 'curved' &&
		shape.resolvedGeometry &&
		shape.resolvedGeometry.routing === routing &&
		samePoints(shape.resolvedGeometry.waypoints, waypoints)
	) {
		return shape.resolvedGeometry;
	}

	if (routing === 'orthogonal') {
		const boundTargets = new Set(
			(
				bindingsBySource?.get(shape.id) ??
				Object.values(state.doc.bindings).filter((binding) => binding.fromShapeId === shape.id)
			).map((binding) => binding.toShapeId)
		);
		const obstacles = getShapesOnCurrentPage(state)
			.filter(
				(candidate) =>
					candidate.id !== shape.id &&
					candidate.type !== 'arrow' &&
					candidate.type !== 'line' &&
					candidate.type !== 'container' &&
					!boundTargets.has(candidate.id)
			)
			.map(shapeBounds);
		const worldWaypoints = waypoints.map((point) => localToWorld(shape, point));
		const worldPath: Vec2[] = [];
		for (let index = 1; index < worldWaypoints.length; index += 1) {
			const leg = computeObstacleAwareOrthogonalPath(
				worldWaypoints[index - 1]!,
				worldWaypoints[index]!,
				obstacles
			);
			if (worldPath.length === 0) worldPath.push(...leg);
			else worldPath.push(...leg.slice(1));
		}
		return { path: linePathGeometry(worldPath.map((point) => worldToLocal(point, shape))), routing, waypoints };
	}
	return {
		path:
			routing === 'curved'
				? curvedPathGeometry(waypoints, routingConfig?.bend, routingConfig?.cornerRadius)
				: linePathGeometry(waypoints),
		routing,
		waypoints
	};
}

/** Return the editable bend handle for a two-point curved arrow. */
export function arrowBendHandleForShape(
	state: EditorState,
	shape: ArrowShape,
	bindingsBySource?: BindingIndex
): { position: Vec2; connectorFrom: Vec2 } | null {
	if (shape.props.routing?.kind !== 'curved' || shape.props.routing.automatic || shape.props.points?.length !== 2)
		return null;
	const geometry = arrowGeometryForShape(state, shape, bindingsBySource);
	const segment = geometry?.path.subpaths[0]?.segments[1];
	if (!segment || segment.type !== 'quadratic') return null;
	const resolved = resolveArrowEndpoints(state, shape.id, bindingsBySource);
	if (!resolved) return null;
	return {
		position: localToWorld(shape, segment.control),
		connectorFrom: { x: (resolved.a.x + resolved.b.x) / 2, y: (resolved.a.y + resolved.b.y) / 2 }
	};
}

/** Convert a world pointer position to a two-point curved arrow's signed bend. */
export function arrowBendForPointer(state: EditorState, shape: ArrowShape, pointer: Vec2): number | null {
	if (shape.props.routing?.kind !== 'curved' || shape.props.routing.automatic || shape.props.points?.length !== 2)
		return null;
	const resolved = resolveArrowEndpoints(state, shape.id);
	if (!resolved) return null;
	const start = worldToLocal(resolved.a, shape);
	const end = worldToLocal(resolved.b, shape);
	const localPointer = worldToLocal(pointer, shape);
	const direction = Vec2Ops.sub(end, start);
	const length = Vec2Ops.len(direction);
	if (length <= Number.EPSILON) return 0;
	const bend = (direction.x * (localPointer.y - start.y) - direction.y * (localPointer.x - start.x)) / length;
	return Number.isFinite(bend) && Math.abs(bend) > Number.EPSILON ? bend : 0;
}

/**
 * Resolve an arrow's rendered path, including automatic obstacle routing.
 *
 * @param bindingsBySource - Optional binding index reused across a render pass
 */
export function arrowPathForShape(state: EditorState, shape: ArrowShape, bindingsBySource?: BindingIndex): Vec2[] {
	const geometry = arrowGeometryForShape(state, shape, bindingsBySource);
	return geometry ? flattenPathGeometry(geometry.path) : [];
}

function samePoints(left: readonly Vec2[], right: readonly Vec2[]): boolean {
	return (
		left.length === right.length &&
		left.every((point, index) => {
			const other = right[index]!;
			return point.x === other.x && point.y === other.y;
		})
	);
}

function linePathGeometry(points: readonly Vec2[]): PathGeometry {
	return {
		subpaths: [
			{
				segments: points.map((point, index) =>
					index === 0 ? { type: 'move', to: point } : { type: 'line', to: point }
				),
				closed: false
			}
		],
		fill_rule: 'nonzero'
	};
}

function curvedPathGeometry(points: readonly Vec2[], bend = 0, cornerRadius = 16): PathGeometry {
	if (points.length < 2) return linePathGeometry(points);
	if (points.length === 2) {
		const start = points[0]!;
		const end = points[1]!;
		const direction = Vec2Ops.sub(end, start);
		const length = Vec2Ops.len(direction);
		if (length <= Number.EPSILON) return linePathGeometry(points);
		const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
		const offset = Number.isFinite(bend) ? bend : 0;
		const control = {
			x: midpoint.x - (direction.y / length) * offset,
			y: midpoint.y + (direction.x / length) * offset
		};
		return {
			subpaths: [
				{
					segments: [
						{ type: 'move', to: start },
						{ type: 'quadratic', control, to: end }
					],
					closed: false
				}
			],
			fill_rule: 'nonzero'
		};
	}

	const radius = Number.isFinite(cornerRadius) ? Math.max(0, cornerRadius) : 0;
	const segments: PathSegment[] = [{ type: 'move', to: points[0]! }];
	for (let index = 1; index < points.length - 1; index += 1) {
		const previous = points[index - 1]!;
		const corner = points[index]!;
		const next = points[index + 1]!;
		const incoming = Vec2Ops.sub(previous, corner);
		const outgoing = Vec2Ops.sub(next, corner);
		const incomingLength = Vec2Ops.len(incoming);
		const outgoingLength = Vec2Ops.len(outgoing);
		const cornerOffset = Math.min(radius, incomingLength / 2, outgoingLength / 2);
		if (cornerOffset <= Number.EPSILON || incomingLength <= Number.EPSILON || outgoingLength <= Number.EPSILON) {
			segments.push({ type: 'line', to: corner });
			continue;
		}
		const entry = {
			x: corner.x + (incoming.x / incomingLength) * cornerOffset,
			y: corner.y + (incoming.y / incomingLength) * cornerOffset
		};
		const exit = {
			x: corner.x + (outgoing.x / outgoingLength) * cornerOffset,
			y: corner.y + (outgoing.y / outgoingLength) * cornerOffset
		};
		segments.push({ type: 'line', to: entry }, { type: 'quadratic', control: corner, to: exit });
	}
	segments.push({ type: 'line', to: points.at(-1)! });
	return { subpaths: [{ segments, closed: false }], fill_rule: 'nonzero' };
}

function arrowPathGeometryFromProps(props: ArrowShape['props']): PathGeometry {
	const points = props.points ?? [];
	const routing = props.routing;
	const kind = routing?.automatic ? 'orthogonal' : (routing?.kind ?? 'straight');
	return kind === 'curved'
		? curvedPathGeometry(points, routing?.bend, routing?.cornerRadius)
		: linePathGeometry(points);
}

function flattenPathGeometry(geometry: PathGeometry): Vec2[] {
	return flattenPath(geometry).subpaths.flatMap((subpath) => subpath.points);
}

function uniqueSorted(values: number[]): number[] {
	return values
		.sort((left, right) => left - right)
		.filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]!) > ROUTE_EPSILON);
}

function ensureRouteNode(nodes: Vec2[], point: Vec2): number {
	const index = nodes.findIndex(
		(candidate) =>
			Math.abs(candidate.x - point.x) <= ROUTE_EPSILON && Math.abs(candidate.y - point.y) <= ROUTE_EPSILON
	);
	if (index >= 0) return index;
	nodes.push({ ...point });
	return nodes.length - 1;
}

function routePointInside(point: Vec2, obstacles: readonly RouteObstacle[]): boolean {
	return obstacles.some(
		(obstacle) =>
			point.x > obstacle.minX + ROUTE_EPSILON &&
			point.x < obstacle.maxX - ROUTE_EPSILON &&
			point.y > obstacle.minY + ROUTE_EPSILON &&
			point.y < obstacle.maxY - ROUTE_EPSILON
	);
}

function routeAxisAligned(left: Vec2, right: Vec2): boolean {
	return Math.abs(left.x - right.x) <= ROUTE_EPSILON || Math.abs(left.y - right.y) <= ROUTE_EPSILON;
}

function routeSegmentIsClear(start: Vec2, end: Vec2, obstacles: readonly RouteObstacle[]): boolean {
	if (!routeAxisAligned(start, end)) return false;
	return obstacles.every((obstacle) => {
		if (Math.abs(start.y - end.y) <= ROUTE_EPSILON) {
			const yInside = start.y > obstacle.minY + ROUTE_EPSILON && start.y < obstacle.maxY - ROUTE_EPSILON;
			return !yInside || !routeIntervalsOverlap(start.x, end.x, obstacle.minX, obstacle.maxX);
		}
		const xInside = start.x > obstacle.minX + ROUTE_EPSILON && start.x < obstacle.maxX - ROUTE_EPSILON;
		return !xInside || !routeIntervalsOverlap(start.y, end.y, obstacle.minY, obstacle.maxY);
	});
}

function routeIntervalsOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
	return (
		Math.min(firstStart, firstEnd) < secondEnd - ROUTE_EPSILON &&
		Math.max(firstStart, firstEnd) > secondStart + ROUTE_EPSILON
	);
}

function routeIsClear(path: readonly Vec2[], obstacles: readonly RouteObstacle[]): boolean {
	return path.slice(1).every((point, index) => routeSegmentIsClear(path[index]!, point, obstacles));
}

function reconstructRoute(states: readonly RouteState[], nodes: readonly Vec2[], current: number): Vec2[] {
	const path: Vec2[] = [];
	let cursor: number | null = current;
	while (cursor !== null) {
		path.push(nodes[states[cursor]!.node]!);
		cursor = states[cursor]!.previous;
	}
	return path.reverse();
}

function simplifyRoute(path: readonly Vec2[]): Vec2[] {
	const result: Vec2[] = [];
	for (const point of path) {
		const previous = result.at(-1);
		if (
			previous &&
			Math.abs(previous.x - point.x) <= ROUTE_EPSILON &&
			Math.abs(previous.y - point.y) <= ROUTE_EPSILON
		)
			continue;
		if (result.length >= 2) {
			const before = result.at(-2)!;
			if (routeAxisAligned(before, point) && routeAxisAligned(point, previous!)) result.pop();
		}
		result.push({ ...point });
	}
	return result;
}

/** Flatten a native curved arrow path for callers that still need a polyline. */
export function computeCurvedPath(points: readonly Vec2[], _samplesPerCurve = 12): Vec2[] {
	return flattenPathGeometry(curvedPathGeometry(points));
}

/** Resolve the local polyline used to draw an arrow. */
export function arrowPath(
	points: readonly Vec2[],
	routing: 'straight' | 'curved' | 'orthogonal' = 'straight',
	obstacles: readonly Box2[] = []
): Vec2[] {
	if (points.length < 2) return points.map((point) => ({ ...point }));
	if (routing === 'orthogonal') return computeObstacleAwareOrthogonalPath(points[0], points.at(-1)!, obstacles);
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
