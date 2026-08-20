import getStroke from 'perfect-freehand';
import type { Box2, Vec2 } from './math';
import { Box2 as Box2Ops, Vec2 as Vec2Ops } from './math';
import type {
	ArrowShape,
	BrushConfig,
	EllipseShape,
	LineShape,
	MarkdownShape,
	PathGeometry,
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

/**
 * Get the axis-aligned bounding box of a shape in world coordinates
 *
 * For shapes with rotation, this returns the bounding box of the rotated shape
 * (not the minimal bounding box of the original shape)
 *
 * @param shape - The shape to get bounds for
 * @returns Bounding box in world coordinates
 */
export function shapeBounds(shape: ShapeRecord): Box2 {
	switch (shape.type) {
		case 'rect': {
			return rectBounds(shape);
		}
		case 'ellipse': {
			return ellipseBounds(shape);
		}
		case 'line': {
			return lineBounds(shape);
		}
		case 'arrow': {
			return arrowBounds(shape);
		}
		case 'text': {
			return textBounds(shape);
		}
		case 'stroke': {
			return strokeBounds(shape);
		}
		case 'path': {
			return pathBounds(shape);
		}
		case 'markdown': {
			return markdownBounds(shape);
		}
	}
}

/**
 * Get bounds for a rectangle shape
 */
function rectBounds(shape: RectShape): Box2 {
	const { w, h } = shape.props;
	const { x, y, rot } = shape;

	if (rot === 0) {
		return Box2Ops.create(x, y, x + w, y + h);
	}

	const corners = [
		{ x: 0, y: 0 },
		{ x: w, y: 0 },
		{ x: w, y: h },
		{ x: 0, y: h }
	];
	const rotatedCorners = corners.map((corner) => Vec2Ops.rotate(corner, rot));
	const translatedCorners = rotatedCorners.map((corner) => ({ x: corner.x + x, y: corner.y + y }));
	return Box2Ops.fromPoints(translatedCorners);
}

/**
 * Get bounds for an ellipse shape
 */
function ellipseBounds(shape: EllipseShape): Box2 {
	const { w, h } = shape.props;
	const { x, y, rot } = shape;

	if (rot === 0) {
		return Box2Ops.create(x, y, x + w, y + h);
	}

	const corners = [
		{ x: 0, y: 0 },
		{ x: w, y: 0 },
		{ x: w, y: h },
		{ x: 0, y: h }
	];
	const rotatedCorners = corners.map((corner) => Vec2Ops.rotate(corner, rot));
	const translatedCorners = rotatedCorners.map((corner) => ({ x: corner.x + x, y: corner.y + y }));
	return Box2Ops.fromPoints(translatedCorners);
}

/**
 * Get bounds for a line shape
 */
function lineBounds(shape: LineShape): Box2 {
	const { a, b } = shape.props;
	const { x, y, rot } = shape;

	const points = [a, b];

	if (rot === 0) {
		const translatedPoints = points.map((p) => ({ x: p.x + x, y: p.y + y }));
		return Box2Ops.fromPoints(translatedPoints);
	}

	const rotatedPoints = points.map((p) => Vec2Ops.rotate(p, rot));
	const translatedPoints = rotatedPoints.map((p) => ({ x: p.x + x, y: p.y + y }));
	return Box2Ops.fromPoints(translatedPoints);
}

function arrowBounds(shape: ArrowShape): Box2 {
	const { x, y, rot } = shape;
	const points = shape.props.points;

	if (!points || points.length < 2) {
		return { min: { x, y }, max: { x, y } };
	}

	if (rot === 0) {
		const translatedPoints = points.map((p) => ({ x: p.x + x, y: p.y + y }));
		return Box2Ops.fromPoints(translatedPoints);
	}

	const rotatedPoints = points.map((p) => Vec2Ops.rotate(p, rot));
	const translatedPoints = rotatedPoints.map((p) => ({ x: p.x + x, y: p.y + y }));
	return Box2Ops.fromPoints(translatedPoints);
}

/**
 * Get bounds for a text shape
 */
function textBounds(shape: TextShape): Box2 {
	const { fontSize, w } = shape.props;
	const { x, y, rot } = shape;

	const width = w ?? fontSize * 10;
	const height = fontSize * 1.2;

	if (rot === 0) {
		return Box2Ops.create(x, y, x + width, y + height);
	}

	const corners = [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height }
	];

	const rotatedCorners = corners.map((corner) => Vec2Ops.rotate(corner, rot));
	const translatedCorners = rotatedCorners.map((corner) => ({ x: corner.x + x, y: corner.y + y }));
	return Box2Ops.fromPoints(translatedCorners);
}

