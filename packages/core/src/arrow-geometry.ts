import type { ArrowLabel, ArrowStyle, PathGeometry } from './editor-model';
import type { Vec2 } from './math';
import { pathLength, pointAtPathDistance, trimPathGeometry } from './path-metrics';

/** Arrowhead shapes supported by the connector renderers. */
export type ArrowHeadStyle = 'open' | 'triangle';

/** Geometry needed to render one arrowhead independently of its shaft. */
export type ArrowHeadGeometry = {
	tip: Vec2;
	/** Unit direction pointing out from the path endpoint. */
	direction: Vec2;
	/** Unit tangent in the path's forward direction. */
	tangent: Vec2;
	left: Vec2;
	right: Vec2;
	length: number;
};

/** Position and local frame for an arrow label. */
export type ArrowLabelPlacement = {
	/** Label anchor after applying the normal offset. */
	point: Vec2;
	/** Point on the resolved path before applying the normal offset. */
	pathPoint: Vec2;
	/** Unit tangent in the path's forward direction. */
	tangent: Vec2;
	/** Left-hand unit normal in the path's local coordinate system. */
	normal: Vec2;
	/** Distance along the resolved path used for the anchor. */
	distance: number;
};

const DEFAULT_ARROWHEAD_LENGTH = 15;
const DEFAULT_ARROWHEAD_SPREAD = Math.PI / 6;
const EPSILON = Number.EPSILON;

/**
 * Resolve one arrowhead from the path endpoint tangent.
 *
 * `atStart` reverses the path tangent so the head points away from the path.
 * The returned points are in the same coordinate system as `path`.
 */
export function arrowHeadGeometry(
	path: PathGeometry,
	atStart: boolean,
	options: { length?: number; spread?: number } = {}
): ArrowHeadGeometry | null {
	const length = Math.max(0, options.length ?? DEFAULT_ARROWHEAD_LENGTH);
	const spread = options.spread ?? DEFAULT_ARROWHEAD_SPREAD;
	const totalLength = pathLength(path);
	if (totalLength <= EPSILON || length <= EPSILON) return null;

	const location = pointAtPathDistance(path, atStart ? 0 : totalLength);
	if (!location || (location.tangent.x === 0 && location.tangent.y === 0)) return null;

	const tangent = location.tangent;
	const direction = atStart ? { x: -tangent.x, y: -tangent.y } : tangent;
	const leftDirection = rotate(direction, -spread);
	const rightDirection = rotate(direction, spread);
	return {
		tip: location.point,
		direction,
		tangent,
		left: subtract(location.point, scale(leftDirection, length)),
		right: subtract(location.point, scale(rightDirection, length)),
		length
	};
}

/**
 * Return the shaft geometry after removing space occupied by filled heads.
 * Open heads remain attached to the path endpoint, while triangle heads stop
 * at their base so the shaft is not drawn through the filled shape.
 */
export function arrowShaftGeometry(path: PathGeometry, style: ArrowStyle): PathGeometry {
	const startHead = style.headStart === true ? (style.headStartStyle ?? 'open') : 'open';
	const endHead = style.headEnd !== false ? (style.headEndStyle ?? 'open') : 'open';
	const totalLength = pathLength(path);
	if (totalLength <= EPSILON) return path;

	const startTrim = startHead === 'triangle' ? DEFAULT_ARROWHEAD_LENGTH : 0;
	const endTrim = endHead === 'triangle' ? DEFAULT_ARROWHEAD_LENGTH : 0;
	if (startTrim === 0 && endTrim === 0) return path;
	return trimPathGeometry(path, startTrim, Math.max(startTrim, totalLength - endTrim)) ?? path;
}

/**
 * Resolve an arrow label from path distance and a local normal offset.
 *
 * `distance` is optional so labels created before explicit path-distance
 * storage continue to use their alignment anchor. `offset` is perpendicular
 * to the path; it does not change the label's distance along the route.
 */
export function arrowLabelPlacement(path: PathGeometry, label: ArrowLabel): ArrowLabelPlacement | null {
	const totalLength = pathLength(path);
	if (totalLength <= EPSILON) return null;

	const distance = clamp(label.distance ?? alignmentDistance(label.align, totalLength), 0, totalLength);
	const location = pointAtPathDistance(path, distance);
	if (!location) return null;

	const tangent = location.tangent;
	const normal = { x: -tangent.y, y: tangent.x };
	const offset = Number.isFinite(label.offset) ? label.offset : 0;
	return {
		point: add(location.point, scale(normal, offset)),
		pathPoint: location.point,
		tangent,
		normal,
		distance: location.distance
	};
}

function alignmentDistance(align: ArrowLabel['align'], totalLength: number): number {
	if (align === 'start') return 0;
	if (align === 'end') return totalLength;
	return totalLength / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
	if (!Number.isFinite(value)) return value < 0 ? minimum : maximum;
	return Math.max(minimum, Math.min(maximum, value));
}

function add(left: Vec2, right: Vec2): Vec2 {
	return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Vec2, right: Vec2): Vec2 {
	return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point: Vec2, factor: number): Vec2 {
	return { x: point.x * factor, y: point.y * factor };
}

function rotate(point: Vec2, angle: number): Vec2 {
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);
	return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}
