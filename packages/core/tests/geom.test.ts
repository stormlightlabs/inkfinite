import { describe, expect, it } from "vitest";
import {
  hitTestPoint,
  PageRecord,
  pointInEllipse,
  pointInRect,
  pointNearSegment,
  shapeBounds,
  ShapeRecord,
  Store,
} from "../src";

describe("Geometry", () => {
  describe("shapeBounds", () => {
    it("should return correct bounds for rect without rotation", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 200, { w: 50, h: 30, fill: "", stroke: "", radius: 0 });

      const bounds = shapeBounds(rect);

      expect(bounds.min).toEqual({ x: 100, y: 200 });
      expect(bounds.max).toEqual({ x: 150, y: 230 });
    });

    it("should return correct bounds for rect with rotation", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });
      rect.rot = Math.PI / 4;

      const bounds = shapeBounds(rect);

      expect(bounds.min.x).toBeDefined();
      expect(bounds.min.y).toBeDefined();
      expect(bounds.max.x).toBeGreaterThan(bounds.min.x);
      expect(bounds.max.y).toBeGreaterThan(bounds.min.y);
    });

    it("should return correct bounds for ellipse without rotation", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 50, 50, { w: 100, h: 80, fill: "", stroke: "" });

      const bounds = shapeBounds(ellipse);

      expect(bounds.min).toEqual({ x: 50, y: 50 });
      expect(bounds.max).toEqual({ x: 150, y: 130 });
    });

    it("should return correct bounds for line", () => {
      const line = ShapeRecord.createLine("page:1", 10, 10, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 50 },
        stroke: "",
        width: 2,
      });

      const bounds = shapeBounds(line);

      expect(bounds.min).toEqual({ x: 10, y: 10 });
      expect(bounds.max).toEqual({ x: 110, y: 60 });
    });

    it("should return correct bounds for arrow", () => {
      const arrow = ShapeRecord.createArrow("page:1", 20, 30, {
        a: { x: 10, y: 10 },
        b: { x: 50, y: 60 },
        stroke: "",
        width: 2,
      });

      const bounds = shapeBounds(arrow);

      expect(bounds.min).toEqual({ x: 30, y: 40 });
      expect(bounds.max).toEqual({ x: 70, y: 90 });
    });

    it("should return correct bounds for text", () => {
      const text = ShapeRecord.createText("page:1", 100, 100, {
        text: "Hello",
        fontSize: 16,
        fontFamily: "Arial",
        color: "#000",
        w: 100,
      });

      const bounds = shapeBounds(text);

      expect(bounds.min).toEqual({ x: 100, y: 100 });
      expect(bounds.max.x).toBeCloseTo(200, 1);
      expect(bounds.max.y).toBeCloseTo(119.2, 1);
    });

    it("should return correct bounds for text without explicit width", () => {
      const text = ShapeRecord.createText("page:1", 100, 100, {
        text: "Hello",
        fontSize: 20,
        fontFamily: "Arial",
        color: "#000",
      });

      const bounds = shapeBounds(text);

      expect(bounds.min).toEqual({ x: 100, y: 100 });
      expect(bounds.max.x).toBeCloseTo(300, 1);
      expect(bounds.max.y).toBeCloseTo(124, 1);
    });
  });

  describe("pointInRect", () => {
    it("should return true for point inside rect", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });

      expect(pointInRect({ x: 150, y: 125 }, rect)).toBe(true);
      expect(pointInRect({ x: 100, y: 100 }, rect)).toBe(true);
      expect(pointInRect({ x: 200, y: 150 }, rect)).toBe(true);
    });

    it("should return false for point outside rect", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });

      expect(pointInRect({ x: 99, y: 125 }, rect)).toBe(false);
      expect(pointInRect({ x: 201, y: 125 }, rect)).toBe(false);
      expect(pointInRect({ x: 150, y: 99 }, rect)).toBe(false);
      expect(pointInRect({ x: 150, y: 151 }, rect)).toBe(false);
    });

    it("should handle rotated rectangles", () => {
      const rect = ShapeRecord.createRect("page:1", 0, 0, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });
      rect.rot = Math.PI / 4;

      const centerInLocal = { x: 50, y: 25 };
      const cos = Math.cos(Math.PI / 4);
      const sin = Math.sin(Math.PI / 4);
      const centerPoint = {
        x: centerInLocal.x * cos - centerInLocal.y * sin,
        y: centerInLocal.x * sin + centerInLocal.y * cos,
      };
      expect(pointInRect(centerPoint, rect)).toBe(true);

      const farPoint = { x: 200, y: 200 };
      expect(pointInRect(farPoint, rect)).toBe(false);
    });
  });

  describe("pointInEllipse", () => {
    it("should return true for point inside ellipse", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, { w: 100, h: 80, fill: "", stroke: "" });

      expect(pointInEllipse({ x: 150, y: 140 }, ellipse)).toBe(true);
    });

    it("should return false for point outside ellipse", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, { w: 100, h: 80, fill: "", stroke: "" });

      expect(pointInEllipse({ x: 100, y: 100 }, ellipse)).toBe(false);
      expect(pointInEllipse({ x: 200, y: 180 }, ellipse)).toBe(false);
    });

    it("should handle point at center of ellipse", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, { w: 100, h: 80, fill: "", stroke: "" });

      const center = { x: 150, y: 140 };
      expect(pointInEllipse(center, ellipse)).toBe(true);
    });

    it("should handle rotated ellipses", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 0, 0, { w: 100, h: 50, fill: "", stroke: "" });
      ellipse.rot = Math.PI / 2;

      const centerInLocal = { x: 50, y: 25 };
      const cos = Math.cos(Math.PI / 2);
      const sin = Math.sin(Math.PI / 2);
      const centerPoint = {
        x: centerInLocal.x * cos - centerInLocal.y * sin,
        y: centerInLocal.x * sin + centerInLocal.y * cos,
      };
      expect(pointInEllipse(centerPoint, ellipse)).toBe(true);
    });
  });

  describe("pointNearSegment", () => {
    it("should return true for point on segment", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 100, y: 0 };
      const p = { x: 50, y: 0 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
    });

    it("should return true for point near segment within tolerance", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 100, y: 0 };
      const p = { x: 50, y: 3 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
    });

    it("should return false for point far from segment", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 100, y: 0 };
      const p = { x: 50, y: 10 };

      expect(pointNearSegment(p, a, b, 5)).toBe(false);
    });

    it("should handle diagonal segments", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 100, y: 100 };
      const p = { x: 50, y: 50 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
    });

    it("should handle points beyond segment endpoints", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 100, y: 0 };

      const beforeStart = { x: -10, y: 0 };
      expect(pointNearSegment(beforeStart, a, b, 15)).toBe(true);

      const afterEnd = { x: 110, y: 0 };
      expect(pointNearSegment(afterEnd, a, b, 15)).toBe(true);
    });

    it("should handle zero-length segments", () => {
      const a = { x: 50, y: 50 };
      const b = { x: 50, y: 50 };
      const p = { x: 52, y: 52 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
    });
  });

  describe("pointNearSegment - edge cases", () => {
    it("should handle very small tolerance", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 100, y: 0 };
      const p = { x: 50, y: 0.1 };

      expect(pointNearSegment(p, a, b, 0.05)).toBe(false);
      expect(pointNearSegment(p, a, b, 0.2)).toBe(true);
    });

    it("should handle negative coordinates", () => {
      const a = { x: -100, y: -100 };
      const b = { x: -50, y: -50 };
      const p = { x: -75, y: -75 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
    });

    it("should handle vertical segments", () => {
      const a = { x: 50, y: 0 };
      const b = { x: 50, y: 100 };
      const p = { x: 52, y: 50 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
      expect(pointNearSegment(p, a, b, 1)).toBe(false);
    });

    it("should handle horizontal segments", () => {
      const a = { x: 0, y: 50 };
      const b = { x: 100, y: 50 };
      const p = { x: 50, y: 52 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
      expect(pointNearSegment(p, a, b, 1)).toBe(false);
    });

    it("should handle very long segments", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 10_000, y: 10_000 };
      const p = { x: 5000, y: 5003 };

      expect(pointNearSegment(p, a, b, 5)).toBe(true);
    });

    it("should handle point exactly at endpoint", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 100, y: 100 };

      expect(pointNearSegment(a, a, b, 0.1)).toBe(true);
      expect(pointNearSegment(b, a, b, 0.1)).toBe(true);
    });
  });

  describe("pointInRect - edge cases", () => {
    it("should handle point exactly on rect boundary", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });

      expect(pointInRect({ x: 100, y: 125 }, rect)).toBe(true);
      expect(pointInRect({ x: 200, y: 125 }, rect)).toBe(true);
      expect(pointInRect({ x: 150, y: 100 }, rect)).toBe(true);
      expect(pointInRect({ x: 150, y: 150 }, rect)).toBe(true);
    });

    it("should handle zero-size rectangles", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 0, h: 0, fill: "", stroke: "", radius: 0 });

      expect(pointInRect({ x: 100, y: 100 }, rect)).toBe(true);
      expect(pointInRect({ x: 100.1, y: 100 }, rect)).toBe(false);
    });

    it("should handle negative coordinates", () => {
      const rect = ShapeRecord.createRect("page:1", -100, -100, { w: 50, h: 50, fill: "", stroke: "", radius: 0 });

      expect(pointInRect({ x: -75, y: -75 }, rect)).toBe(true);
      expect(pointInRect({ x: -101, y: -75 }, rect)).toBe(false);
    });

    it("should handle very small rectangles", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 0.1, h: 0.1, fill: "", stroke: "", radius: 0 });

      expect(pointInRect({ x: 100.05, y: 100.05 }, rect)).toBe(true);
      expect(pointInRect({ x: 100.2, y: 100.05 }, rect)).toBe(false);
    });

    it("should handle 90 degree rotation", () => {
      const rect = ShapeRecord.createRect("page:1", 0, 0, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });
      rect.rot = Math.PI / 2;

      const center = { x: -25, y: 50 };
      expect(pointInRect(center, rect)).toBe(true);
    });

    it("should handle 180 degree rotation", () => {
      const rect = ShapeRecord.createRect("page:1", 0, 0, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });
      rect.rot = Math.PI;

      const center = { x: -50, y: -25 };
      expect(pointInRect(center, rect)).toBe(true);
    });
  });

  describe("pointInEllipse - edge cases", () => {
    it("should handle point exactly on ellipse boundary", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, { w: 100, h: 80, fill: "", stroke: "" });

      const rightEdge = { x: 200, y: 140 };
      expect(pointInEllipse(rightEdge, ellipse)).toBe(true);
    });

    it("should handle very small ellipse", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, { w: 0.2, h: 0.2, fill: "", stroke: "" });

      expect(pointInEllipse({ x: 100.1, y: 100.1 }, ellipse)).toBe(true);
      expect(pointInEllipse({ x: 100.2, y: 100.1 }, ellipse)).toBe(false);
    });

    it("should handle circle (equal width and height)", () => {
      const circle = ShapeRecord.createEllipse("page:1", 100, 100, { w: 100, h: 100, fill: "", stroke: "" });

      expect(pointInEllipse({ x: 150, y: 150 }, circle)).toBe(true);
      expect(pointInEllipse({ x: 200, y: 150 }, circle)).toBe(true);
    });

    it("should handle negative coordinates", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", -100, -100, { w: 100, h: 80, fill: "", stroke: "" });

      expect(pointInEllipse({ x: -50, y: -60 }, ellipse)).toBe(true);
    });

    it("should handle very flat ellipse", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, { w: 200, h: 10, fill: "", stroke: "" });

      const center = { x: 200, y: 105 };
      expect(pointInEllipse(center, ellipse)).toBe(true);

      const farOutside = { x: 200, y: 120 };
      expect(pointInEllipse(farOutside, ellipse)).toBe(false);
    });

    it("should handle very tall ellipse", () => {
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, { w: 10, h: 200, fill: "", stroke: "" });

      const center = { x: 105, y: 200 };
      expect(pointInEllipse(center, ellipse)).toBe(true);

      const farOutside = { x: 120, y: 200 };
      expect(pointInEllipse(farOutside, ellipse)).toBe(false);
    });
  });

  describe("shapeBounds - edge cases", () => {
    it("should handle negative width/height gracefully", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: -50, h: -30, fill: "", stroke: "", radius: 0 });

      const bounds = shapeBounds(rect);
      expect(bounds.min.x).toBeDefined();
      expect(bounds.max.x).toBeDefined();
      expect(bounds.min.y).toBeDefined();
      expect(bounds.max.y).toBeDefined();
    });

    it("should handle zero-size shapes", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 0, h: 0, fill: "", stroke: "", radius: 0 });

      const bounds = shapeBounds(rect);
      expect(bounds.min).toEqual({ x: 100, y: 100 });
      expect(bounds.max).toEqual({ x: 100, y: 100 });
    });

    it("should handle line with same start and end points", () => {
      const line = ShapeRecord.createLine("page:1", 100, 100, {
        a: { x: 0, y: 0 },
        b: { x: 0, y: 0 },
        stroke: "",
        width: 2,
      });

      const bounds = shapeBounds(line);
      expect(bounds.min).toEqual({ x: 100, y: 100 });
      expect(bounds.max).toEqual({ x: 100, y: 100 });
    });

    it("should handle multiple rotations", () => {
      const rect = ShapeRecord.createRect("page:1", 100, 100, { w: 100, h: 50, fill: "", stroke: "", radius: 0 });
      rect.rot = Math.PI * 2;

      const bounds = shapeBounds(rect);
      expect(bounds.min.x).toBeCloseTo(100, 1);
      expect(bounds.min.y).toBeCloseTo(100, 1);
      expect(bounds.max.x).toBeCloseTo(200, 1);
      expect(bounds.max.y).toBeCloseTo(150, 1);
    });

    it("should handle very large shapes", () => {
      const rect = ShapeRecord.createRect("page:1", 0, 0, { w: 100_000, h: 100_000, fill: "", stroke: "", radius: 0 });

      const bounds = shapeBounds(rect);
      expect(bounds.max.x).toBe(100_000);
      expect(bounds.max.y).toBe(100_000);
    });

    it("should handle line with rotation", () => {
      const line = ShapeRecord.createLine("page:1", 100, 100, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        stroke: "",
        width: 2,
      });
      line.rot = Math.PI / 2;

      const bounds = shapeBounds(line);
      expect(bounds.min.x).toBeCloseTo(100, 1);
      expect(bounds.max.y).toBeCloseTo(200, 1);
    });
  });

  describe("hitTestPoint", () => {
    it("should return shape id for point inside rect", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 100,
        h: 50,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 150, y: 125 });

      expect(hitId).toBe("shape:1");
    });

    it("should return null for point outside all shapes", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 100,
        h: 50,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 50, y: 50 });

      expect(hitId).toBeNull();
    });

    it("should return topmost shape for overlapping shapes", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const rect1 = ShapeRecord.createRect("page:1", 100, 100, {
        w: 200,
        h: 200,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");
      const rect2 = ShapeRecord.createRect("page:1", 150, 150, {
        w: 100,
        h: 100,
        fill: "#00ff00",
        stroke: "#000000",
        radius: 0,
      }, "shape:2");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [rect1.id, rect2.id] } },
          shapes: { [rect1.id]: rect1, [rect2.id]: rect2 },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 200, y: 200 });

      expect(hitId).toBe("shape:2");
    });

    it("should hit test ellipse shapes", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, {
        w: 100,
        h: 80,
        fill: "#00ff00",
        stroke: "#000000",
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [ellipse.id] } },
          shapes: { [ellipse.id]: ellipse },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 150, y: 140 });

      expect(hitId).toBe("shape:1");
    });

    it("should hit test line shapes with tolerance", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const line = ShapeRecord.createLine("page:1", 100, 100, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 100 },
        stroke: "#000000",
        width: 2,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [line.id] } }, shapes: { [line.id]: line }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 150, y: 152 }, 5);

      expect(hitId).toBe("shape:1");
    });

    it("should hit test arrow shapes with tolerance", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const arrow = ShapeRecord.createArrow("page:1", 100, 100, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        stroke: "#000000",
        width: 2,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [arrow.id] } }, shapes: { [arrow.id]: arrow }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 150, y: 103 }, 5);

      expect(hitId).toBe("shape:1");
    });

    it("should hit test text shapes", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const text = ShapeRecord.createText("page:1", 100, 100, {
        text: "Hello",
        fontSize: 16,
        fontFamily: "Arial",
        color: "#000000",
        w: 100,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [text.id] } }, shapes: { [text.id]: text }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 150, y: 110 });

      expect(hitId).toBe("shape:1");
    });

    it("should respect tolerance parameter for lines", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const line = ShapeRecord.createLine("page:1", 0, 0, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        stroke: "#000000",
        width: 2,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [line.id] } }, shapes: { [line.id]: line }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();

      const hitWithin = hitTestPoint(state, { x: 50, y: 3 }, 5);
      expect(hitWithin).toBe("shape:1");

      const hitOutside = hitTestPoint(state, { x: 50, y: 8 }, 5);
      expect(hitOutside).toBeNull();

      const hitWithLargeTolerance = hitTestPoint(state, { x: 50, y: 8 }, 10);
      expect(hitWithLargeTolerance).toBe("shape:1");
    });

    it("should return null when no page is selected", () => {
      const store = new Store();
      const state = store.getState();
      const hitId = hitTestPoint(state, { x: 150, y: 125 });

      expect(hitId).toBeNull();
    });

    it("should handle multiple shape types on same page", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 0, 0, {
        w: 100,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");
      const ellipse = ShapeRecord.createEllipse("page:1", 200, 0, {
        w: 100,
        h: 100,
        fill: "#00ff00",
        stroke: "#000000",
      }, "shape:2");
      const line = ShapeRecord.createLine("page:1", 0, 200, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 100 },
        stroke: "#000000",
        width: 2,
      }, "shape:3");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [rect.id, ellipse.id, line.id] } },
          shapes: { [rect.id]: rect, [ellipse.id]: ellipse, [line.id]: line },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();

      expect(hitTestPoint(state, { x: 50, y: 50 })).toBe("shape:1");
      expect(hitTestPoint(state, { x: 250, y: 50 })).toBe("shape:2");
      expect(hitTestPoint(state, { x: 50, y: 252 }, 5)).toBe("shape:3");
    });
  });
});
