import type { Box2, Vec2 } from "./math";
import { Box2 as Box2Ops, Vec2 as Vec2Ops } from "./math";
import type { ArrowShape, EllipseShape, LineShape, RectShape, ShapeRecord, TextShape } from "./model";
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

/**
 * Get bounds for an arrow shape
 */
function arrowBounds(shape: ArrowShape): Box2 {
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
  const { a, b } = shape.props;
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
    }
  }

  return null;
}