/** Get bounds for a native path shape. */
function pathBounds(shape: PathShape): Box2 {
	const local = pathGeometryBounds(shape.props);
	const { x, y, rot } = shape;
	if (rot === 0) {
		return Box2Ops.create(x + local.min.x, y + local.min.y, x + local.max.x, y + local.max.y);
	}
	const corners = [
		{ x: local.min.x, y: local.min.y },
		{ x: local.max.x, y: local.min.y },
		{ x: local.max.x, y: local.max.y },
		{ x: local.min.x, y: local.max.y }
	];
	return Box2Ops.fromPoints(
		corners.map((corner) => {
			const rotated = Vec2Ops.rotate(corner, rot);
			return { x: rotated.x + x, y: rotated.y + y };
		})
	);
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
 * Get bounds for a markdown block shape
 */
function markdownBounds(shape: MarkdownShape): Box2 {
	const { w, h, fontSize } = shape.props;
	const { x, y, rot } = shape;

	const width = w;
	const height = h ?? fontSize * 10;

	if (rot === 0) {
		return Box2Ops.create(x, y, x + width, y + height);
	}

	const corners = [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height }
	];
	const rotatedCorners = corners.map((corner) => Vec2Ops.rotate(corner, rot));
	const translatedCorners = rotatedCorners.map((corner) => ({ x: corner.x + x, y: corner.y + y }));
	return Box2Ops.fromPoints(translatedCorners);
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
 * Get bounds for a stroke shape
 *
 * Computes the outline polygon and returns its bounding box
 */
function strokeBounds(shape: StrokeShape): Box2 {
	const { points } = shape.props;
	const { x, y } = shape;

	if (points.length < 2) {
		return Box2Ops.create(x, y, x, y);
	}

	const outline = getStrokeOutline(shape);
	const localBounds = boundsFromOutline(outline);
	return Box2Ops.create(localBounds.min.x + x, localBounds.min.y + y, localBounds.max.x + x, localBounds.max.y + y);
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
	const { x, y, rot } = shape;
	const { w, h } = shape.props;
	const localP = worldToLocal(p, x, y, rot);
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
	const { x, y, rot } = shape;
	const { w, h } = shape.props;

	const localP = worldToLocal(p, x, y, rot);

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
	const { x, y, rot } = shape;

	let points: Vec2[];
	if (shape.type === 'line') {
		points = [shape.props.a, shape.props.b];
	} else {
		if (!shape.props.points || shape.props.points.length < 2) {
			return false;
		}
		points = shape.props.points;
	}

	const localP = worldToLocal(p, x, y, rot);

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
	const { x, y, rot } = shape;
	const { fontSize, w } = shape.props;
	const localP = worldToLocal(p, x, y, rot);
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
	const { x, y, rot } = shape;
	const { w, h, fontSize } = shape.props;
	const localP = worldToLocal(p, x, y, rot);
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
	const local = worldToLocal(point, shape.x, shape.y, shape.rot);
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
	const local = worldToLocal(point, shape.x, shape.y, shape.rot);
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
	const { x, y } = shape;
	const { points } = shape.props;

	if (points.length < 2) return false;

	const bounds = strokeBounds(shape);
	if (p.x < bounds.min.x || p.x > bounds.max.x || p.y < bounds.min.y || p.y > bounds.max.y) {
		return false;
	}

	const localP = { x: p.x - x, y: p.y - y };

	const outline = getStrokeOutline(shape);
	return pointInPolygon(localP, outline);
}

/**
 * Transform a point from world coordinates to shape-local coordinates
 *
 * @param p - Point in world coordinates
 * @param shapeX - Shape x position
 * @param shapeY - Shape y position
 * @param shapeRot - Shape rotation in radians
 * @returns Point in shape-local coordinates
 */
function worldToLocal(p: Vec2, shapeX: number, shapeY: number, shapeRot: number): Vec2 {
	const translated = { x: p.x - shapeX, y: p.y - shapeY };

	if (shapeRot === 0) {
		return translated;
	}

	return Vec2Ops.rotate(translated, -shapeRot);
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
			case 'line':
			case 'arrow': {
				if (pointNearLine(worldPoint, shape, tolerance)) {
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
	let a: Vec2 = { x: arrow.x + firstPoint.x, y: arrow.y + firstPoint.y };
	let b: Vec2 = { x: arrow.x + lastPoint.x, y: arrow.y + lastPoint.y };

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
 * Compute orthogonal (Manhattan-style) routing between two points
 *
 * Creates a path with 2-4 segments that connects start to end using only horizontal and vertical lines.
 * The path avoids overlapping segments and creates clean right angles.
 *
 * @param start - Starting point
 * @param end - Ending point
 * @returns Array of points forming the orthogonal path (includes start and end)
 */
export function computeOrthogonalPath(start: Vec2, end: Vec2): Vec2[] {
	const dx = end.x - start.x;
	const dy = end.y - start.y;

	if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
		return [start, end];
	}

	if (Math.abs(dx) < 0.1) {
		return [start, end];
	}

	if (Math.abs(dy) < 0.1) {
		return [start, end];
	}

	const midX = start.x + dx / 2;

	return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
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
