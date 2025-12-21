import { describe, expect, it } from "vitest";
import { Box2, Mat3, Vec2 } from "../src/math";

describe("Vec2", () => {
  describe("add", () => {
    it.each([{
      description: "should add two positive vectors",
      a: { x: 1, y: 2 },
      b: { x: 3, y: 4 },
      expected: { x: 4, y: 6 },
    }, {
      description: "should handle negative values",
      a: { x: -1, y: -2 },
      b: { x: 3, y: 4 },
      expected: { x: 2, y: 2 },
    }, {
      description: "should handle zero vectors",
      a: { x: 0, y: 0 },
      b: { x: 5, y: 10 },
      expected: { x: 5, y: 10 },
    }])("$description", ({ a, b, expected }) => {
      expect(Vec2.add(a, b)).toEqual(expected);
    });

    it("should be commutative", () => {
      const a = { x: 1, y: 2 };
      const b = { x: 3, y: 4 };
      expect(Vec2.add(a, b)).toEqual(Vec2.add(b, a));
    });
  });

  describe("sub", () => {
    it.each([{
      description: "should subtract two vectors",
      a: { x: 5, y: 7 },
      b: { x: 2, y: 3 },
      expected: { x: 3, y: 4 },
    }, {
      description: "should handle negative results",
      a: { x: 1, y: 2 },
      b: { x: 3, y: 4 },
      expected: { x: -2, y: -2 },
    }, {
      description: "should handle zero vectors",
      a: { x: 5, y: 10 },
      b: { x: 0, y: 0 },
      expected: { x: 5, y: 10 },
    }])("$description", ({ a, b, expected }) => {
      expect(Vec2.sub(a, b)).toEqual(expected);
    });

    it("should return zero vector when subtracting identical vectors", () => {
      const a = { x: 5, y: 10 };
      expect(Vec2.sub(a, a)).toEqual({ x: 0, y: 0 });
    });
  });

  describe("mulScalar", () => {
    it.each([
      { description: "should multiply by positive scalar", v: { x: 2, y: 3 }, scalar: 4, expected: { x: 8, y: 12 } },
      { description: "should multiply by negative scalar", v: { x: 2, y: 3 }, scalar: -2, expected: { x: -4, y: -6 } },
      { description: "should multiply by zero", v: { x: 5, y: 10 }, scalar: 0, expected: { x: 0, y: 0 } },
      { description: "should multiply by one (identity)", v: { x: 5, y: 10 }, scalar: 1, expected: { x: 5, y: 10 } },
      { description: "should handle fractional scalars", v: { x: 10, y: 20 }, scalar: 0.5, expected: { x: 5, y: 10 } },
    ])("$description", ({ v, scalar, expected }) => {
      expect(Vec2.mulScalar(v, scalar)).toEqual(expected);
    });
  });

  describe("len", () => {
    it.each([
      { description: "should calculate length of 3-4-5 triangle", v: { x: 3, y: 4 }, expected: 5 },
      { description: "should return zero for zero vector", v: { x: 0, y: 0 }, expected: 0 },
      { description: "should handle negative components", v: { x: -3, y: -4 }, expected: 5 },
      { description: "should calculate length for unit vector X", v: { x: 1, y: 0 }, expected: 1 },
      { description: "should calculate length for unit vector Y", v: { x: 0, y: 1 }, expected: 1 },
    ])("$description", ({ v, expected }) => {
      expect(Vec2.len(v)).toBe(expected);
    });

    it("should handle very small vectors", () => {
      const v = { x: 1e-10, y: 1e-10 };
      expect(Vec2.len(v)).toBeCloseTo(Math.sqrt(2) * 1e-10, 20);
    });
  });

  describe("lenSq", () => {
    it.each([{ description: "should calculate squared length", v: { x: 3, y: 4 }, expected: 25 }, {
      description: "should return zero for zero vector",
      v: { x: 0, y: 0 },
      expected: 0,
    }])("$description", ({ v, expected }) => {
      expect(Vec2.lenSq(v)).toBe(expected);
    });

    it("should match len squared", () => {
      const v = { x: 3, y: 4 };
      expect(Vec2.lenSq(v)).toBe(Vec2.len(v) ** 2);
    });
  });

  describe("normalize", () => {
    it("should normalize vector to unit length", () => {
      const v = { x: 3, y: 4 };
      const result = Vec2.normalize(v);
      expect(result.x).toBeCloseTo(0.6);
      expect(result.y).toBeCloseTo(0.8);
      expect(Vec2.len(result)).toBeCloseTo(1);
    });

    it("should handle zero vector (return zero)", () => {
      const v = { x: 0, y: 0 };
      expect(Vec2.normalize(v)).toEqual({ x: 0, y: 0 });
    });

    it("should handle already normalized vectors", () => {
      const v = { x: 1, y: 0 };
      const result = Vec2.normalize(v);
      expect(result.x).toBeCloseTo(1);
      expect(result.y).toBeCloseTo(0);
    });

    it("should handle negative components", () => {
      const v = { x: -3, y: -4 };
      const result = Vec2.normalize(v);
      expect(result.x).toBeCloseTo(-0.6);
      expect(result.y).toBeCloseTo(-0.8);
      expect(Vec2.len(result)).toBeCloseTo(1);
    });

    it("should handle very small vectors", () => {
      const v = { x: 1e-100, y: 1e-100 };
      const result = Vec2.normalize(v);
      const expectedX = 1 / Math.sqrt(2);
      expect(result.x).toBeCloseTo(expectedX, 5);
      expect(result.y).toBeCloseTo(expectedX, 5);
    });
  });

  describe("dot", () => {
    it.each([
      { description: "should calculate dot product", a: { x: 2, y: 3 }, b: { x: 4, y: 5 }, expected: 23 },
      {
        description: "should return zero for perpendicular vectors",
        a: { x: 1, y: 0 },
        b: { x: 0, y: 1 },
        expected: 0,
      },
      { description: "should handle negative values", a: { x: 2, y: 3 }, b: { x: -4, y: -5 }, expected: -23 },
      { description: "should return zero with zero vector", a: { x: 5, y: 10 }, b: { x: 0, y: 0 }, expected: 0 },
      {
        description: "should calculate dot product of parallel vectors",
        a: { x: 2, y: 3 },
        b: { x: 4, y: 6 },
        expected: 26,
      },
    ])("$description", ({ a, b, expected }) => {
      expect(Vec2.dot(a, b)).toBe(expected);
    });

    it("should be commutative", () => {
      const a = { x: 2, y: 3 };
      const b = { x: 4, y: 5 };
      expect(Vec2.dot(a, b)).toBe(Vec2.dot(b, a));
    });
  });

  describe("dist and distSq", () => {
    it.each([{
      description: "should calculate distance between two points",
      a: { x: 0, y: 0 },
      b: { x: 3, y: 4 },
      expectedDist: 5,
      expectedDistSq: 25,
    }, {
      description: "should return zero for identical points",
      a: { x: 5, y: 10 },
      b: { x: 5, y: 10 },
      expectedDist: 0,
      expectedDistSq: 0,
    }, {
      description: "should handle negative coordinates",
      a: { x: -3, y: -4 },
      b: { x: 0, y: 0 },
      expectedDist: 5,
      expectedDistSq: 25,
    }])("$description", ({ a, b, expectedDist, expectedDistSq }) => {
      expect(Vec2.dist(a, b)).toBe(expectedDist);
      expect(Vec2.distSq(a, b)).toBe(expectedDistSq);
    });

    it("should be symmetric", () => {
      const a = { x: 1, y: 2 };
      const b = { x: 4, y: 6 };
      expect(Vec2.dist(a, b)).toBe(Vec2.dist(b, a));
    });

    it("distSq should match dist squared", () => {
      const a = { x: 1, y: 2 };
      const b = { x: 4, y: 6 };
      expect(Vec2.distSq(a, b)).toBe(Vec2.dist(a, b) ** 2);
    });
  });

  describe("equals", () => {
    it.each([{
      description: "should return true for identical vectors",
      a: { x: 1.5, y: 2.5 },
      b: { x: 1.5, y: 2.5 },
      expected: true,
    }, {
      description: "should return false for different vectors",
      a: { x: 1, y: 2 },
      b: { x: 3, y: 4 },
      expected: false,
    }])("$description", ({ a, b, expected }) => {
      expect(Vec2.equals(a, b)).toBe(expected);
    });

    it("should use epsilon for floating point comparison", () => {
      const a = { x: 1 + 5e-11, y: 2 + 5e-11 };
      const b = { x: 1, y: 2 };
      expect(Vec2.equals(a, b)).toBe(true);
    });

    it("should allow custom epsilon", () => {
      const a = { x: 1.001, y: 2.001 };
      const b = { x: 1, y: 2 };
      expect(Vec2.equals(a, b, 0.01)).toBe(true);
      expect(Vec2.equals(a, b, 0.0001)).toBe(false);
    });
  });

  describe("create and clone", () => {
    it("should create a vector", () => {
      expect(Vec2.create(3, 4)).toEqual({ x: 3, y: 4 });
    });

    it("should clone a vector", () => {
      const original = { x: 5, y: 10 };
      const cloned = Vec2.clone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });
  });
});

