import { describe, expect, it } from "vitest";
import { CursorState as CursorStateOps } from "../src/cursor";
import { ShapeRecord } from "../src/model";
import type { ShapeRecord as ShapeRecordType } from "../src/model";
import { EditorState } from "../src/reactivity";
import {
  buildStatusBarVM,
  getSelectionSummary,
  getSnapSummary,
  getToolId,
  getZoomPct,
  type PersistenceStatus,
} from "../src/ui/statusbar";

describe("Status bar selectors", () => {
  describe("getZoomPct", () => {
    it("rounds zoom values to percentages", () => {
      const state = { ...EditorState.create(), camera: { x: 0, y: 0, zoom: 1.234 } };
      expect(getZoomPct(state)).toBe(123);
    });

    it("falls back to 100 for invalid zoom", () => {
      const state = { ...EditorState.create(), camera: { x: 0, y: 0, zoom: Number.NaN } };
      expect(getZoomPct(state)).toBe(100);
    });
  });

  describe("getToolId", () => {
    it("returns the active tool id", () => {
      const base = EditorState.create();
      const state: EditorState = { ...base, ui: { ...base.ui, toolId: "rect", currentPageId: null, selectionIds: [] } };
      expect(getToolId(state)).toBe("rect");
    });
  });

  describe("getSelectionSummary", () => {
    it("returns zero summary when nothing is selected", () => {
      const state = buildState([], []);
      expect(getSelectionSummary(state)).toEqual({ count: 0 });
    });

    it("describes a single selected shape", () => {
      const rect = ShapeRecord.createRect(
        "page-1",
        10,
        20,
        { w: 40, h: 20, fill: "#000", stroke: "#fff", radius: 0 },
        "shape-rect",
      );
      const state = buildState([rect], ["shape-rect"]);
      expect(getSelectionSummary(state)).toEqual({ count: 1, kind: "rect", bounds: { w: 40, h: 20 } });
    });

    it("summarizes multiple selections with combined bounds and mixed kind", () => {
      const rect = ShapeRecord.createRect(
        "page-1",
        10,
        20,
        { w: 40, h: 20, fill: "#000", stroke: "#fff", radius: 0 },
        "shape-rect",
      );
      const ellipse = ShapeRecord.createEllipse(
        "page-1",
        100,
        50,
        { w: 20, h: 20, fill: "#f00", stroke: "#111" },
        "shape-ellipse",
      );
      const state = buildState([rect, ellipse], ["shape-rect", "shape-ellipse"]);

      expect(getSelectionSummary(state)).toEqual({ count: 2, kind: "mixed", bounds: { w: 110, h: 50 } });
    });

    it("marks kind when all selected shapes match", () => {
      const rectA = ShapeRecord.createRect(
        "page-1",
        0,
        0,
        { w: 10, h: 10, fill: "#000", stroke: "#fff", radius: 0 },
        "shape-1",
      );
      const rectB = ShapeRecord.createRect(
        "page-1",
        20,
        20,
        { w: 10, h: 10, fill: "#111", stroke: "#eee", radius: 0 },
        "shape-2",
      );
      const state = buildState([rectA, rectB], ["shape-1", "shape-2"]);

      expect(getSelectionSummary(state)).toEqual({ count: 2, kind: "rect", bounds: { w: 30, h: 30 } });
    });
  });

  describe("getSnapSummary", () => {
    it("returns safe defaults when snapping is disabled", () => {
      const state = buildState([], []);
      expect(getSnapSummary(state)).toEqual({ enabled: false });
    });
  });

  describe("buildStatusBarVM", () => {
    it("composes slices into a status bar view model", () => {
      const rect = ShapeRecord.createRect(
        "page-1",
        0,
        0,
        { w: 50, h: 50, fill: "#000", stroke: "#fff", radius: 0 },
        "shape-rect",
      );
      const state = buildState([rect], ["shape-rect"]);
      const cursorState = CursorStateOps.create({ x: 5, y: 6 }, { x: 1, y: 2 }, 42);
      const persistence: PersistenceStatus = { backend: "indexeddb", state: "saving", pendingWrites: 1 };

      const vm = buildStatusBarVM(state, cursorState, persistence, "dragging");

      expect(vm.cursorWorld).toEqual({ x: 5, y: 6 });
      expect(vm.cursorScreen).toEqual({ x: 1, y: 2 });
      expect(vm.toolId).toBe("select");
      expect(vm.mode).toBe("dragging");
      expect(vm.selection).toEqual({ count: 1, kind: "rect", bounds: { w: 50, h: 50 } });
      expect(vm.snap).toEqual({ enabled: false });
      expect(vm.persistence).toEqual({ backend: "indexeddb", state: "saving", pendingWrites: 1 });
      expect(vm.cursorWorld).not.toBe(cursorState.cursorWorld);
      expect(vm.persistence).not.toBe(persistence);
    });
  });
});

function buildState(shapes: ShapeRecordType[], selectionIds: string[]) {
  const base = EditorState.create();
  const pageId = "page-1";
  const docShapes = Object.fromEntries(shapes.map((shape) => [shape.id, shape]));
  const page = { id: pageId, name: "Page 1", shapeIds: shapes.map((shape) => shape.id) };

  return {
    ...base,
    doc: { pages: { [pageId]: page }, shapes: docShapes, bindings: {} },
    ui: { ...base.ui, currentPageId: pageId, selectionIds },
  };
}
