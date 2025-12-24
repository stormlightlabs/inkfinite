import getStroke from "perfect-freehand";
import type { Box2, Vec2 } from "./math";
import { Box2 as Box2Ops, Vec2 as Vec2Ops } from "./math";
import type {
  ArrowShape,
  BrushConfig,
  EllipseShape,
  LineShape,
  RectShape,
  ShapeRecord,
  StrokePoint,
  StrokeShape,
  TextShape,
} from "./model";
import type { EditorState } from "./reactivity";
import { getShapesOnCurrentPage } from "./reactivity";

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
    case "rect": {
      return rectBounds(shape);
    }
    case "ellipse": {
      return ellipseBounds(shape);
    }
    case "line": {
      return lineBounds(shape);
    }
    case "arrow": {
      return arrowBounds(shape);
    }
    case "text": {
      return textBounds(shape);
    }
    case "stroke": {
      return strokeBounds(shape);
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

  const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const rotatedCorners = corners.map((corner) => rotatePoint(corner, rot));
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

  const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const rotatedCorners = corners.map((corner) => rotatePoint(corner, rot));
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

  const rotatedPoints = points.map((p) => rotatePoint(p, rot));
  const translatedPoints = rotatedPoints.map((p) => ({ x: p.x + x, y: p.y + y }));
  return Box2Ops.fromPoints(translatedPoints);
}

function arrowBounds(shape: ArrowShape): Box2 {
  const { x, y, rot } = shape;

  let points: Vec2[];
  if (shape.props.a && shape.props.b) {
    points = [shape.props.a, shape.props.b];
  } else if (shape.props.points && shape.props.points.length >= 2) {
    points = shape.props.points;
  } else {
    return { min: { x, y }, max: { x, y } };
  }

  if (rot === 0) {
    const translatedPoints = points.map((p) => ({ x: p.x + x, y: p.y + y }));
    return Box2Ops.fromPoints(translatedPoints);
  }

  const rotatedPoints = points.map((p) => rotatePoint(p, rot));
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

  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];

  const rotatedCorners = corners.map((corner) => rotatePoint(corner, rot));
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
    simulatePressure: brush.simulatePressure,
  });

  return outlinePoints.map((p) => ({ x: p[0], y: p[1] }));
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
  const { points, brush } = shape.props;
  const { x, y } = shape;

  if (points.length < 2) {
    return Box2Ops.create(x, y, x, y);
  }

  const outline = computeOutline(points, brush);
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
function rotatePoint(p: Vec2, theta: number): Vec2 {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

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

  let a: Vec2, b: Vec2;
  if (shape.type === "line") {
    a = shape.props.a;
    b = shape.props.b;
  } else {
    if (shape.props.a && shape.props.b) {
      a = shape.props.a;
      b = shape.props.b;
    } else if (shape.props.points && shape.props.points.length >= 2) {
      a = shape.props.points[0];
      b = shape.props.points[shape.props.points.length - 1];
    } else {
      return false;
    }
  }

  const localP = worldToLocal(p, x, y, rot);
  return pointNearSegment(localP, a, b, tolerance);
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
  const { points, brush } = shape.props;

  if (points.length < 2) return false;

  const bounds = strokeBounds(shape);
  if (p.x < bounds.min.x || p.x > bounds.max.x || p.y < bounds.min.y || p.y > bounds.max.y) {
    return false;
  }

  const localP = { x: p.x - x, y: p.y - y };

  const outline = computeOutline(points, brush);
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

  return rotatePoint(translated, -shapeRot);
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
  const shapes = getShapesOnCurrentPage(state);

  for (let index = shapes.length - 1; index >= 0; index--) {
    const shape = shapes[index];

    switch (shape.type) {
      case "rect": {
        if (pointInRect(worldPoint, shape)) {
          return shape.id;
        }
        break;
      }
      case "ellipse": {
        if (pointInEllipse(worldPoint, shape)) {
          return shape.id;
        }
        break;
      }
      case "line":
      case "arrow": {
        if (pointNearLine(worldPoint, shape, tolerance)) {
          return shape.id;
        }
        break;
      }
      case "text": {
        if (pointInText(worldPoint, shape)) {
          return shape.id;
        }
        break;
      }
      case "stroke": {
        if (hitTestStroke(worldPoint, shape)) {
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
 * @returns World coordinates of the anchor point
 */
export function computeEdgeAnchor(shape: ShapeRecord, nx: number, ny: number): Vec2 {
  const bounds = shapeBounds(shape);
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  const halfWidth = (bounds.max.x - bounds.min.x) / 2;
  const halfHeight = (bounds.max.y - bounds.min.y) / 2;

  return { x: centerX + nx * halfWidth, y: centerY + ny * halfHeight };
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
  if (!arrow || arrow.type !== "arrow") return null;

  let a: Vec2, b: Vec2;
  if (arrow.props.a && arrow.props.b) {
    a = { x: arrow.x + arrow.props.a.x, y: arrow.y + arrow.props.a.y };
    b = { x: arrow.x + arrow.props.b.x, y: arrow.y + arrow.props.b.y };
  } else if (arrow.props.points && arrow.props.points.length >= 2) {
    const firstPoint = arrow.props.points[0];
    const lastPoint = arrow.props.points[arrow.props.points.length - 1];
    a = { x: arrow.x + firstPoint.x, y: arrow.y + firstPoint.y };
    b = { x: arrow.x + lastPoint.x, y: arrow.y + lastPoint.y };
  } else {
    return null;
  }

  for (const binding of Object.values(state.doc.bindings)) {
    if (binding.fromShapeId !== arrowId) continue;

    const targetShape = state.doc.shapes[binding.toShapeId];
    if (!targetShape) continue;

    let anchorPoint: Vec2;
    if (binding.anchor.kind === "center") {
      anchorPoint = shapeCenter(targetShape);
    } else {
      anchorPoint = computeEdgeAnchor(targetShape, binding.anchor.nx, binding.anchor.ny);
    }

    if (binding.handle === "start") {
      a = anchorPoint;
    } else if (binding.handle === "end") {
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
