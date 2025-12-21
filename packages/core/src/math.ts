export type Vec2 = { x: number; y: number };

export const Vec2 = {
  /**
   * Add two vectors
   */
  add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
  },

  /**
   * Subtract vector b from vector a
   */
  sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
  },

  /**
   * Multiply vector by scalar
   */
  mulScalar(v: Vec2, s: number): Vec2 {
    return { x: v.x * s, y: v.y * s };
  },

  /**
   * Calculate length (magnitude) of vector
   */
  len(v: Vec2): number {
    return Math.hypot(v.x, v.y);
  },

  /**
   * Calculate squared length (faster, no sqrt)
   */
  lenSq(v: Vec2): number {
    return v.x * v.x + v.y * v.y;
  },

  /**
   * Normalize vector to unit length
   * Returns zero vector if input length is zero
   */
  normalize(v: Vec2): Vec2 {
    const length = Vec2.len(v);
    if (length === 0) {
      return { x: 0, y: 0 };
    }
    return { x: v.x / length, y: v.y / length };
  },

  /**
   * Calculate dot product of two vectors
   */
  dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  },

  /**
   * Calculate distance between two points
   */
  dist(a: Vec2, b: Vec2): number {
    return Vec2.len(Vec2.sub(a, b));
  },

  /**
   * Calculate squared distance (faster, no sqrt)
   */
  distSq(a: Vec2, b: Vec2): number {
    return Vec2.lenSq(Vec2.sub(a, b));
  },

  /**
   * Check if two vectors are approximately equal
   */
  equals(a: Vec2, b: Vec2, epsilon = 1e-10): boolean {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
  },

  /**
   * Create a new vector
   */
  create(x: number, y: number): Vec2 {
    return { x, y };
  },

  /**
   * Clone a vector
   */
  clone(v: Vec2): Vec2 {
    return { x: v.x, y: v.y };
  },
};

export type Box2 = { min: Vec2; max: Vec2 };

