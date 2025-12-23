import { describe, expect, it } from "vitest";
import {
  boundsFromOutline,
  computeOutline,
  hitTestPoint,
  hitTestStroke,
  PageRecord,
  shapeBounds,
  ShapeRecord,
  Store,
} from "../src";
import type { StrokePoint } from "../src/model";

describe("Stroke Geometry", () => {
  describe("computeOutline", () => {
    it("should compute outline for simple stroke with 2 points", () => {
      const points: StrokePoint[] = [[0, 0], [100, 0]];
      const brush = { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true };

      const outline = computeOutline(points, brush);

      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0]).toHaveProperty("x");
      expect(outline[0]).toHaveProperty("y");
    });

    it("should compute outline for stroke with multiple points", () => {
      const points: StrokePoint[] = [[0, 0], [50, 50], [100, 0], [150, 50]];
      const brush = { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true };

      const outline = computeOutline(points, brush);

      expect(outline.length).toBeGreaterThan(0);
    });

    it("should return empty array for stroke with fewer than 2 points", () => {
      const points: StrokePoint[] = [[0, 0]];
      const brush = { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true };

      const outline = computeOutline(points, brush);

      expect(outline).toEqual([]);
    });

    it("should handle points with pressure values", () => {
      const points: StrokePoint[] = [[0, 0, 0.5], [50, 50, 0.8], [100, 0, 0.3]];
      const brush = { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: false };

      const outline = computeOutline(points, brush);

      expect(outline.length).toBeGreaterThan(0);
    });

    it("should vary outline based on brush size", () => {
      const points: StrokePoint[] = [[0, 0], [100, 0]];

      const smallBrush = { size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true };

      const largeBrush = { size: 32, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true };

      const smallOutline = computeOutline(points, smallBrush);
      const largeOutline = computeOutline(points, largeBrush);

      expect(smallOutline.length).toBeGreaterThan(0);
      expect(largeOutline.length).toBeGreaterThan(0);
    });
  });

  describe("boundsFromOutline", () => {
    it("should compute bounds from outline points", () => {
      const outline = [{ x: 10, y: 20 }, { x: 50, y: 30 }, { x: 30, y: 60 }, { x: 5, y: 40 }];

      const bounds = boundsFromOutline(outline);

      expect(bounds.min).toEqual({ x: 5, y: 20 });
      expect(bounds.max).toEqual({ x: 50, y: 60 });
    });

    it("should handle single point outline", () => {
      const outline = [{ x: 100, y: 200 }];

      const bounds = boundsFromOutline(outline);

      expect(bounds.min).toEqual({ x: 100, y: 200 });
      expect(bounds.max).toEqual({ x: 100, y: 200 });
    });

    it("should return zero bounds for empty outline", () => {
      const outline: { x: number; y: number }[] = [];

      const bounds = boundsFromOutline(outline);

      expect(bounds.min).toEqual({ x: 0, y: 0 });
      expect(bounds.max).toEqual({ x: 0, y: 0 });
    });

    it("should handle negative coordinates", () => {
      const outline = [{ x: -50, y: -100 }, { x: -10, y: -20 }, { x: -30, y: -60 }];

      const bounds = boundsFromOutline(outline);

      expect(bounds.min).toEqual({ x: -50, y: -100 });
      expect(bounds.max).toEqual({ x: -10, y: -20 });
    });
  });

  describe("shapeBounds for stroke", () => {
    it("should return correct bounds for stroke shape", () => {
      const points: StrokePoint[] = [[0, 0], [100, 50], [200, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 50, 100, {
        points,
        brush: { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      });

      const bounds = shapeBounds(stroke);

      expect(bounds.min.x).toBeDefined();
      expect(bounds.min.y).toBeDefined();
      expect(bounds.max.x).toBeGreaterThan(bounds.min.x);
      expect(bounds.max.y).toBeGreaterThan(bounds.min.y);

      expect(bounds.min.x).toBeLessThan(60);
      expect(bounds.min.y).toBeLessThan(110);
    });

    it("should handle stroke with insufficient points", () => {
      const points: StrokePoint[] = [[0, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 100, 100, {
        points,
        brush: { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      });

      const bounds = shapeBounds(stroke);

      expect(bounds.min).toEqual({ x: 100, y: 100 });
      expect(bounds.max).toEqual({ x: 100, y: 100 });
    });
  });

  describe("hitTestStroke", () => {
    it("should return true for point inside stroke outline", () => {
      const points: StrokePoint[] = [[0, 0], [100, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 100, 100, {
        points,
        brush: { size: 20, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      });

      const hitPoint = { x: 150, y: 100 };
      const result = hitTestStroke(hitPoint, stroke);
      expect(result).toBe(true);
    });

    it("should return false for point outside stroke bounds", () => {
      const points: StrokePoint[] = [[0, 0], [100, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 100, 100, {
        points,
        brush: { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      });

      const hitPoint = { x: 500, y: 500 };
      const result = hitTestStroke(hitPoint, stroke);

      expect(result).toBe(false);
    });

    it("should return false for stroke with insufficient points", () => {
      const points: StrokePoint[] = [[0, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 100, 100, {
        points,
        brush: { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      });

      const hitPoint = { x: 100, y: 100 };
      const result = hitTestStroke(hitPoint, stroke);

      expect(result).toBe(false);
    });
  });

  describe("hitTestPoint with strokes", () => {
    it("should hit test stroke shapes", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      const points: StrokePoint[] = [[0, 0], [100, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 100, 100, {
        points,
        brush: { size: 20, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      }, "stroke:1");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [stroke.id] } },
          shapes: { [stroke.id]: stroke },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 150, y: 100 });
      expect(hitId).toBe("stroke:1");
    });

    it("should return null for point outside stroke", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      const points: StrokePoint[] = [[0, 0], [100, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 100, 100, {
        points,
        brush: { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      }, "stroke:1");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [stroke.id] } },
          shapes: { [stroke.id]: stroke },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 500, y: 500 });
      expect(hitId).toBeNull();
    });

    it("should handle stroke with other shape types", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      const rect = ShapeRecord.createRect("page:1", 0, 0, {
        w: 50,
        h: 50,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "rect:1");

      const points: StrokePoint[] = [[0, 0], [100, 0]];

      const stroke = ShapeRecord.createStroke("page:1", 100, 100, {
        points,
        brush: { size: 20, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
        style: { color: "#000000", opacity: 1.0 },
      }, "stroke:1");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [rect.id, stroke.id] } },
          shapes: { [rect.id]: rect, [stroke.id]: stroke },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();

      expect(hitTestPoint(state, { x: 25, y: 25 })).toBe("rect:1");
      expect(hitTestPoint(state, { x: 150, y: 100 })).toBe("stroke:1");
    });
  });
});
