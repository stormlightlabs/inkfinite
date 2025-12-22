import { describe, expect, it, vi } from "vitest";
import { Camera } from "../src/camera";
import { CreateShapeCommand } from "../src/history";
import { PageRecord, ShapeRecord } from "../src/model";
import {
  EditorState as EditorStateOps,
  getAllPages,
  getCurrentPage,
  getSelectedShapes,
  getShape,
  getShapesOnCurrentPage,
  isShapeSelected,
  Store,
} from "../src/reactivity";

describe("EditorState", () => {
  describe("create", () => {
    it("should create initial editor state", () => {
      const state = EditorStateOps.create();

      expect(state.doc.pages).toEqual({});
      expect(state.doc.shapes).toEqual({});
      expect(state.doc.bindings).toEqual({});
      expect(state.ui.currentPageId).toBeNull();
      expect(state.ui.selectionIds).toEqual([]);
      expect(state.ui.toolId).toBe("select");
      expect(state.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  describe("clone", () => {
    it("should deep clone editor state", () => {
      const state = EditorStateOps.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];
      state.doc.pages = { page1: page };
      state.doc.shapes = { shape1: shape };
      state.ui.currentPageId = "page1";
      state.ui.selectionIds = ["shape1"];
      state.camera = { x: 100, y: 200, zoom: 1.5 };

      const cloned = EditorStateOps.clone(state);

      expect(cloned).toEqual(state);
      expect(cloned).not.toBe(state);
      expect(cloned.doc).not.toBe(state.doc);
      expect(cloned.ui).not.toBe(state.ui);
      expect(cloned.camera).not.toBe(state.camera);
      expect(cloned.ui.selectionIds).not.toBe(state.ui.selectionIds);
    });
  });
});

describe("Store", () => {
  describe("constructor", () => {
    it("should create store with default initial state", () => {
      const store = new Store();
      const state = store.getState();

      expect(state.doc.pages).toEqual({});
      expect(state.ui.currentPageId).toBeNull();
      expect(state.ui.selectionIds).toEqual([]);
      expect(state.ui.toolId).toBe("select");
    });

    it("should create store with custom initial state", () => {
      const initialState = EditorStateOps.create();
      initialState.ui.toolId = "rect";
      initialState.camera = { x: 100, y: 200, zoom: 2 };

      const store = new Store(initialState);
      const state = store.getState();

      expect(state.ui.toolId).toBe("rect");
      expect(state.camera.x).toBe(100);
      expect(state.camera.y).toBe(200);
      expect(state.camera.zoom).toBe(2);
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      const store = new Store();
      const state = store.getState();

      expect(state).toBeDefined();
      expect(state.doc).toBeDefined();
      expect(state.ui).toBeDefined();
      expect(state.camera).toBeDefined();
    });

    it("should return same state on multiple calls if no updates", () => {
      const store = new Store();
      const state1 = store.getState();
      const state2 = store.getState();

      expect(state1).toBe(state2);
    });
  });

  describe("setState", () => {
    it("should update state using updater function", () => {
      const store = new Store();

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "ellipse" } }));

      const state = store.getState();
      expect(state.ui.toolId).toBe("ellipse");
    });

    it("should update camera position", () => {
      const store = new Store();

      store.setState((state) => ({ ...state, camera: Camera.pan(state.camera, { x: 50, y: 30 }) }));

      const state = store.getState();
      expect(state.camera.x).toBe(-50);
      expect(state.camera.y).toBe(-30);
    });

    it("should update document", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const state = store.getState();
      expect(state.doc.pages.page1).toBeDefined();
      expect(state.doc.pages.page1.name).toBe("Page 1");
    });
  });

  describe("subscribe", () => {
    it("should call listener immediately with current state", () => {
      const store = new Store();
      const listener = vi.fn();

      store.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(store.getState());
    });

    it("should call listener on state change", () => {
      const store = new Store();
      const listener = vi.fn();

      store.subscribe(listener);
      listener.mockClear();

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "rect" } }));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should call listener exactly once per setState", () => {
      const store = new Store();
      const listener = vi.fn();

      store.subscribe(listener);
      listener.mockClear();

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "rect" } }));

      expect(listener).toHaveBeenCalledTimes(1);

      listener.mockClear();
      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "ellipse" } }));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should support multiple subscribers", () => {
      const store = new Store();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      store.subscribe(listener1);
      store.subscribe(listener2);

      listener1.mockClear();
      listener2.mockClear();

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "arrow" } }));

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should unsubscribe when unsubscribe function is called", () => {
      const store = new Store();
      const listener = vi.fn();

      const unsubscribe = store.subscribe(listener);
      listener.mockClear();

      unsubscribe();

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "line" } }));

      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle multiple subscriptions and unsubscriptions independently", () => {
      const store = new Store();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsubscribe1 = store.subscribe(listener1);
      const unsubscribe2 = store.subscribe(listener2);

      listener1.mockClear();
      listener2.mockClear();

      unsubscribe1();

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "text" } }));

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);

      listener2.mockClear();
      unsubscribe2();

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "pen" } }));

      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe("getObservable", () => {
    it("should return RxJS observable", () => {
      const store = new Store();
      const observable = store.getObservable();

      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe("function");
    });

    it("should emit values on state changes", () => {
      const store = new Store();
      const observable = store.getObservable();

      const states: string[] = [];
      observable.subscribe((state) => {
        states.push(state.ui.toolId);
      });

      store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "rect" } }));

      expect(states).toEqual(["select", "rect"]);
    });
  });
});