export const Box2 = {
  /**
   * Create a bounding box from an array of points
   */
  fromPoints(points: Vec2[]): Box2 {
    if (points.length === 0) {
      return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    for (let index = 1; index < points.length; index++) {
      const p = points[index];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  },

  /**
   * Create a box from center and size
   */
  fromCenterSize(center: Vec2, width: number, height: number): Box2 {
    const halfW = width / 2;
    const halfH = height / 2;
    return { min: { x: center.x - halfW, y: center.y - halfH }, max: { x: center.x + halfW, y: center.y + halfH } };
  },

  /**
   * Create a box from min/max coordinates
   */
  create(minX: number, minY: number, maxX: number, maxY: number): Box2 {
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  },

  /**
   * Check if a point is inside the box
   */
  containsPoint(box: Box2, point: Vec2): boolean {
    return (point.x >= box.min.x && point.x <= box.max.x && point.y >= box.min.y && point.y <= box.max.y);
  },

  /**
   * Check if two boxes intersect
   */
  intersectsBox(a: Box2, b: Box2): boolean {
    return !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y);
  },

  /**
   * Check if box a completely contains box b
   */
  containsBox(a: Box2, b: Box2): boolean {
    return (b.min.x >= a.min.x && b.max.x <= a.max.x && b.min.y >= a.min.y && b.max.y <= a.max.y);
  },

  /**
   * Get the width of the box
   */
  width(box: Box2): number {
    return box.max.x - box.min.x;
  },

  /**
   * Get the height of the box
   */
  height(box: Box2): number {
    return box.max.y - box.min.y;
  },

  /**
   * Get the center point of the box
   */
  center(box: Box2): Vec2 {
    return { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
  },

  /**
   * Get the area of the box
   */
  area(box: Box2): number {
    return Box2.width(box) * Box2.height(box);
  },

  /**
   * Expand box to include a point
   */
  expandToPoint(box: Box2, point: Vec2): Box2 {
    return {
      min: { x: Math.min(box.min.x, point.x), y: Math.min(box.min.y, point.y) },
      max: { x: Math.max(box.max.x, point.x), y: Math.max(box.max.y, point.y) },
    };
  },

  /**
   * Clone a box
   */
  clone(box: Box2): Box2 {
    return { min: { ...box.min }, max: { ...box.max } };
  },
};

/**
 * 3x3 matrix stored in column-major order for 2D affine transforms
 * Layout:
 * [a c tx]
 * [b d ty]
 * [0 0  1]
 *
 * Stored as: [a, b, 0, c, d, 0, tx, ty, 1]
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const Mat3 = {
  /**
   * Create an identity matrix
   */
  identity(): Mat3 {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  },

  /**
   * Create a translation matrix
   */
  translate(tx: number, ty: number): Mat3 {
    return [1, 0, 0, 0, 1, 0, tx, ty, 1];
  },

  /**
   * Create a scale matrix
   */
  scale(sx: number, sy: number): Mat3 {
    return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
  },

  /**
   * Create a rotation matrix
   * @param theta - angle in radians
   */
  rotate(theta: number): Mat3 {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return [c, s, 0, -s, c, 0, 0, 0, 1];
  },

  /**
   * Multiply two matrices: result = a * b
   * Order matters: transformations are applied right to left
   */
  multiply(a: Mat3, b: Mat3): Mat3 {
    const a00 = a[0], a01 = a[1], a02 = a[2];
    const a10 = a[3], a11 = a[4], a12 = a[5];
    const a20 = a[6], a21 = a[7], a22 = a[8];

    const b00 = b[0], b01 = b[1], b02 = b[2];
    const b10 = b[3], b11 = b[4], b12 = b[5];
    const b20 = b[6], b21 = b[7], b22 = b[8];

    return [
      a00 * b00 + a10 * b01 + a20 * b02,
      a01 * b00 + a11 * b01 + a21 * b02,
      a02 * b00 + a12 * b01 + a22 * b02,

      a00 * b10 + a10 * b11 + a20 * b12,
      a01 * b10 + a11 * b11 + a21 * b12,
      a02 * b10 + a12 * b11 + a22 * b12,

      a00 * b20 + a10 * b21 + a20 * b22,
      a01 * b20 + a11 * b21 + a21 * b22,
      a02 * b20 + a12 * b21 + a22 * b22,
    ];
  },

  /**
   * Transform a point by a matrix
   */
  transformPoint(m: Mat3, p: Vec2): Vec2 {
    const x = m[0] * p.x + m[3] * p.y + m[6];
    const y = m[1] * p.x + m[4] * p.y + m[7];
    return { x, y };
  },

  /**
   * Invert a matrix
   * Returns null if matrix is not invertible
   */
  invert(m: Mat3): Mat3 | null {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[3], a11 = m[4], a12 = m[5];
    const a20 = m[6], a21 = m[7], a22 = m[8];

    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;

    const det = a00 * b01 + a01 * b11 + a02 * b21;

    if (Math.abs(det) < 1e-10) {
      return null;
    }

    const invDet = 1 / det;

    return [
      b01 * invDet,
      (-a22 * a01 + a02 * a21) * invDet,
      (a12 * a01 - a02 * a11) * invDet,

      b11 * invDet,
      (a22 * a00 - a02 * a20) * invDet,
      (-a12 * a00 + a02 * a10) * invDet,

      b21 * invDet,
      (-a21 * a00 + a01 * a20) * invDet,
      (a11 * a00 - a01 * a10) * invDet,
    ];
  },

  /**
   * Get the determinant of a matrix
   */
  determinant(m: Mat3): number {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[3], a11 = m[4], a12 = m[5];
    const a20 = m[6], a21 = m[7], a22 = m[8];

    return (a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20));
  },

  /**
   * Clone a matrix
   */
  clone(m: Mat3): Mat3 {
    return [...m] as Mat3;
  },

  /**
   * Check if two matrices are approximately equal
   */
  equals(a: Mat3, b: Mat3, epsilon = 1e-10): boolean {
    for (let index = 0; index < 9; index++) {
      if (Math.abs(a[index] - b[index]) >= epsilon) {
        return false;
      }
    }
    return true;
  },

  /**
   * Create a combined transform matrix
   * Applies in order: translate -> rotate -> scale
   */
  fromTransform(tx: number, ty: number, rotation: number, sx: number, sy: number): Mat3 {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);

    return [c * sx, s * sx, 0, -s * sy, c * sy, 0, tx, ty, 1];
  },
};
