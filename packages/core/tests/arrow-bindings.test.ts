import { describe, expect, it } from "vitest";
import { Action } from "../src/actions";
import { resolveArrowEndpoints } from "../src/geom";
import { BindingRecord, PageRecord, ShapeRecord } from "../src/model";
import { EditorState } from "../src/reactivity";
import { SelectTool } from "../src/tools/select";

describe("Arrow binding behavior", () => {
  describe("Issue #2: Moving arrows with select tool", () => {
    it("should remove bindings when an arrow is moved (dragged)", () => {
      let state = EditorState.create();

      const page = PageRecord.create("Test Page");
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      };

      const rectStart = ShapeRecord.createRect(page.id, 50, 50, {
        w: 50,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      const rectEnd = ShapeRecord.createRect(page.id, 250, 50, {
        w: 50,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      const arrow = ShapeRecord.createArrow(page.id, 100, 75, {
        points: [{ x: 0, y: 0 }, { x: 150, y: 0 }],
        start: { kind: "bound", bindingId: "binding-start" },
        end: { kind: "bound", bindingId: "binding-end" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      const bindingStart = BindingRecord.create(
        arrow.id,
        rectStart.id,
        "start",
        { kind: "edge", nx: 1, ny: 0 },
        "binding-start",
      );

      const bindingEnd = BindingRecord.create(
        arrow.id,
        rectEnd.id,
        "end",
        { kind: "edge", nx: -1, ny: 0 },
        "binding-end",
      );

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [rectStart.id]: rectStart, [rectEnd.id]: rectEnd },
          bindings: { [bindingStart.id]: bindingStart, [bindingEnd.id]: bindingEnd },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [rectStart.id, rectEnd.id, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      expect(Object.keys(state.doc.bindings).length).toBe(2);
      expect(state.doc.bindings[bindingStart.id]).toBeDefined();
      expect(state.doc.bindings[bindingEnd.id]).toBeDefined();

      const tool = new SelectTool();
      tool.onEnter(state);

      const clickWorld = { x: 175, y: 75 };
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        clickWorld,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      const newWorld = { x: 175, y: 150 };
      const pointerMove = Action.pointerMove({ x: 0, y: 0 }, newWorld, { left: true, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 100);
      state = tool.onAction(state, pointerMove);

      const pointerUp = Action.pointerUp({ x: 0, y: 0 }, newWorld, 0, { left: false, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 200);
      state = tool.onAction(state, pointerUp);

      expect(Object.keys(state.doc.bindings).length).toBe(0);
      expect(state.doc.bindings[bindingStart.id]).toBeUndefined();
      expect(state.doc.bindings[bindingEnd.id]).toBeUndefined();

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        expect(updatedArrow.props.start.kind).toBe("free");
        expect(updatedArrow.props.end.kind).toBe("free");
      }
    });

    it("should NOT remove bindings when dragging an endpoint handle", () => {
      let state = EditorState.create();

      const page = PageRecord.create("Test Page");
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      };

      const rect = ShapeRecord.createRect(page.id, 250, 50, { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const arrow = ShapeRecord.createArrow(page.id, 100, 75, {
        points: [{ x: 0, y: 0 }, { x: 150, y: 0 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding-end" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      const binding = BindingRecord.create(arrow.id, rect.id, "end", { kind: "edge", nx: -1, ny: 0 }, "binding-end");

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [rect.id]: rect },
          bindings: { [binding.id]: binding },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [rect.id, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      const tool = new SelectTool();
      tool.onEnter(state);

      const resolved = resolveArrowEndpoints(state, arrow.id);
      expect(resolved).not.toBeNull();

      const endHandleWorld = resolved!.b;
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        endHandleWorld,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      const newWorld = { x: endHandleWorld.x + 50, y: endHandleWorld.y };
      const pointerMove = Action.pointerMove({ x: 0, y: 0 }, newWorld, { left: true, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 100);
      state = tool.onAction(state, pointerMove);

      const pointerUp = Action.pointerUp({ x: 0, y: 0 }, newWorld, 0, { left: false, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 200);
      state = tool.onAction(state, pointerUp);

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
    });
  });

  describe("Issue #3: Arrow endpoint handle detection with bindings", () => {
    it("should be able to click and drag arrow endpoint handles when arrow is bound", () => {
      let state = EditorState.create();

      const page = PageRecord.create("Test Page");
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      };

      const rect = ShapeRecord.createRect(page.id, 250, 50, { w: 50, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const arrow = ShapeRecord.createArrow(page.id, 100, 75, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding-end" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      const binding = BindingRecord.create(arrow.id, rect.id, "end", { kind: "center" }, "binding-end");

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [rect.id]: rect },
          bindings: { [binding.id]: binding },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [rect.id, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      const tool = new SelectTool();
      tool.onEnter(state);

      const resolved = resolveArrowEndpoints(state, arrow.id);
      expect(resolved).not.toBeNull();
      const resolvedEndPos = resolved!.b;

      expect(resolvedEndPos.x).toBeCloseTo(275, 0);
      expect(resolvedEndPos.y).toBeCloseTo(75, 0);

      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        resolvedEndPos,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      const activeHandle = tool.getActiveHandle();
      expect(activeHandle).toBe("line-end");

      const newWorld = { x: 300, y: 100 };
      const pointerMove = Action.pointerMove({ x: 0, y: 0 }, newWorld, { left: true, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 100);
      state = tool.onAction(state, pointerMove);

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        expect(updatedArrow.props.points[0]).toEqual({ x: 0, y: 0 });

        expect(updatedArrow.props.points[updatedArrow.props.points.length - 1].x).toBeGreaterThan(0);
      }
    });
  });

  describe("Issue #1: Arrow endpoint offset from bound shapes", () => {
    it("should position arrow endpoints with offset to account for stroke widths", () => {
      let state = EditorState.create();

      const page = PageRecord.create("Test Page");
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      };

      const rect = ShapeRecord.createRect(page.id, 200, 100, {
        w: 100,
        h: 100,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      const arrow = ShapeRecord.createArrow(page.id, 100, 150, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding-end" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      const binding = BindingRecord.create(arrow.id, rect.id, "end", { kind: "edge", nx: -1, ny: 0 }, "binding-end");

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [rect.id]: rect },
          bindings: { [binding.id]: binding },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [rect.id, arrow.id] } },
        },
      };

      const resolved = resolveArrowEndpoints(state, arrow.id);
      expect(resolved).not.toBeNull();

      const expectedX = 200 - 2;
      const expectedY = 150;

      expect(resolved!.b.x).toBeCloseTo(expectedX, 0);
      expect(resolved!.b.y).toBeCloseTo(expectedY, 0);
    });

    it("should apply offset for arrows with different stroke widths", () => {
      let state = EditorState.create();

      const page = PageRecord.create("Test Page");
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      };

      const rect = ShapeRecord.createRect(page.id, 200, 100, {
        w: 100,
        h: 100,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      const arrow = ShapeRecord.createArrow(page.id, 100, 150, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding-end" },
        style: { stroke: "#000", width: 4, headEnd: true },
      });

      const binding = BindingRecord.create(arrow.id, rect.id, "end", { kind: "edge", nx: -1, ny: 0 }, "binding-end");

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [rect.id]: rect },
          bindings: { [binding.id]: binding },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [rect.id, arrow.id] } },
        },
      };

      const resolved = resolveArrowEndpoints(state, arrow.id);
      expect(resolved).not.toBeNull();

      const expectedX = 200 - 3;
      const expectedY = 150;

      expect(resolved!.b.x).toBeCloseTo(expectedX, 0);
      expect(resolved!.b.y).toBeCloseTo(expectedY, 0);
    });

    it("should not apply offset for center anchors", () => {
      let state = EditorState.create();

      const page = PageRecord.create("Test Page");
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      };

      const rect = ShapeRecord.createRect(page.id, 200, 100, {
        w: 100,
        h: 100,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      const arrow = ShapeRecord.createArrow(page.id, 100, 150, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding-end" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      const binding = BindingRecord.create(arrow.id, rect.id, "end", { kind: "center" }, "binding-end");

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [rect.id]: rect },
          bindings: { [binding.id]: binding },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [rect.id, arrow.id] } },
        },
      };

      const resolved = resolveArrowEndpoints(state, arrow.id);
      expect(resolved).not.toBeNull();

      expect(resolved!.b.x).toBeCloseTo(250, 0);
      expect(resolved!.b.y).toBeCloseTo(150, 0);
    });
  });

  describe("Regression: Arrow endpoint manipulation", () => {
    it("should preserve intermediate points when dragging bound endpoints", () => {
      let state = EditorState.create();

      const page = PageRecord.create("Test Page");
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      };

      const rect = ShapeRecord.createRect(page.id, 300, 100, {
        w: 100,
        h: 100,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      const arrow = ShapeRecord.createArrow(page.id, 100, 100, {
        points: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding-end" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      const binding = BindingRecord.create(arrow.id, rect.id, "end", { kind: "center" }, "binding-end");

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [rect.id]: rect },
          bindings: { [binding.id]: binding },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [rect.id, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      const tool = new SelectTool();
      tool.onEnter(state);

      const resolved = resolveArrowEndpoints(state, arrow.id);
      expect(resolved).not.toBeNull();

      const startPos = resolved!.a;
      const pointerDown = Action.pointerDown({ x: 0, y: 0 }, startPos, 0, { left: true, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 0);
      state = tool.onAction(state, pointerDown);

      const newPos = { x: startPos.x - 50, y: startPos.y };
      const pointerMove = Action.pointerMove({ x: 0, y: 0 }, newPos, { left: true, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 100);
      state = tool.onAction(state, pointerMove);

      const pointerUp = Action.pointerUp({ x: 0, y: 0 }, newPos, 0, { left: false, middle: false, right: false }, {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      }, 200);
      state = tool.onAction(state, pointerUp);

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        expect(updatedArrow.props.points.length).toBe(3);

        expect(updatedArrow.props.points[1]).toBeDefined();
      }
    });
  });
});