describe("Invariants", () => {
  describe("currentPageId invariant", () => {
    it("should repair invalid currentPageId to null when page does not exist", () => {
      const store = new Store();

      store.setState((state) => ({ ...state, ui: { ...state.ui, currentPageId: "nonexistent" } }));

      const state = store.getState();
      expect(state.ui.currentPageId).toBeNull();
    });

    it("should repair invalid currentPageId to first page when pages exist", () => {
      const store = new Store();
      const page1 = PageRecord.create("Page 1", "page1");
      const page2 = PageRecord.create("Page 2", "page2");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1, page2 } },
        ui: { ...state.ui, currentPageId: "nonexistent" },
      }));

      const state = store.getState();
      expect(state.ui.currentPageId).toBe("page1");
    });

    it("should keep valid currentPageId", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page } },
        ui: { ...state.ui, currentPageId: "page1" },
      }));

      const state = store.getState();
      expect(state.ui.currentPageId).toBe("page1");
    });
  });

  describe("selectionIds invariant", () => {
    it("should clear selection when currentPageId is null", () => {
      const store = new Store();

      store.setState((state) => ({
        ...state,
        ui: { ...state.ui, currentPageId: null, selectionIds: ["shape1", "shape2"] },
      }));

      const state = store.getState();
      expect(state.ui.selectionIds).toEqual([]);
    });

    it("should remove non-existent shapes from selection", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
        ui: { ...state.ui, currentPageId: "page1", selectionIds: ["shape1", "nonexistent", "shape2"] },
      }));

      const state = store.getState();
      expect(state.ui.selectionIds).toEqual(["shape1"]);
    });

    it("should remove shapes not on current page from selection", () => {
      const store = new Store();
      const page1 = PageRecord.create("Page 1", "page1");
      const page2 = PageRecord.create("Page 2", "page2");

      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      const shape2 = ShapeRecord.createRect(
        "page2",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape2",
      );

      page1.shapeIds = ["shape1"];
      page2.shapeIds = ["shape2"];

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1, page2 }, shapes: { shape1, shape2 } },
        ui: { ...state.ui, currentPageId: "page1", selectionIds: ["shape1", "shape2"] },
      }));

      const state = store.getState();
      expect(state.ui.selectionIds).toEqual(["shape1"]);
    });

    it("should keep valid selection", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      const shape2 = ShapeRecord.createRect(
        "page1",
        50,
        50,
        { w: 75, h: 75, fill: "#000", stroke: "#fff", radius: 0 },
        "shape2",
      );

      page.shapeIds = ["shape1", "shape2"];

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1, shape2 } },
        ui: { ...state.ui, currentPageId: "page1", selectionIds: ["shape1", "shape2"] },
      }));

      const state = store.getState();
      expect(state.ui.selectionIds).toEqual(["shape1", "shape2"]);
    });

    it("should maintain reference equality when no repair needed", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
        ui: { ...state.ui, currentPageId: "page1", selectionIds: ["shape1"] },
      }));

      const stateBefore = store.getState();

      store.setState((state) => ({ ...state, camera: { ...state.camera, x: 100 } }));

      const stateAfter = store.getState();

      expect(stateAfter.ui.currentPageId).toBe(stateBefore.ui.currentPageId);
    });
  });

  describe("invariant repair on deletion", () => {
    it("should clear selection when selected shape is deleted", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1"];

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1 } },
        ui: { ...state.ui, currentPageId: "page1", selectionIds: ["shape1"] },
      }));

      store.setState((state) => {
        const newPage = { ...state.doc.pages.page1, shapeIds: [] };
        return { ...state, doc: { ...state.doc, pages: { page1: newPage }, shapes: {} } };
      });

      const state = store.getState();
      expect(state.ui.selectionIds).toEqual([]);
    });

    it("should update currentPageId when current page is deleted", () => {
      const store = new Store();
      const page1 = PageRecord.create("Page 1", "page1");
      const page2 = PageRecord.create("Page 2", "page2");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1, page2 } },
        ui: { ...state.ui, currentPageId: "page1" },
      }));

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page2 } } }));

      const state = store.getState();
      expect(state.ui.currentPageId).toBe("page2");
    });
  });
});

