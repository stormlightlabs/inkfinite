// TODO: split up and move to test dir
import { beforeEach, describe, expect, it } from "vitest";
import { Action, Modifiers, PointerButtons } from "./actions";
import {
  type ArrowProps,
  type EllipseProps,
  type LineProps,
  PageRecord,
  type RectProps,
  ShapeRecord,
  type TextProps,
} from "./model";
import { EditorState } from "./reactivity";
import { ArrowTool, EllipseTool, LineTool, RectTool, SelectTool, TextTool } from "./tools";

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

describe("RectTool", () => {
  let tool: RectTool;
  let initialState: EditorState;
  let page: PageRecord;

  beforeEach(() => {
    tool = new RectTool();
    page = PageRecord.create("Test Page");

    initialState = {
      ...EditorState.create(),
      doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
      ui: { currentPageId: page.id, selectionIds: [], toolId: "rect" },
    };
  });

  describe("shape creation", () => {
    it("should create a rect shape on pointer down", () => {
      const action = Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const result = tool.onAction(initialState, action);

      const shapeIds = Object.keys(result.doc.shapes);
      expect(shapeIds.length).toBe(1);

      const shape = result.doc.shapes[shapeIds[0]];
      expect(shape.type).toBe("rect");
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
      expect((shape.props as RectProps).w).toBe(0);
      expect((shape.props as RectProps).h).toBe(0);
      expect(result.ui.selectionIds).toEqual([shape.id]);
    });

    it("should update rect dimensions on pointer move", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 200, y: 150 },
          { x: 200, y: 150 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      const shapeId = Object.keys(result.doc.shapes)[0];
      const shape = result.doc.shapes[shapeId];

      expect(shape.type).toBe("rect");
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
      expect((shape.props as RectProps).w).toBe(100);
      expect((shape.props as RectProps).h).toBe(50);
    });

    it("should handle negative dragging (drag up-left)", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: 200, y: 200 },
          { x: 200, y: 200 },
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

      const shapeId = Object.keys(result.doc.shapes)[0];
      const shape = result.doc.shapes[shapeId];

      expect(shape.type).toBe("rect");
      expect(shape.x).toBe(100);
      expect(shape.y).toBe(100);
      expect((shape.props as RectProps).w).toBe(100);
      expect((shape.props as RectProps).h).toBe(100);
    });

    it("should remove shape if too small on pointer up", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 102, y: 102 },
          { x: 102, y: 102 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerUp(
          { x: 102, y: 102 },
          { x: 102, y: 102 },
          0,
          PointerButtons.create(false, false, false),
          Modifiers.create(),
        ),
      );

      expect(Object.keys(result.doc.shapes).length).toBe(0);
      expect(result.ui.selectionIds).toEqual([]);
    });

    it("should keep shape if large enough on pointer up", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerMove(
          { x: 200, y: 200 },
          { x: 200, y: 200 },
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(
        result,
        Action.pointerUp(
          { x: 200, y: 200 },
          { x: 200, y: 200 },
          0,
          PointerButtons.create(false, false, false),
          Modifiers.create(),
        ),
      );

      expect(Object.keys(result.doc.shapes).length).toBe(1);
    });

    it("should cancel shape creation on Escape", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onAction(result, Action.keyDown("Escape", "Escape", Modifiers.create()));

      expect(Object.keys(result.doc.shapes).length).toBe(0);
      expect(result.ui.selectionIds).toEqual([]);
    });

    it("should cleanup on tool exit", () => {
      let result = tool.onAction(
        initialState,
        Action.pointerDown(
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          0,
          PointerButtons.create(true, false, false),
          Modifiers.create(),
        ),
      );

      result = tool.onExit(result);

      expect(Object.keys(result.doc.shapes).length).toBe(0);
      expect(result.ui.selectionIds).toEqual([]);
    });
  });
});

