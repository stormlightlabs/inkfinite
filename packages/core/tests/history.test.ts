import { describe, expect, it } from "vitest";
import { Camera } from "../src/camera";
import {
  CreateShapeCommand,
  DeleteShapesCommand,
  History,
  SetCameraCommand,
  SetSelectionCommand,
  UpdateShapeCommand,
} from "../src/history";
import { PageRecord, ShapeRecord } from "../src/model";
import { EditorState } from "../src/reactivity";

describe("History", () => {
  describe("History namespace", () => {
    it("should create empty history state", () => {
      const history = History.create();

      expect(history.undoStack).toEqual([]);
      expect(history.redoStack).toEqual([]);
    });

    it("should check if undo/redo are available", () => {
      const history = History.create();

      expect(History.canUndo(history)).toBe(false);
      expect(History.canRedo(history)).toBe(false);
    });
  });

  describe("CreateShapeCommand", () => {
    it("should execute create shape command", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect("page:1", 10, 20, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      let state = EditorState.create();
      state = { ...state, doc: { ...state.doc, pages: { [page.id]: page } } };

      const command = new CreateShapeCommand(shape, page.id);
      const history = History.create();

      const [newHistory, newState] = History.execute(history, state, command);

      expect(newState.doc.shapes[shape.id]).toEqual(shape);
      expect(newState.doc.pages[page.id].shapeIds).toContain(shape.id);
      expect(newHistory.undoStack).toHaveLength(1);
      expect(newHistory.redoStack).toHaveLength(0);
    });

    it("should round-trip: do -> undo returns to identical state", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect("page:1", 10, 20, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      let state = EditorState.create();
      state = { ...state, doc: { ...state.doc, pages: { [page.id]: page } } };

      const originalState = EditorState.clone(state);
      const command = new CreateShapeCommand(shape, page.id);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const result = History.undo(historyAfterDo, stateAfterDo);

      expect(result).not.toBeNull();
      const [, stateAfterUndo] = result!;

      expect(stateAfterUndo).toEqual(originalState);
    });

    it("should redo re-applies exactly", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect("page:1", 10, 20, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      });

      let state = EditorState.create();
      state = { ...state, doc: { ...state.doc, pages: { [page.id]: page } } };

      const command = new CreateShapeCommand(shape, page.id);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const undoResult = History.undo(historyAfterDo, stateAfterDo);
      expect(undoResult).not.toBeNull();

      const [historyAfterUndo, stateAfterUndo] = undoResult!;
      const redoResult = History.redo(historyAfterUndo, stateAfterUndo);
      expect(redoResult).not.toBeNull();

      const [, stateAfterRedo] = redoResult!;

      expect(stateAfterRedo).toEqual(stateAfterDo);
    });
  });

  describe("UpdateShapeCommand", () => {
    it("should execute update shape command", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect(
        "page:1",
        10,
        20,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape:1",
      );

      let state = EditorState.create();
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: { ...page, shapeIds: [shape.id] } }, shapes: { [shape.id]: shape } },
      };

      const updatedShape = { ...shape, x: 100, y: 200 };
      const command = new UpdateShapeCommand(shape.id, shape, updatedShape);
      const history = History.create();

      const [, newState] = History.execute(history, state, command);

      expect(newState.doc.shapes[shape.id]).toEqual(updatedShape);
    });

    it("should round-trip: do -> undo returns to identical state", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect(
        "page:1",
        10,
        20,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape:1",
      );

      let state = EditorState.create();
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: { ...page, shapeIds: [shape.id] } }, shapes: { [shape.id]: shape } },
      };

      const originalState = EditorState.clone(state);
      const updatedShape = { ...shape, x: 100, y: 200 };
      const command = new UpdateShapeCommand(shape.id, shape, updatedShape);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const result = History.undo(historyAfterDo, stateAfterDo);

      expect(result).not.toBeNull();
      const [, stateAfterUndo] = result!;

      expect(stateAfterUndo).toEqual(originalState);
    });

    it("should redo re-applies exactly", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect(
        "page:1",
        10,
        20,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape:1",
      );

      let state = EditorState.create();
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: { ...page, shapeIds: [shape.id] } }, shapes: { [shape.id]: shape } },
      };

      const updatedShape = { ...shape, x: 100, y: 200 };
      const command = new UpdateShapeCommand(shape.id, shape, updatedShape);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const undoResult = History.undo(historyAfterDo, stateAfterDo);
      expect(undoResult).not.toBeNull();

      const [historyAfterUndo, stateAfterUndo] = undoResult!;
      const redoResult = History.redo(historyAfterUndo, stateAfterUndo);
      expect(redoResult).not.toBeNull();

      const [, stateAfterRedo] = redoResult!;

      expect(stateAfterRedo).toEqual(stateAfterDo);
    });
  });

  describe("DeleteShapesCommand", () => {
    it("should execute delete shapes command", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape1 = ShapeRecord.createRect("page:1", 10, 20, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      }, "shape:1");
      const shape2 = ShapeRecord.createRect("page:1", 30, 40, {
        w: 200,
        h: 100,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      }, "shape:2");

      let state = EditorState.create();
      state = {
        ...state,
        doc: {
          ...state.doc,
          pages: { [page.id]: { ...page, shapeIds: [shape1.id, shape2.id] } },
          shapes: { [shape1.id]: shape1, [shape2.id]: shape2 },
        },
      };

      const command = new DeleteShapesCommand([shape1], page.id);
      const history = History.create();

      const [, newState] = History.execute(history, state, command);

      expect(newState.doc.shapes[shape1.id]).toBeUndefined();
      expect(newState.doc.shapes[shape2.id]).toBeDefined();
      expect(newState.doc.pages[page.id].shapeIds).not.toContain(shape1.id);
    });

    it("should round-trip: do -> undo returns to identical state", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect(
        "page:1",
        10,
        20,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape:1",
      );

      let state = EditorState.create();
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: { ...page, shapeIds: [shape.id] } }, shapes: { [shape.id]: shape } },
      };

      const originalState = EditorState.clone(state);
      const command = new DeleteShapesCommand([shape], page.id);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const result = History.undo(historyAfterDo, stateAfterDo);

      expect(result).not.toBeNull();
      const [, stateAfterUndo] = result!;

      expect(stateAfterUndo).toEqual(originalState);
    });

    it("should redo re-applies exactly", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape = ShapeRecord.createRect(
        "page:1",
        10,
        20,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape:1",
      );

      let state = EditorState.create();
      state = {
        ...state,
        doc: { ...state.doc, pages: { [page.id]: { ...page, shapeIds: [shape.id] } }, shapes: { [shape.id]: shape } },
      };

      const command = new DeleteShapesCommand([shape], page.id);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const undoResult = History.undo(historyAfterDo, stateAfterDo);
      expect(undoResult).not.toBeNull();

      const [historyAfterUndo, stateAfterUndo] = undoResult!;
      const redoResult = History.redo(historyAfterUndo, stateAfterUndo);
      expect(redoResult).not.toBeNull();

      const [, stateAfterRedo] = redoResult!;

      expect(stateAfterRedo).toEqual(stateAfterDo);
    });
  });

  describe("SetSelectionCommand", () => {
    it("should execute set selection command", () => {
      const state = EditorState.create();
      const command = new SetSelectionCommand([], ["shape:1", "shape:2"]);
      const history = History.create();

      const [, newState] = History.execute(history, state, command);

      expect(newState.ui.selectionIds).toEqual(["shape:1", "shape:2"]);
    });

    it("should round-trip: do -> undo returns to identical state", () => {
      const state = EditorState.create();
      const originalState = EditorState.clone(state);
      const command = new SetSelectionCommand([], ["shape:1", "shape:2"]);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const result = History.undo(historyAfterDo, stateAfterDo);

      expect(result).not.toBeNull();
      const [, stateAfterUndo] = result!;

      expect(stateAfterUndo).toEqual(originalState);
    });

    it("should redo re-applies exactly", () => {
      const state = EditorState.create();
      const command = new SetSelectionCommand([], ["shape:1", "shape:2"]);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const undoResult = History.undo(historyAfterDo, stateAfterDo);
      expect(undoResult).not.toBeNull();

      const [historyAfterUndo, stateAfterUndo] = undoResult!;
      const redoResult = History.redo(historyAfterUndo, stateAfterUndo);
      expect(redoResult).not.toBeNull();

      const [, stateAfterRedo] = redoResult!;

      expect(stateAfterRedo).toEqual(stateAfterDo);
    });
  });

  describe("SetCameraCommand", () => {
    it("should execute set camera command", () => {
      const state = EditorState.create();
      const beforeCamera = Camera.create();
      const afterCamera = Camera.create(100, 200, 2);
      const command = new SetCameraCommand(beforeCamera, afterCamera);
      const history = History.create();

      const [, newState] = History.execute(history, state, command);

      expect(newState.camera).toEqual(afterCamera);
    });

    it("should round-trip: do -> undo returns to identical state", () => {
      const state = EditorState.create();
      const originalState = EditorState.clone(state);
      const beforeCamera = Camera.create();
      const afterCamera = Camera.create(100, 200, 2);
      const command = new SetCameraCommand(beforeCamera, afterCamera);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const result = History.undo(historyAfterDo, stateAfterDo);

      expect(result).not.toBeNull();
      const [, stateAfterUndo] = result!;

      expect(stateAfterUndo).toEqual(originalState);
    });

    it("should redo re-applies exactly", () => {
      const state = EditorState.create();
      const beforeCamera = Camera.create();
      const afterCamera = Camera.create(100, 200, 2);
      const command = new SetCameraCommand(beforeCamera, afterCamera);
      const history = History.create();

      const [historyAfterDo, stateAfterDo] = History.execute(history, state, command);
      const undoResult = History.undo(historyAfterDo, stateAfterDo);
      expect(undoResult).not.toBeNull();

      const [historyAfterUndo, stateAfterUndo] = undoResult!;
      const redoResult = History.redo(historyAfterUndo, stateAfterUndo);
      expect(redoResult).not.toBeNull();

      const [, stateAfterRedo] = redoResult!;

      expect(stateAfterRedo).toEqual(stateAfterDo);
    });
  });

  describe("History stack operations", () => {
    it("should clear redo stack when new command is executed", () => {
      const state = EditorState.create();
      const command1 = new SetSelectionCommand([], ["shape:1"]);
      const command2 = new SetSelectionCommand(["shape:1"], ["shape:2"]);
      let history = History.create();

      [history] = History.execute(history, state, command1);

      const undoResult = History.undo(history, state);
      expect(undoResult).not.toBeNull();
      [history] = undoResult!;

      expect(history.redoStack).toHaveLength(1);

      [history] = History.execute(history, state, command2);

      expect(history.redoStack).toHaveLength(0);
    });

    it("should return null when undoing empty stack", () => {
      const state = EditorState.create();
      const history = History.create();

      const result = History.undo(history, state);

      expect(result).toBeNull();
    });

    it("should return null when redoing empty stack", () => {
      const state = EditorState.create();
      const history = History.create();

      const result = History.redo(history, state);

      expect(result).toBeNull();
    });

    it("should maintain command order through undo/redo", () => {
      const page = PageRecord.create("Test Page", "page:1");
      const shape1 = ShapeRecord.createRect("page:1", 10, 20, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      }, "shape:1");
      const shape2 = ShapeRecord.createRect("page:1", 30, 40, {
        w: 200,
        h: 100,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      }, "shape:2");

      let state = EditorState.create();
      state = { ...state, doc: { ...state.doc, pages: { [page.id]: page } } };

      const command1 = new CreateShapeCommand(shape1, page.id);
      const command2 = new CreateShapeCommand(shape2, page.id);
      let history = History.create();

      let currentState = state;
      [history, currentState] = History.execute(history, currentState, command1);
      [history, currentState] = History.execute(history, currentState, command2);

      expect(currentState.doc.shapes[shape1.id]).toBeDefined();
      expect(currentState.doc.shapes[shape2.id]).toBeDefined();

      const undo1 = History.undo(history, currentState);
      expect(undo1).not.toBeNull();
      [history, currentState] = undo1!;

      expect(currentState.doc.shapes[shape1.id]).toBeDefined();
      expect(currentState.doc.shapes[shape2.id]).toBeUndefined();

      const undo2 = History.undo(history, currentState);
      expect(undo2).not.toBeNull();
      [history, currentState] = undo2!;

      expect(currentState.doc.shapes[shape1.id]).toBeUndefined();
      expect(currentState.doc.shapes[shape2.id]).toBeUndefined();

      const redo1 = History.redo(history, currentState);
      expect(redo1).not.toBeNull();
      [history, currentState] = redo1!;

      expect(currentState.doc.shapes[shape1.id]).toBeDefined();
      expect(currentState.doc.shapes[shape2.id]).toBeUndefined();

      const redo2 = History.redo(history, currentState);
      expect(redo2).not.toBeNull();
      [, currentState] = redo2!;

      expect(currentState.doc.shapes[shape1.id]).toBeDefined();
      expect(currentState.doc.shapes[shape2.id]).toBeDefined();
    });
  });
});
