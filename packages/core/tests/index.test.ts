import { describe, expect, it } from "vitest";
import * as core from "../src";

describe("Core exports", () => {
  it("should export math types and functions", () => {
    expect(core.Vec2).toBeDefined();
    expect(core.Box2).toBeDefined();
    expect(core.Mat3).toBeDefined();
  });

  it("should export camera functions", () => {
    expect(core.Camera).toBeDefined();
  });

  it("should export model types and functions", () => {
    expect(core.ShapeRecord).toBeDefined();
    expect(core.PageRecord).toBeDefined();
    expect(core.Document).toBeDefined();
  });

  it("should export reactivity functions", () => {
    expect(core.Store).toBeDefined();
    expect(core.getShapesOnCurrentPage).toBeDefined();
  });

  it("should export geometry functions", () => {
    expect(core.shapeBounds).toBeDefined();
    expect(core.pointInRect).toBeDefined();
    expect(core.pointInEllipse).toBeDefined();
    expect(core.pointNearSegment).toBeDefined();
    expect(core.hitTestPoint).toBeDefined();
  });
});