describe("EllipseTool", () => {
  let tool: EllipseTool;
  let initialState: EditorState;
  let page: PageRecord;

  beforeEach(() => {
    tool = new EllipseTool();
    page = PageRecord.create("Test Page");

    initialState = {
      ...EditorState.create(),
      doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
      ui: { currentPageId: page.id, selectionIds: [], toolId: "ellipse" },
    };
  });

  it("should create an ellipse shape on pointer down", () => {
    const result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const shapeIds = Object.keys(result.doc.shapes);
    expect(shapeIds.length).toBe(1);

    const shape = result.doc.shapes[shapeIds[0]];
    expect(shape.type).toBe("ellipse");
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
  });

  it("should update ellipse dimensions on pointer move", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 250, y: 200 },
        { x: 250, y: 200 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const shapeId = Object.keys(result.doc.shapes)[0];
    const shape = result.doc.shapes[shapeId];

    expect(shape.type).toBe("ellipse");
    expect((shape.props as EllipseProps).w).toBe(150);
    expect((shape.props as EllipseProps).h).toBe(100);
  });

  it("should remove ellipse if too small on pointer up", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 103, y: 103 },
        { x: 103, y: 103 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 103, y: 103 },
        { x: 103, y: 103 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    expect(Object.keys(result.doc.shapes).length).toBe(0);
  });
});

describe("LineTool", () => {
  let tool: LineTool;
  let initialState: EditorState;
  let page: PageRecord;

  beforeEach(() => {
    tool = new LineTool();
    page = PageRecord.create("Test Page");

    initialState = {
      ...EditorState.create(),
      doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
      ui: { currentPageId: page.id, selectionIds: [], toolId: "line" },
    };
  });

  it("should create a line shape on pointer down", () => {
    const result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const shapeIds = Object.keys(result.doc.shapes);
    expect(shapeIds.length).toBe(1);

    const shape = result.doc.shapes[shapeIds[0]];
    expect(shape.type).toBe("line");
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect((shape.props as LineProps).a).toEqual({ x: 0, y: 0 });
    expect((shape.props as LineProps).b).toEqual({ x: 0, y: 0 });
  });

  it("should update line endpoint on pointer move", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 200, y: 150 },
        { x: 200, y: 150 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const shapeId = Object.keys(result.doc.shapes)[0];
    const shape = result.doc.shapes[shapeId];

    expect(shape.type).toBe("line");
    expect((shape.props as LineProps).b).toEqual({ x: 100, y: 50 });
  });

  it("should remove line if too short on pointer up", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 102, y: 102 },
        { x: 102, y: 102 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 102, y: 102 },
        { x: 102, y: 102 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    expect(Object.keys(result.doc.shapes).length).toBe(0);
  });

  it("should keep line if long enough on pointer up", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 200, y: 200 },
        { x: 200, y: 200 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 200, y: 200 },
        { x: 200, y: 200 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    expect(Object.keys(result.doc.shapes).length).toBe(1);
  });
});

describe("ArrowTool", () => {
  let tool: ArrowTool;
  let initialState: EditorState;
  let page: PageRecord;

  beforeEach(() => {
    tool = new ArrowTool();
    page = PageRecord.create("Test Page");

    initialState = {
      ...EditorState.create(),
      doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
      ui: { currentPageId: page.id, selectionIds: [], toolId: "arrow" },
    };
  });

  it("should create an arrow shape on pointer down", () => {
    const result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const shapeIds = Object.keys(result.doc.shapes);
    expect(shapeIds.length).toBe(1);

    const shape = result.doc.shapes[shapeIds[0]];
    expect(shape.type).toBe("arrow");
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
  });

  it("should update arrow endpoint on pointer move", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 300, y: 200 },
        { x: 300, y: 200 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const shapeId = Object.keys(result.doc.shapes)[0];
    const shape = result.doc.shapes[shapeId];

    expect(shape.type).toBe("arrow");
    expect((shape.props as ArrowProps).b).toEqual({ x: 200, y: 100 });
  });

  it("should remove arrow if too short on pointer up", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 101, y: 101 },
        { x: 101, y: 101 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 101, y: 101 },
        { x: 101, y: 101 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    expect(Object.keys(result.doc.shapes).length).toBe(0);
  });
});