describe("Selectors", () => {
  describe("getCurrentPage", () => {
    it("should return null when no page is selected", () => {
      const state = EditorStateOps.create();
      const result = getCurrentPage(state);

      expect(result).toBeNull();
    });

    it("should return current page", () => {
      const state = EditorStateOps.create();
      const page = PageRecord.create("Page 1", "page1");

      state.doc.pages = { page1: page };
      state.ui.currentPageId = "page1";

      const result = getCurrentPage(state);

      expect(result).toBe(page);
      expect(result?.name).toBe("Page 1");
    });

    it("should return null when currentPageId does not exist", () => {
      const state = EditorStateOps.create();
      state.ui.currentPageId = "nonexistent";

      const result = getCurrentPage(state);

      expect(result).toBeNull();
    });
  });

  describe("getShapesOnCurrentPage", () => {
    it("should return empty array when no page is selected", () => {
      const state = EditorStateOps.create();
      const result = getShapesOnCurrentPage(state);

      expect(result).toEqual([]);
    });

    it("should return empty array for empty page", () => {
      const state = EditorStateOps.create();
      const page = PageRecord.create("Page 1", "page1");

      state.doc.pages = { page1: page };
      state.ui.currentPageId = "page1";

      const result = getShapesOnCurrentPage(state);

      expect(result).toEqual([]);
    });

    it("should return all shapes on current page", () => {
      const state = EditorStateOps.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      const shape2 = ShapeRecord.createEllipse(
        "page1",
        50,
        50,
        { w: 75, h: 75, fill: "#000", stroke: "#fff" },
        "shape2",
      );

      page.shapeIds = ["shape1", "shape2"];
      state.doc.pages = { page1: page };
      state.doc.shapes = { shape1, shape2 };
      state.ui.currentPageId = "page1";

      const result = getShapesOnCurrentPage(state);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(shape1);
      expect(result[1]).toBe(shape2);
    });

    it("should filter out undefined shapes", () => {
      const state = EditorStateOps.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      page.shapeIds = ["shape1", "nonexistent"];
      state.doc.pages = { page1: page };
      state.doc.shapes = { shape1 };
      state.ui.currentPageId = "page1";

      const result = getShapesOnCurrentPage(state);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(shape1);
    });

    it("should not include shapes from other pages", () => {
      const state = EditorStateOps.create();
      const page1 = PageRecord.create("Page 1", "page1");
      const page2 = PageRecord.create("Page 2", "page2");

      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      const shape2 = ShapeRecord.createRect(
        "page2",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape2",
      );

      page1.shapeIds = ["shape1"];
      page2.shapeIds = ["shape2"];

      state.doc.pages = { page1, page2 };
      state.doc.shapes = { shape1, shape2 };
      state.ui.currentPageId = "page1";

      const result = getShapesOnCurrentPage(state);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(shape1);
    });
  });

  describe("getSelectedShapes", () => {
    it("should return empty array when no selection", () => {
      const state = EditorStateOps.create();
      const result = getSelectedShapes(state);

      expect(result).toEqual([]);
    });

    it("should return selected shapes", () => {
      const state = EditorStateOps.create();
      const page = PageRecord.create("Page 1", "page1");
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );
      const shape2 = ShapeRecord.createEllipse(
        "page1",
        50,
        50,
        { w: 75, h: 75, fill: "#000", stroke: "#fff" },
        "shape2",
      );
      const shape3 = ShapeRecord.createLine("page1", 100, 100, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        stroke: "#000",
        width: 2,
      }, "shape3");

      page.shapeIds = ["shape1", "shape2", "shape3"];
      state.doc.pages = { page1: page };
      state.doc.shapes = { shape1, shape2, shape3 };
      state.ui.currentPageId = "page1";
      state.ui.selectionIds = ["shape1", "shape3"];

      const result = getSelectedShapes(state);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(shape1);
      expect(result[1]).toBe(shape3);
    });

    it("should filter out undefined shapes", () => {
      const state = EditorStateOps.create();
      const shape1 = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      state.doc.shapes = { shape1 };
      state.ui.selectionIds = ["shape1", "nonexistent"];

      const result = getSelectedShapes(state);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(shape1);
    });
  });

  describe("isShapeSelected", () => {
    it("should return false when shape is not selected", () => {
      const state = EditorStateOps.create();
      state.ui.selectionIds = ["shape1", "shape2"];

      expect(isShapeSelected(state, "shape3")).toBe(false);
    });

    it("should return true when shape is selected", () => {
      const state = EditorStateOps.create();
      state.ui.selectionIds = ["shape1", "shape2"];

      expect(isShapeSelected(state, "shape1")).toBe(true);
      expect(isShapeSelected(state, "shape2")).toBe(true);
    });

    it("should return false for empty selection", () => {
      const state = EditorStateOps.create();
      state.ui.selectionIds = [];

      expect(isShapeSelected(state, "shape1")).toBe(false);
    });
  });

  describe("getAllPages", () => {
    it("should return empty array when no pages", () => {
      const state = EditorStateOps.create();
      const result = getAllPages(state);

      expect(result).toEqual([]);
    });

    it("should return all pages", () => {
      const state = EditorStateOps.create();
      const page1 = PageRecord.create("Page 1", "page1");
      const page2 = PageRecord.create("Page 2", "page2");

      state.doc.pages = { page1, page2 };

      const result = getAllPages(state);

      expect(result).toHaveLength(2);
      expect(result).toContain(page1);
      expect(result).toContain(page2);
    });
  });

  describe("getShape", () => {
    it("should return undefined for non-existent shape", () => {
      const state = EditorStateOps.create();
      const result = getShape(state, "nonexistent");

      expect(result).toBeUndefined();
    });

    it("should return shape by ID", () => {
      const state = EditorStateOps.create();
      const shape = ShapeRecord.createRect(
        "page1",
        0,
        0,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      state.doc.shapes = { shape1: shape };

      const result = getShape(state, "shape1");

      expect(result).toBe(shape);
    });
  });
});

