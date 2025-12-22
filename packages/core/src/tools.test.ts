import { beforeEach, describe, expect, it } from "vitest";
import { Action, Modifiers, PointerButtons } from "./actions";
import { PageRecord, ShapeRecord } from "./model";
import { EditorState } from "./reactivity";
import { SelectTool } from "./tools";

describe("SelectTool", () => {
  let tool: SelectTool;
  let initialState: EditorState;
  let page: PageRecord;
  let shape1: ShapeRecord;
  let shape2: ShapeRecord;
  let shape3: ShapeRecord;

  beforeEach(() => {
    tool = new SelectTool();
    page = PageRecord.create("Test Page");
    shape1 = ShapeRecord.createRect(page.id, 0, 0, { w: 100, h: 100, fill: "#ff0000", stroke: "#000000", radius: 0 });
    shape2 = ShapeRecord.createRect(page.id, 200, 0, { w: 100, h: 100, fill: "#00ff00", stroke: "#000000", radius: 0 });
    shape3 = ShapeRecord.createEllipse(page.id, 0, 200, { w: 80, h: 80, fill: "#0000ff", stroke: "#000000" });

    page.shapeIds = [shape1.id, shape2.id, shape3.id];

    initialState = {
      ...EditorState.create(),
      doc: {
        pages: { [page.id]: page },
        shapes: { [shape1.id]: shape1, [shape2.id]: shape2, [shape3.id]: shape3 },
        bindings: {},
      },
      ui: { currentPageId: page.id, selectionIds: [], toolId: "select" },
    };
  });

  describe("onEnter/onExit", () => {
    it("should not modify state on enter", () => {
      const result = tool.onEnter(initialState);
      expect(result).toBe(initialState);
    });

    it("should not modify state on exit", () => {
      const result = tool.onExit(initialState);
      expect(result).toBe(initialState);
    });
  });

  describe("shape selection", () => {
    it("should select shape when clicking on it", () => {
      const action = Action.pointerDown(
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const result = tool.onAction(initialState, action);

      expect(result.ui.selectionIds).toEqual([shape1.id]);
    });

    it("should replace selection when clicking on different shape", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id] } };

      const action = Action.pointerDown(
        { x: 250, y: 50 },
        { x: 250, y: 50 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const result = tool.onAction(state, action);

      expect(result.ui.selectionIds).toEqual([shape2.id]);
    });

    it("should keep selection when clicking on already selected shape", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id] } };

      const action = Action.pointerDown(
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const result = tool.onAction(state, action);
      expect(result.ui.selectionIds).toEqual([shape1.id]);
    });

    it("should clear selection when clicking on empty space", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id, shape2.id] } };

      const action = Action.pointerDown(
        { x: 500, y: 500 },
        { x: 500, y: 500 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const result = tool.onAction(state, action);
      expect(result.ui.selectionIds).toEqual([]);
    });
  });

  describe("shift-click selection", () => {
    it("should add unselected shape to selection when shift-clicking", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id] } };

      const action = Action.pointerDown(
        { x: 250, y: 50 },
        { x: 250, y: 50 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(false, true, false, false),
      );

      const result = tool.onAction(state, action);

      expect(result.ui.selectionIds).toEqual([shape1.id, shape2.id]);
    });

    it("should remove selected shape from selection when shift-clicking", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id, shape2.id] } };

      const action = Action.pointerDown(
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(false, true, false, false),
      );

      const result = tool.onAction(state, action);

      expect(result.ui.selectionIds).toEqual([shape2.id]);
    });
  });

  describe("dragging shapes", () => {
    it("should move selected shape by exact delta", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id] } };

      let result = tool.onAction(
        state,
        Action.pointerDown(
          { x: 50, y: 50 },
          { x: 50, y: 50 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 150, y: 100 },
          { x: 150, y: 100 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      const movedShape = result.doc.shapes[shape1.id];
      expect(movedShape.x).toBe(100);
      expect(movedShape.y).toBe(50);
    });

    it("should move multiple selected shapes together", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id, shape2.id] } };

      let result = tool.onAction(
        state,
        Action.pointerDown(
          { x: 50, y: 50 },
          { x: 50, y: 50 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 100, y: 150 },
          { x: 100, y: 150 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      const movedShape1 = result.doc.shapes[shape1.id];
      const movedShape2 = result.doc.shapes[shape2.id];

      expect(movedShape1.x).toBe(50);
      expect(movedShape1.y).toBe(100);
      expect(movedShape2.x).toBe(250);
      expect(movedShape2.y).toBe(100);
    });

    it("should reset drag state on pointer up", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id] } };

      let result = tool.onAction(
        state,
        Action.pointerDown(
          { x: 50, y: 50 },
          { x: 50, y: 50 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerUp(
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          0,
          PointerButtons.create(false, false, false),
          Modifiers.create(),
        ),
      );

      const movedShape = result.doc.shapes[shape1.id];
      expect(movedShape.x).toBe(50);
      expect(movedShape.y).toBe(50);
    });
  });

  describe("marquee selection", () => {
    it("should select shapes within marquee bounds", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: -50, y: -50 },
          { x: -50, y: -50 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 350, y: 150 },
          { x: 350, y: 150 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerUp(
          { x: 350, y: 150 },
          { x: 350, y: 150 },
          0,
          PointerButtons.create(false, false, false),
          Modifiers.create(),
        ),
      );

      expect(result.ui.selectionIds).toContain(shape1.id);
      expect(result.ui.selectionIds).toContain(shape2.id);
      expect(result.ui.selectionIds).not.toContain(shape3.id);
    });

    it("should select all shapes when marquee covers entire canvas", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: -100, y: -100 },
          { x: -100, y: -100 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 500, y: 500 },
          { x: 500, y: 500 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerUp(
          { x: 500, y: 500 },
          { x: 500, y: 500 },
          0,
          PointerButtons.create(false, false, false),
          Modifiers.create(),
        ),
      );

      expect(result.ui.selectionIds).toContain(shape1.id);
      expect(result.ui.selectionIds).toContain(shape2.id);
      expect(result.ui.selectionIds).toContain(shape3.id);
    });
  });

  describe("keyboard shortcuts", () => {
    it("should clear selection on Escape", () => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id, shape2.id] } };
      const result = tool.onAction(state, Action.keyDown("Escape", "Escape", Modifiers.create()));
      expect(result.ui.selectionIds).toEqual([]);
    });

    it.each([{ description: "Delete key removes selected shapes", key: "Delete", code: "Delete" }, {
      description: "Backspace key removes selected shapes",
      key: "Backspace",
      code: "Backspace",
    }])("should handle $description", ({ key, code }) => {
      const state = { ...initialState, ui: { ...initialState.ui, selectionIds: [shape1.id, shape2.id] } };
      const result = tool.onAction(state, Action.keyDown(key, code, Modifiers.create()));

      expect(result.doc.shapes[shape1.id]).toBeUndefined();
      expect(result.doc.shapes[shape2.id]).toBeUndefined();
      expect(result.doc.shapes[shape3.id]).toBeDefined();

      expect(result.ui.selectionIds).toEqual([]);

      const updatedPage = result.doc.pages[page.id];
      expect(updatedPage.shapeIds).toEqual([shape3.id]);
    });

    it("should do nothing when delete pressed with no selection", () => {
      const result = tool.onAction(initialState, Action.keyDown("Delete", "Delete", Modifiers.create()));

      expect(result.doc.shapes).toEqual(initialState.doc.shapes);
      expect(result.ui.selectionIds).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("should handle clicking on overlapping shapes (topmost wins)", () => {
      const overlappingState = {
        ...initialState,
        doc: { ...initialState.doc, shapes: { ...initialState.doc.shapes, [shape2.id]: { ...shape2, x: 50, y: 50 } } },
      };

      const action = Action.pointerDown(
        { x: 75, y: 75 },
        { x: 75, y: 75 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const result = tool.onAction(overlappingState, action);
      expect(result.ui.selectionIds).toEqual([shape2.id]);
    });

    it("should ignore unrelated action types", () => {
      const wheelAction = Action.wheel({ x: 100, y: 100 }, { x: 100, y: 100 }, -10, Modifiers.create());

      const result = tool.onAction(initialState, wheelAction);

      expect(result).toBe(initialState);
    });
  });
});