describe("TextTool", () => {
  let tool: TextTool;
  let initialState: EditorState;
  let page: PageRecord;

  beforeEach(() => {
    tool = new TextTool();
    page = PageRecord.create("Test Page");

    initialState = {
      ...EditorState.create(),
      doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
      ui: { currentPageId: page.id, selectionIds: [], toolId: "text" },
    };
  });

  it("should create a text shape on pointer down", () => {
    const result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 150, y: 200 },
        { x: 150, y: 200 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const shapeIds = Object.keys(result.doc.shapes);
    expect(shapeIds.length).toBe(1);

    const shape = result.doc.shapes[shapeIds[0]];
    expect(shape.type).toBe("text");
    expect(shape.x).toBe(150);
    expect(shape.y).toBe(200);
    expect((shape.props as TextProps).text).toBe("Text");
    expect((shape.props as TextProps).fontSize).toBe(16);
    expect(result.ui.selectionIds).toEqual([shape.id]);
  });

  it("should create new text shape on each click", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerDown(
        { x: 200, y: 200 },
        { x: 200, y: 200 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    expect(Object.keys(result.doc.shapes).length).toBe(2);
  });

  it("should not respond to pointer move or up", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    const beforeMove = result;
    const shapeCountBefore = Object.keys(result.doc.shapes).length;

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 200, y: 200 },
        { x: 200, y: 200 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    expect(result).toBe(beforeMove);
    expect(Object.keys(result.doc.shapes).length).toBe(shapeCountBefore);

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 200, y: 200 },
        { x: 200, y: 200 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    expect(result).toBe(beforeMove);
    expect(Object.keys(result.doc.shapes).length).toBe(shapeCountBefore);
  });
});

describe("Arrow Bindings", () => {
  let tool: ArrowTool;
  let initialState: EditorState;
  let page: PageRecord;
  let targetShape: ShapeRecord;

  beforeEach(() => {
    tool = new ArrowTool();
    page = PageRecord.create("Test Page");

    targetShape = ShapeRecord.createRect(page.id, 100, 100, {
      w: 100,
      h: 100,
      fill: "#ff0000",
      stroke: "#000000",
      radius: 0,
    });

    page.shapeIds = [targetShape.id];

    initialState = {
      ...EditorState.create(),
      doc: { pages: { [page.id]: page }, shapes: { [targetShape.id]: targetShape }, bindings: {} },
      ui: { currentPageId: page.id, selectionIds: [], toolId: "arrow" },
    };
  });

  it("should create binding when arrow start hits a shape", () => {
    let result = tool.onAction(
      initialState,
      Action.pointerDown(
        { x: 150, y: 150 },
        { x: 150, y: 150 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 300, y: 300 },
        { x: 300, y: 300 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 300, y: 300 },
        { x: 300, y: 300 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    const bindings = Object.values(result.doc.bindings);
    expect(bindings.length).toBe(1);
    expect(bindings[0].toShapeId).toBe(targetShape.id);
    expect(bindings[0].handle).toBe("start");
  });

  it("should create binding when arrow end hits a shape", () => {
    let result = tool.onAction(
      initialState,
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
        { x: 150, y: 150 },
        { x: 150, y: 150 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 150, y: 150 },
        { x: 150, y: 150 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    const bindings = Object.values(result.doc.bindings);
    expect(bindings.length).toBe(1);
    expect(bindings[0].toShapeId).toBe(targetShape.id);
    expect(bindings[0].handle).toBe("end");
  });

  it("should create bindings for both ends when both hit shapes", () => {
    const targetShape2 = ShapeRecord.createRect(page.id, 300, 300, {
      w: 100,
      h: 100,
      fill: "#00ff00",
      stroke: "#000000",
      radius: 0,
    });

    const stateWithTwoTargets = {
      ...initialState,
      doc: {
        ...initialState.doc,
        shapes: { ...initialState.doc.shapes, [targetShape2.id]: targetShape2 },
        pages: { [page.id]: { ...page, shapeIds: [targetShape.id, targetShape2.id] } },
      },
    };

    let result = tool.onAction(
      stateWithTwoTargets,
      Action.pointerDown(
        { x: 150, y: 150 },
        { x: 150, y: 150 },
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerMove(
        { x: 350, y: 350 },
        { x: 350, y: 350 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 350, y: 350 },
        { x: 350, y: 350 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    const bindings = Object.values(result.doc.bindings);
    expect(bindings.length).toBe(2);

    const startBinding = bindings.find((b) => b.handle === "start");
    const endBinding = bindings.find((b) => b.handle === "end");

    expect(startBinding).toBeDefined();
    expect(startBinding?.toShapeId).toBe(targetShape.id);

    expect(endBinding).toBeDefined();
    expect(endBinding?.toShapeId).toBe(targetShape2.id);
  });

  it("should not create binding when arrow does not hit any shape", () => {
    let result = tool.onAction(
      initialState,
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
        { x: 80, y: 80 },
        { x: 80, y: 80 },
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      ),
    );

    result = tool.onAction(
      result,
      Action.pointerUp(
        { x: 80, y: 80 },
        { x: 80, y: 80 },
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      ),
    );

    const bindings = Object.values(result.doc.bindings);
    expect(bindings.length).toBe(0);
  });
});