describe("Integration scenarios", () => {
  it("should handle complete workflow: create page, add shapes, select shapes", () => {
    const store = new Store();

    const page = PageRecord.create("Page 1", "page1");
    store.setState((state) => ({
      ...state,
      doc: { ...state.doc, pages: { page1: page } },
      ui: { ...state.ui, currentPageId: "page1" },
    }));

    let state = store.getState();
    expect(getCurrentPage(state)?.name).toBe("Page 1");

    const shape1 = ShapeRecord.createRect(
      "page1",
      0,
      0,
      { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
      "shape1",
    );
    const shape2 = ShapeRecord.createEllipse("page1", 50, 50, { w: 75, h: 75, fill: "#000", stroke: "#fff" }, "shape2");

    store.setState((state) => {
      const updatedPage = { ...state.doc.pages.page1, shapeIds: ["shape1", "shape2"] };
      return { ...state, doc: { ...state.doc, pages: { page1: updatedPage }, shapes: { shape1, shape2 } } };
    });

    state = store.getState();
    expect(getShapesOnCurrentPage(state)).toHaveLength(2);

    store.setState((state) => ({ ...state, ui: { ...state.ui, selectionIds: ["shape1", "shape2"] } }));

    state = store.getState();
    expect(getSelectedShapes(state)).toHaveLength(2);
    expect(isShapeSelected(state, "shape1")).toBe(true);
  });

  it("should handle camera operations while maintaining state", () => {
    const store = new Store();
    const listener = vi.fn();

    store.subscribe(listener);
    listener.mockClear();

    store.setState((state) => ({ ...state, camera: Camera.pan(state.camera, { x: 100, y: 50 }) }));

    expect(listener).toHaveBeenCalledTimes(1);

    const state = store.getState();
    expect(state.camera.x).toBe(-100);
    expect(state.camera.y).toBe(-50);
  });

  it("should handle tool switching", () => {
    const store = new Store();
    expect(store.getState().ui.toolId).toBe("select");

    store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "rect" } }));
    expect(store.getState().ui.toolId).toBe("rect");

    store.setState((state) => ({ ...state, ui: { ...state.ui, toolId: "ellipse" } }));
    expect(store.getState().ui.toolId).toBe("ellipse");
  });
});

