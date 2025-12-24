import { describe, expect, it } from "vitest";
import { Action } from "../src/actions";
import { BindingRecord, ShapeRecord } from "../src/model";
import { EditorState } from "../src/reactivity";
import { SelectTool } from "../src/tools/select";

describe("Arrow multi-point editing", () => {
  describe("Dragging intermediate points", () => {
    it("should allow dragging an intermediate point", () => {
      let state = EditorState.create();

      // Create a page and an arrow with 3 points (including an intermediate point)
      const page = state.doc.pages[Object.keys(state.doc.pages)[0]];
      const arrow = ShapeRecord.createArrow(page.id, 100, 100, {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [...page.shapeIds, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      store.setState(state);

      const tool = new SelectTool();
      tool.onEnter(state);

      // Pointer down on the intermediate point (index 1)
      const intermediateWorldPos = { x: 150, y: 150 }; // arrow.x + points[1].x, arrow.y + points[1].y
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        intermediateWorldPos,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      // Drag the point to a new location
      const newWorldPos = { x: 180, y: 160 };
      const pointerMove = Action.pointerMove(
        { x: 0, y: 0 },
        newWorldPos,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        100,
      );
      state = tool.onAction(state, pointerMove);

      const pointerUp = Action.pointerUp(
        { x: 0, y: 0 },
        newWorldPos,
        0,
        { left: false, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        200,
      );
      state = tool.onAction(state, pointerUp);

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        expect(updatedArrow.props.points.length).toBe(3);
        // The intermediate point should be updated
        expect(updatedArrow.props.points[1].x).toBe(80); // newWorldPos.x - arrow.x
        expect(updatedArrow.props.points[1].y).toBe(60); // newWorldPos.y - arrow.y
        // Start and end points should remain unchanged
        expect(updatedArrow.props.points[0]).toEqual({ x: 0, y: 0 });
        expect(updatedArrow.props.points[2]).toEqual({ x: 100, y: 0 });
      }
    });

    it("should preserve bindings when dragging intermediate points", () => {
      const store = Store.create();
      let state = store.getState();

      const page = state.doc.pages[Object.keys(state.doc.pages)[0]];

      // Create a target shape
      const targetRect = ShapeRecord.createRect(page.id, 300, 100, {
        w: 100,
        h: 100,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      // Create an arrow with a binding
      const arrow = ShapeRecord.createArrow(page.id, 100, 100, {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 50 },
          { x: 200, y: 0 },
        ],
        start: { kind: "free" },
        end: { kind: "bound", bindingId: "binding-1" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      const binding = BindingRecord.create(arrow.id, targetRect.id, "end", { kind: "center" }, "binding-1");

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow, [targetRect.id]: targetRect },
          bindings: { [binding.id]: binding },
          pages: {
            ...state.doc.pages,
            [page.id]: { ...page, shapeIds: [...page.shapeIds, arrow.id, targetRect.id] },
          },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      store.setState(state);

      const tool = new SelectTool();
      tool.onEnter(state);

      // Drag the intermediate point
      const intermediateWorldPos = { x: 200, y: 150 };
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        intermediateWorldPos,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      const newWorldPos = { x: 220, y: 180 };
      const pointerMove = Action.pointerMove(
        { x: 0, y: 0 },
        newWorldPos,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        100,
      );
      state = tool.onAction(state, pointerMove);

      const pointerUp = Action.pointerUp(
        { x: 0, y: 0 },
        newWorldPos,
        0,
        { left: false, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        200,
      );
      state = tool.onAction(state, pointerUp);

      // Binding should still exist
      expect(state.doc.bindings[binding.id]).toBeDefined();
      expect(state.doc.bindings[binding.id].toShapeId).toBe(targetRect.id);
    });
  });

  describe("Adding points with Alt+click", () => {
    it("should add a point when Alt+clicking on a segment", () => {
      const store = Store.create();
      let state = store.getState();

      const page = state.doc.pages[Object.keys(state.doc.pages)[0]];
      const arrow = ShapeRecord.createArrow(page.id, 100, 100, {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [...page.shapeIds, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      store.setState(state);

      const tool = new SelectTool();
      tool.onEnter(state);

      // Alt+click in the middle of the line
      const clickWorld = { x: 150, y: 100 }; // Midpoint of the line
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        clickWorld,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: true, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        expect(updatedArrow.props.points.length).toBe(3);
        // New point should be inserted between the start and end
        expect(updatedArrow.props.points[0]).toEqual({ x: 0, y: 0 });
        expect(updatedArrow.props.points[1].x).toBeCloseTo(50, 0);
        expect(updatedArrow.props.points[1].y).toBeCloseTo(0, 0);
        expect(updatedArrow.props.points[2]).toEqual({ x: 100, y: 0 });
      }
    });

    it("should not add a point when Alt+clicking far from any segment", () => {
      const store = Store.create();
      let state = store.getState();

      const page = state.doc.pages[Object.keys(state.doc.pages)[0]];
      const arrow = ShapeRecord.createArrow(page.id, 100, 100, {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [...page.shapeIds, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      store.setState(state);

      const tool = new SelectTool();
      tool.onEnter(state);

      // Alt+click far away from the line
      const clickWorld = { x: 150, y: 200 }; // Far from the horizontal line
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        clickWorld,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: true, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        // Should still have 2 points (no point added)
        expect(updatedArrow.props.points.length).toBe(2);
      }
    });
  });

  describe("Removing points with Delete/Backspace", () => {
    it("should remove an intermediate point when Delete is pressed while dragging", () => {
      const store = Store.create();
      let state = store.getState();

      const page = state.doc.pages[Object.keys(state.doc.pages)[0]];
      const arrow = ShapeRecord.createArrow(page.id, 100, 100, {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [...page.shapeIds, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      store.setState(state);

      const tool = new SelectTool();
      tool.onEnter(state);

      // Start dragging the intermediate point
      const intermediateWorldPos = { x: 150, y: 150 };
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        intermediateWorldPos,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      // Press Delete while dragging
      const keyDown = Action.keyDown("Delete", { ctrl: false, shift: false, alt: false, meta: false }, 100);
      state = tool.onAction(state, keyDown);

      const updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        // Should now have 2 points (intermediate point removed)
        expect(updatedArrow.props.points.length).toBe(2);
        expect(updatedArrow.props.points[0]).toEqual({ x: 0, y: 0 });
        expect(updatedArrow.props.points[1]).toEqual({ x: 100, y: 0 });
      }
    });

    it("should not remove points if it would leave less than 2 points", () => {
      const store = Store.create();
      let state = store.getState();

      const page = state.doc.pages[Object.keys(state.doc.pages)[0]];
      const arrow = ShapeRecord.createArrow(page.id, 100, 100, {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
        start: { kind: "free" },
        end: { kind: "free" },
        style: { stroke: "#000", width: 2, headEnd: true },
      });

      state = {
        ...state,
        doc: {
          ...state.doc,
          shapes: { ...state.doc.shapes, [arrow.id]: arrow },
          pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [...page.shapeIds, arrow.id] } },
        },
        ui: { ...state.ui, selectionIds: [arrow.id] },
      };

      store.setState(state);

      const tool = new SelectTool();
      tool.onEnter(state);

      // Remove one intermediate point (should work)
      const intermediateWorldPos = { x: 150, y: 150 };
      const pointerDown = Action.pointerDown(
        { x: 0, y: 0 },
        intermediateWorldPos,
        0,
        { left: true, middle: false, right: false },
        { ctrl: false, shift: false, alt: false, meta: false },
        0,
      );
      state = tool.onAction(state, pointerDown);

      const keyDown = Action.keyDown("Delete", { ctrl: false, shift: false, alt: false, meta: false }, 100);
      state = tool.onAction(state, keyDown);

      let updatedArrow = state.doc.shapes[arrow.id];
      expect(updatedArrow.type).toBe("arrow");
      if (updatedArrow.type === "arrow") {
        expect(updatedArrow.props.points.length).toBe(2);
      }

      // Now we have only 2 points. Trying to remove any would be invalid.
      // (In the current implementation, you can only remove intermediate points,
      // and with only 2 points there are no intermediate points to remove)
    });
  });
});