describe("Box2", () => {
  describe("fromPoints", () => {
    it.each([
      {
        description: "should create box from multiple points",
        points: [{ x: 1, y: 2 }, { x: 5, y: 8 }, { x: 3, y: 4 }],
        expected: { min: { x: 1, y: 2 }, max: { x: 5, y: 8 } },
      },
      {
        description: "should handle single point",
        points: [{ x: 3, y: 4 }],
        expected: { min: { x: 3, y: 4 }, max: { x: 3, y: 4 } },
      },
      { description: "should handle empty array", points: [], expected: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } },
      {
        description: "should handle negative coordinates",
        points: [{ x: -5, y: -3 }, { x: 2, y: 4 }, { x: -1, y: 0 }],
        expected: { min: { x: -5, y: -3 }, max: { x: 2, y: 4 } },
      },
    ])("$description", ({ points, expected }) => {
      expect(Box2.fromPoints(points)).toEqual(expected);
    });

    it("should handle points in any order", () => {
      const points1 = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
      const points2 = [{ x: 10, y: 10 }, { x: 0, y: 0 }];
      expect(Box2.fromPoints(points1)).toEqual(Box2.fromPoints(points2));
    });
  });

  describe("fromCenterSize", () => {
    it("should create box from center and size", () => {
      const center = { x: 5, y: 5 };
      const box = Box2.fromCenterSize(center, 10, 6);
      expect(box).toEqual({ min: { x: 0, y: 2 }, max: { x: 10, y: 8 } });
    });

    it("should handle zero size", () => {
      const center = { x: 5, y: 5 };
      const box = Box2.fromCenterSize(center, 0, 0);
      expect(box).toEqual({ min: { x: 5, y: 5 }, max: { x: 5, y: 5 } });
    });

    it("should handle odd dimensions", () => {
      const center = { x: 0, y: 0 };
      const box = Box2.fromCenterSize(center, 5, 3);
      expect(box.min.x).toBeCloseTo(-2.5);
      expect(box.min.y).toBeCloseTo(-1.5);
      expect(box.max.x).toBeCloseTo(2.5);
      expect(box.max.y).toBeCloseTo(1.5);
    });
  });

  describe("create", () => {
    it("should create box from coordinates", () => {
      expect(Box2.create(0, 0, 10, 10)).toEqual({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } });
    });
  });

  describe("containsPoint", () => {
    const box = Box2.create(0, 0, 10, 10);

    it.each([
      { description: "point inside box", point: { x: 5, y: 5 }, expected: true },
      { description: "point on left edge", point: { x: 0, y: 5 }, expected: true },
      { description: "point on right edge", point: { x: 10, y: 5 }, expected: true },
      { description: "point on top edge", point: { x: 5, y: 0 }, expected: true },
      { description: "point on bottom edge", point: { x: 5, y: 10 }, expected: true },
      { description: "top-left corner", point: { x: 0, y: 0 }, expected: true },
      { description: "bottom-right corner", point: { x: 10, y: 10 }, expected: true },
      { description: "point left of box", point: { x: -1, y: 5 }, expected: false },
      { description: "point right of box", point: { x: 11, y: 5 }, expected: false },
      { description: "point above box", point: { x: 5, y: -1 }, expected: false },
      { description: "point below box", point: { x: 5, y: 11 }, expected: false },
    ])("should handle $description", ({ point, expected }) => {
      expect(Box2.containsPoint(box, point)).toBe(expected);
    });

    it("should handle negative coordinates", () => {
      const negBox = Box2.create(-10, -10, 10, 10);
      expect(Box2.containsPoint(negBox, { x: 0, y: 0 })).toBe(true);
      expect(Box2.containsPoint(negBox, { x: -5, y: -5 })).toBe(true);
      expect(Box2.containsPoint(negBox, { x: -11, y: 0 })).toBe(false);
    });

    it("should handle zero-size box", () => {
      const pointBox = Box2.create(5, 5, 5, 5);
      expect(Box2.containsPoint(pointBox, { x: 5, y: 5 })).toBe(true);
      expect(Box2.containsPoint(pointBox, { x: 5.1, y: 5 })).toBe(false);
    });
  });

  describe("intersectsBox", () => {
    it.each([{
      description: "overlapping boxes",
      a: Box2.create(0, 0, 10, 10),
      b: Box2.create(5, 5, 15, 15),
      expected: true,
    }, {
      description: "boxes touching at edge",
      a: Box2.create(0, 0, 10, 10),
      b: Box2.create(10, 0, 20, 10),
      expected: true,
    }, {
      description: "one box contains another",
      a: Box2.create(0, 0, 10, 10),
      b: Box2.create(2, 2, 8, 8),
      expected: true,
    }, {
      description: "non-overlapping boxes",
      a: Box2.create(0, 0, 10, 10),
      b: Box2.create(11, 11, 20, 20),
      expected: false,
    }, {
      description: "boxes separated horizontally",
      a: Box2.create(0, 0, 10, 10),
      b: Box2.create(11, 0, 20, 10),
      expected: false,
    }, {
      description: "boxes separated vertically",
      a: Box2.create(0, 0, 10, 10),
      b: Box2.create(0, 11, 10, 20),
      expected: false,
    }])("should handle $description", ({ a, b, expected }) => {
      expect(Box2.intersectsBox(a, b)).toBe(expected);
    });

    it("should handle negative coordinates", () => {
      const a = Box2.create(-10, -10, 0, 0);
      const b = Box2.create(-5, -5, 5, 5);
      expect(Box2.intersectsBox(a, b)).toBe(true);
    });

    it("should be symmetric", () => {
      const a = Box2.create(0, 0, 10, 10);
      const b = Box2.create(5, 5, 15, 15);
      expect(Box2.intersectsBox(a, b)).toBe(Box2.intersectsBox(b, a));
    });
  });

  describe("containsBox", () => {
    it.each([
      { description: "a contains b", a: Box2.create(0, 0, 10, 10), b: Box2.create(2, 2, 8, 8), expected: true },
      {
        description: "b contains a (should be false)",
        a: Box2.create(2, 2, 8, 8),
        b: Box2.create(0, 0, 10, 10),
        expected: false,
      },
      { description: "identical boxes", a: Box2.create(0, 0, 10, 10), b: Box2.create(0, 0, 10, 10), expected: true },
      {
        description: "overlapping but not contained",
        a: Box2.create(0, 0, 10, 10),
        b: Box2.create(5, 5, 15, 15),
        expected: false,
      },
      {
        description: "boxes just touching",
        a: Box2.create(0, 0, 10, 10),
        b: Box2.create(10, 0, 20, 10),
        expected: false,
      },
    ])("should handle $description", ({ a, b, expected }) => {
      expect(Box2.containsBox(a, b)).toBe(expected);
    });
  });

  describe("width, height, center, area", () => {
    it.each([{
      description: "standard box",
      box: Box2.create(0, 0, 10, 5),
      width: 10,
      height: 5,
      center: { x: 5, y: 2.5 },
      area: 50,
    }, {
      description: "zero-width box",
      box: Box2.create(5, 5, 5, 10),
      width: 0,
      height: 5,
      center: { x: 5, y: 7.5 },
      area: 0,
    }, {
      description: "negative coordinate box",
      box: Box2.create(-10, -5, 10, 5),
      width: 20,
      height: 10,
      center: { x: 0, y: 0 },
      area: 200,
    }, {
      description: "zero-size box",
      box: Box2.create(5, 5, 5, 5),
      width: 0,
      height: 0,
      center: { x: 5, y: 5 },
      area: 0,
    }])("should calculate properties for $description", ({ box, width, height, center, area }) => {
      expect(Box2.width(box)).toBe(width);
      expect(Box2.height(box)).toBe(height);
      expect(Box2.center(box)).toEqual(center);
      expect(Box2.area(box)).toBe(area);
    });
  });

  describe("expandToPoint", () => {
    it.each([{
      description: "expand to point outside (right)",
      box: Box2.create(0, 0, 10, 10),
      point: { x: 15, y: 5 },
      expected: { min: { x: 0, y: 0 }, max: { x: 15, y: 10 } },
    }, {
      description: "point inside (no change)",
      box: Box2.create(0, 0, 10, 10),
      point: { x: 5, y: 5 },
      expected: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
    }, {
      description: "expand in multiple directions",
      box: Box2.create(5, 5, 10, 10),
      point: { x: 0, y: 15 },
      expected: { min: { x: 0, y: 5 }, max: { x: 10, y: 15 } },
    }, {
      description: "expand to negative coordinates",
      box: Box2.create(0, 0, 10, 10),
      point: { x: -5, y: -5 },
      expected: { min: { x: -5, y: -5 }, max: { x: 10, y: 10 } },
    }])("should $description", ({ box, point, expected }) => {
      expect(Box2.expandToPoint(box, point)).toEqual(expected);
    });
  });

  describe("clone", () => {
    it("should create a copy of the box", () => {
      const box = Box2.create(0, 0, 10, 10);
      const cloned = Box2.clone(box);
      expect(cloned).toEqual(box);
      expect(cloned).not.toBe(box);
      expect(cloned.min).not.toBe(box.min);
      expect(cloned.max).not.toBe(box.max);
    });
  });
});