describe("History integration", () => {
  describe("executeCommand", () => {
    it("should execute command and add to history", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page } },
        ui: { ...state.ui, currentPageId: "page1" },
      }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);

      const state = store.getState();
      expect(state.doc.shapes[shape.id]).toBeDefined();
      expect(store.canUndo()).toBe(true);
    });

    it("should notify subscribers when command is executed", () => {
      const store = new Store();
      const listener = vi.fn();

      store.subscribe(listener);
      listener.mockClear();

      const page = PageRecord.create("Page 1", "page1");
      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      listener.mockClear();

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("undo", () => {
    it("should undo last command", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);

      expect(store.getState().doc.shapes[shape.id]).toBeDefined();

      store.undo();

      expect(store.getState().doc.shapes[shape.id]).toBeUndefined();
    });

    it("should return false when nothing to undo", () => {
      const store = new Store();
      const result = store.undo();

      expect(result).toBe(false);
    });

    it("should notify subscribers when undoing", () => {
      const store = new Store();
      const listener = vi.fn();

      store.subscribe(listener);

      const page = PageRecord.create("Page 1", "page1");
      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);

      listener.mockClear();

      store.undo();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("redo", () => {
    it("should redo last undone command", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);
      store.undo();

      expect(store.getState().doc.shapes[shape.id]).toBeUndefined();

      store.redo();

      expect(store.getState().doc.shapes[shape.id]).toBeDefined();
    });

    it("should return false when nothing to redo", () => {
      const store = new Store();
      const result = store.redo();

      expect(result).toBe(false);
    });

    it("should notify subscribers when redoing", () => {
      const store = new Store();
      const listener = vi.fn();

      store.subscribe(listener);

      const page = PageRecord.create("Page 1", "page1");
      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);
      store.undo();

      listener.mockClear();

      store.redo();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("canUndo/canRedo", () => {
    it("should return false initially", () => {
      const store = new Store();

      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
    });

    it("should return true after executing command", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);

      expect(store.canUndo()).toBe(true);
      expect(store.canRedo()).toBe(false);
    });

    it("should return true for redo after undo", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);
      store.undo();

      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
    });
  });

  describe("getHistory", () => {
    it("should return history state", () => {
      const store = new Store();
      const history = store.getHistory();

      expect(history).toBeDefined();
      expect(history.undoStack).toEqual([]);
      expect(history.redoStack).toEqual([]);
    });

    it("should return updated history after commands", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);

      const history = store.getHistory();

      expect(history.undoStack).toHaveLength(1);
      expect(history.redoStack).toHaveLength(0);
    });
  });

  describe("clearHistory", () => {
    it("should clear all history", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape = ShapeRecord.createRect("page1", 10, 20, { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 });

      const command = new CreateShapeCommand(shape, page.id);
      store.executeCommand(command);

      expect(store.canUndo()).toBe(true);

      store.clearHistory();

      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
    });
  });

  describe("history with multiple commands", () => {
    it("should handle multiple commands", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape1 = ShapeRecord.createRect(
        "page1",
        10,
        20,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      const shape2 = ShapeRecord.createRect("page1", 30, 40, {
        w: 200,
        h: 100,
        fill: "#000",
        stroke: "#fff",
        radius: 0,
      }, "shape2");

      store.executeCommand(new CreateShapeCommand(shape1, page.id));
      store.executeCommand(new CreateShapeCommand(shape2, page.id));

      expect(store.getState().doc.shapes[shape1.id]).toBeDefined();
      expect(store.getState().doc.shapes[shape2.id]).toBeDefined();

      store.undo();

      expect(store.getState().doc.shapes[shape1.id]).toBeDefined();
      expect(store.getState().doc.shapes[shape2.id]).toBeUndefined();

      store.undo();

      expect(store.getState().doc.shapes[shape1.id]).toBeUndefined();
      expect(store.getState().doc.shapes[shape2.id]).toBeUndefined();

      store.redo();

      expect(store.getState().doc.shapes[shape1.id]).toBeDefined();
      expect(store.getState().doc.shapes[shape2.id]).toBeUndefined();

      store.redo();

      expect(store.getState().doc.shapes[shape1.id]).toBeDefined();
      expect(store.getState().doc.shapes[shape2.id]).toBeDefined();
    });

    it("should clear redo stack when new command is executed", () => {
      const store = new Store();
      const page = PageRecord.create("Page 1", "page1");

      store.setState((state) => ({ ...state, doc: { ...state.doc, pages: { page1: page } } }));

      const shape1 = ShapeRecord.createRect(
        "page1",
        10,
        20,
        { w: 100, h: 50, fill: "#fff", stroke: "#000", radius: 0 },
        "shape1",
      );

      const shape2 = ShapeRecord.createRect("page1", 30, 40, {
        w: 200,
        h: 100,
        fill: "#000",
        stroke: "#fff",
        radius: 0,
      }, "shape2");

      store.executeCommand(new CreateShapeCommand(shape1, page.id));
      store.undo();

      expect(store.canRedo()).toBe(true);

      store.executeCommand(new CreateShapeCommand(shape2, page.id));

      expect(store.canRedo()).toBe(false);
    });
  });
});