describe("Mat3", () => {
  describe("identity", () => {
    it("should create identity matrix", () => {
      expect(Mat3.identity()).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });

    it("should not transform points", () => {
      const m = Mat3.identity();
      const p = { x: 5, y: 10 };
      expect(Mat3.transformPoint(m, p)).toEqual(p);
    });
  });

  describe("translate", () => {
    it.each([{ description: "positive translation", tx: 5, ty: 10, point: { x: 0, y: 0 }, expected: { x: 5, y: 10 } }, {
      description: "negative translation",
      tx: -5,
      ty: -10,
      point: { x: 5, y: 10 },
      expected: { x: 0, y: 0 },
    }, {
      description: "zero translation (identity)",
      tx: 0,
      ty: 0,
      point: { x: 5, y: 10 },
      expected: { x: 5, y: 10 },
    }])("should handle $description", ({ tx, ty, point, expected }) => {
      const m = Mat3.translate(tx, ty);
      expect(Mat3.transformPoint(m, point)).toEqual(expected);
    });

    it("should create correct matrix structure", () => {
      expect(Mat3.translate(5, 10)).toEqual([1, 0, 0, 0, 1, 0, 5, 10, 1]);
    });
  });

  describe("scale", () => {
    it.each([
      { description: "non-uniform scale", sx: 2, sy: 3, point: { x: 5, y: 10 }, expected: { x: 10, y: 30 } },
      { description: "uniform scale", sx: 2, sy: 2, point: { x: 5, y: 10 }, expected: { x: 10, y: 20 } },
      { description: "scale by 1 (identity)", sx: 1, sy: 1, point: { x: 5, y: 10 }, expected: { x: 5, y: 10 } },
      { description: "scale by 0 (collapse)", sx: 0, sy: 0, point: { x: 5, y: 10 }, expected: { x: 0, y: 0 } },
    ])("should handle $description", ({ sx, sy, point, expected }) => {
      const m = Mat3.scale(sx, sy);
      expect(Mat3.transformPoint(m, point)).toEqual(expected);
    });

    it("should handle negative scale (flip)", () => {
      const m = Mat3.scale(-1, 1);
      const result = Mat3.transformPoint(m, { x: 5, y: 10 });
      expect(result).toEqual({ x: -5, y: 10 });
    });
  });

  describe("rotate", () => {
    it.each([
      {
        description: "90 degrees counterclockwise",
        angle: Math.PI / 2,
        point: { x: 1, y: 0 },
        expected: { x: 0, y: 1 },
      },
      { description: "180 degrees", angle: Math.PI, point: { x: 1, y: 0 }, expected: { x: -1, y: 0 } },
      { description: "zero rotation", angle: 0, point: { x: 5, y: 10 }, expected: { x: 5, y: 10 } },
      {
        description: "360 degrees (full rotation)",
        angle: 2 * Math.PI,
        point: { x: 5, y: 10 },
        expected: { x: 5, y: 10 },
      },
      { description: "-90 degrees (clockwise)", angle: -Math.PI / 2, point: { x: 1, y: 0 }, expected: { x: 0, y: -1 } },
    ])("should handle $description", ({ angle, point, expected }) => {
      const m = Mat3.rotate(angle);
      const result = Mat3.transformPoint(m, point);
      expect(result.x).toBeCloseTo(expected.x, 10);
      expect(result.y).toBeCloseTo(expected.y, 10);
    });
  });

  describe("multiply", () => {
    it("should combine translations", () => {
      const a = Mat3.translate(5, 0);
      const b = Mat3.translate(0, 10);
      const result = Mat3.multiply(a, b);
      const transformed = Mat3.transformPoint(result, { x: 0, y: 0 });
      expect(transformed).toEqual({ x: 5, y: 10 });
    });

    it("should apply transforms right to left", () => {
      const translate = Mat3.translate(10, 0);
      const scale = Mat3.scale(2, 1);
      const result = Mat3.multiply(translate, scale);
      const transformed = Mat3.transformPoint(result, { x: 5, y: 0 });
      expect(transformed.x).toBeCloseTo(20);
    });

    it("should handle identity multiplication", () => {
      const m = Mat3.translate(5, 10);
      const identity = Mat3.identity();
      expect(Mat3.equals(Mat3.multiply(m, identity), m)).toBe(true);
      expect(Mat3.equals(Mat3.multiply(identity, m), m)).toBe(true);
    });

    it("should be associative", () => {
      const a = Mat3.translate(1, 2);
      const b = Mat3.scale(2, 3);
      const c = Mat3.rotate(Math.PI / 4);
      const result1 = Mat3.multiply(Mat3.multiply(a, b), c);
      const result2 = Mat3.multiply(a, Mat3.multiply(b, c));
      expect(Mat3.equals(result1, result2)).toBe(true);
    });

    it("should not be commutative", () => {
      const a = Mat3.translate(10, 0);
      const b = Mat3.scale(2, 1);
      const result1 = Mat3.multiply(a, b);
      const result2 = Mat3.multiply(b, a);
      expect(Mat3.equals(result1, result2)).toBe(false);
    });
  });

  describe("transformPoint", () => {
    it("should transform through combined transforms", () => {
      const m = Mat3.multiply(Mat3.translate(10, 20), Mat3.multiply(Mat3.rotate(Math.PI / 2), Mat3.scale(2, 2)));
      const result = Mat3.transformPoint(m, { x: 1, y: 0 });
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(22);
    });

    it("should handle origin point", () => {
      const m = Mat3.translate(5, 10);
      expect(Mat3.transformPoint(m, { x: 0, y: 0 })).toEqual({ x: 5, y: 10 });
    });
  });

  describe("invert", () => {
    it.each([{ description: "translation", matrix: Mat3.translate(5, 10) }, {
      description: "scale",
      matrix: Mat3.scale(2, 3),
    }, { description: "rotation", matrix: Mat3.rotate(Math.PI / 3) }])("should invert $description", ({ matrix }) => {
      const inv = Mat3.invert(matrix);
      expect(inv).not.toBeNull();

      const p = { x: 10, y: 20 };
      const transformed = Mat3.transformPoint(matrix, p);
      const restored = Mat3.transformPoint(inv!, transformed);

      expect(restored.x).toBeCloseTo(p.x);
      expect(restored.y).toBeCloseTo(p.y);
    });

    it("should invert identity to identity", () => {
      const m = Mat3.identity();
      const inv = Mat3.invert(m);
      expect(inv).not.toBeNull();
      expect(Mat3.equals(inv!, m)).toBe(true);
    });

    it("should return null for non-invertible matrix", () => {
      const m = Mat3.scale(0, 0);
      expect(Mat3.invert(m)).toBeNull();
    });

    it("should satisfy M * M^-1 = I", () => {
      const m = Mat3.multiply(Mat3.translate(5, 10), Mat3.multiply(Mat3.rotate(0.5), Mat3.scale(2, 3)));
      const inv = Mat3.invert(m);
      expect(inv).not.toBeNull();

      const identity = Mat3.multiply(m, inv!);
      expect(Mat3.equals(identity, Mat3.identity(), 1e-10)).toBe(true);
    });
  });

  describe("determinant", () => {
    it.each([
      { description: "identity", matrix: Mat3.identity(), expected: 1 },
      { description: "translation", matrix: Mat3.translate(5, 10), expected: 1 },
      { description: "scale 2x3", matrix: Mat3.scale(2, 3), expected: 6 },
      { description: "rotation", matrix: Mat3.rotate(Math.PI / 4), expected: 1 },
      { description: "singular matrix", matrix: Mat3.scale(0, 5), expected: 0 },
      { description: "reflection", matrix: Mat3.scale(-1, 1), expected: -1 },
    ])("should calculate determinant for $description", ({ matrix, expected }) => {
      expect(Mat3.determinant(matrix)).toBeCloseTo(expected, 10);
    });
  });

  describe("clone and equals", () => {
    it("should clone matrix", () => {
      const m = Mat3.translate(5, 10);
      const cloned = Mat3.clone(m);
      expect(cloned).toEqual(m);
      expect(cloned).not.toBe(m);
    });

    it.each([
      { description: "identical matrices", a: Mat3.translate(5, 10), b: Mat3.translate(5, 10), expected: true },
      { description: "different matrices", a: Mat3.translate(5, 10), b: Mat3.translate(10, 5), expected: false },
    ])("should compare $description", ({ a, b, expected }) => {
      expect(Mat3.equals(a, b)).toBe(expected);
    });

    it("should use epsilon for floating point comparison", () => {
      const a = Mat3.rotate(Math.PI / 4);
      const b = Mat3.clone(a);
      b[0] += 1e-15;
      expect(Mat3.equals(a, b)).toBe(true);
    });

    it("should allow custom epsilon", () => {
      const a = Mat3.identity();
      const b = Mat3.identity();
      b[0] = 1.001;
      expect(Mat3.equals(a, b, 0.01)).toBe(true);
      expect(Mat3.equals(a, b, 0.0001)).toBe(false);
    });
  });

  describe("fromTransform", () => {
    it("should create combined transform matrix", () => {
      const m = Mat3.fromTransform(10, 20, 0, 1, 1);
      const expected = Mat3.translate(10, 20);
      expect(Mat3.equals(m, expected)).toBe(true);
    });

    it("should handle all transforms", () => {
      const tx = 10, ty = 20;
      const rotation = Math.PI / 4;
      const sx = 2, sy = 3;

      const m = Mat3.fromTransform(tx, ty, rotation, sx, sy);
      const p = { x: 1, y: 0 };
      const result = Mat3.transformPoint(m, p);

      const scaled = { x: 2, y: 0 };
      const rotated = { x: scaled.x * Math.cos(rotation), y: scaled.x * Math.sin(rotation) };
      const translated = { x: rotated.x + tx, y: rotated.y + ty };

      expect(result.x).toBeCloseTo(translated.x);
      expect(result.y).toBeCloseTo(translated.y);
    });

    it("should match manual composition", () => {
      const tx = 5, ty = 10;
      const rotation = Math.PI / 6;
      const sx = 2, sy = 3;

      const m1 = Mat3.fromTransform(tx, ty, rotation, sx, sy);
      const m2 = Mat3.multiply(Mat3.translate(tx, ty), Mat3.multiply(Mat3.rotate(rotation), Mat3.scale(sx, sy)));

      expect(Mat3.equals(m1, m2, 1e-10)).toBe(true);
    });
  });

  describe("edge cases and numerical stability", () => {
    it.each([{
      description: "very large values",
      matrix: Mat3.translate(1e10, 1e10),
      point: { x: 0, y: 0 },
      expected: { x: 1e10, y: 1e10 },
    }, {
      description: "very small values",
      matrix: Mat3.scale(1e-10, 1e-10),
      point: { x: 1e10, y: 1e10 },
      expected: { x: 1, y: 1 },
    }])("should handle $description", ({ matrix, point, expected }) => {
      const result = Mat3.transformPoint(matrix, point);
      expect(result.x).toBeCloseTo(expected.x);
      expect(result.y).toBeCloseTo(expected.y);
    });

    it("should handle accumulated rotations", () => {
      let m = Mat3.identity();
      for (let i = 0; i < 100; i++) {
        m = Mat3.multiply(m, Mat3.rotate((2 * Math.PI) / 100));
      }
      const result = Mat3.transformPoint(m, { x: 1, y: 0 });
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });
  });
});
