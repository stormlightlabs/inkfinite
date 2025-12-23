import { beforeEach, describe, expect, it } from "vitest";
import { PageRecord, Store } from "../src";
import type { Action } from "../src/actions";
import { Modifiers, PointerButtons } from "../src/actions";
import { PenTool } from "../src/tools/pen";

let currentTimestamp = 1_000;

function resetTimestamp(): void {
  currentTimestamp = 1_000;
}

function nextTimestamp(step = 17): number {
  currentTimestamp += step;
  return currentTimestamp;
}

function createPointerDownAction(worldX: number, worldY: number, timestamp = nextTimestamp()): Action {
  return {
    type: "pointer-down",
    world: { x: worldX, y: worldY },
    screen: { x: worldX, y: worldY },
    button: 0,
    buttons: PointerButtons.create(true, false, false),
    modifiers: Modifiers.create(false, false, false, false),
    timestamp,
  };
}

function createPointerMoveAction(worldX: number, worldY: number, timestamp = nextTimestamp()): Action {
  return {
    type: "pointer-move",
    world: { x: worldX, y: worldY },
    screen: { x: worldX, y: worldY },
    buttons: PointerButtons.create(true, false, false),
    modifiers: Modifiers.create(false, false, false, false),
    timestamp,
  };
}

function createPointerUpAction(worldX: number, worldY: number, timestamp = nextTimestamp()): Action {
  return {
    type: "pointer-up",
    world: { x: worldX, y: worldY },
    screen: { x: worldX, y: worldY },
    button: 0,
    buttons: PointerButtons.create(false, false, false),
    modifiers: Modifiers.create(false, false, false, false),
    timestamp,
  };
}

function createKeyDownAction(key: string, timestamp = nextTimestamp()): Action {
  return {
    type: "key-down",
    key,
    code: key,
    modifiers: Modifiers.create(false, false, false, false),
    repeat: false,
    timestamp,
  };
}

describe("PenTool", () => {
  beforeEach(() => {
    resetTimestamp();
  });

  describe("Tool lifecycle", () => {
    it("should have correct id", () => {
      const tool = new PenTool();
      expect(tool.id).toBe("pen");
    });

    it("should initialize with clean state on enter", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const newState = tool.onEnter(state);

      expect(newState).toEqual(state);
    });

    it("should clean up draft stroke on exit", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      const pointerDown = createPointerDownAction(100, 100);
      state = tool.onAction(state, pointerDown);
      expect(Object.keys(state.doc.shapes).length).toBe(1);

      state = tool.onExit(state);
      expect(Object.keys(state.doc.shapes).length).toBe(0);
    });
  });

  describe("Drawing strokes", () => {
    it("should create stroke on pointer down", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const action = createPointerDownAction(100, 100);
      const newState = tool.onAction(state, action);

      expect(Object.keys(newState.doc.shapes).length).toBe(1);
      const shapeId = Object.keys(newState.doc.shapes)[0];
      const shape = newState.doc.shapes[shapeId];

      expect(shape.type).toBe("stroke");
      if (shape.type === "stroke") {
        expect(shape.props.points.length).toBe(1);
        expect(shape.props.points[0]).toEqual([100, 100]);
      }
    });

    it("should add points on pointer move", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      state = tool.onAction(state, createPointerDownAction(100, 100));

      state = tool.onAction(state, createPointerMoveAction(110, 105));
      state = tool.onAction(state, createPointerMoveAction(120, 110));

      const shapeId = Object.keys(state.doc.shapes)[0];
      const shape = state.doc.shapes[shapeId];

      expect(shape.type).toBe("stroke");
      if (shape.type === "stroke") {
        expect(shape.props.points.length).toBe(3);
      }
    });

    it("coalesces pointer updates within the same frame", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      const downTimestamp = nextTimestamp();
      state = tool.onAction(state, createPointerDownAction(100, 100, downTimestamp));

      state = tool.onAction(state, createPointerMoveAction(110, 110, downTimestamp));
      let shape = state.doc.shapes[Object.keys(state.doc.shapes)[0]];
      if (shape?.type === "stroke") {
        expect(shape.props.points.length).toBe(1);
      }

      state = tool.onAction(state, createPointerMoveAction(120, 120, nextTimestamp()));
      shape = state.doc.shapes[Object.keys(state.doc.shapes)[0]];
      if (shape?.type === "stroke") {
        expect(shape.props.points.length).toBe(3);
      }
    });

    it("flushes pending points on pointer up even without a new frame", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      const downTimestamp = nextTimestamp();
      state = tool.onAction(state, createPointerDownAction(100, 100, downTimestamp));

      state = tool.onAction(state, createPointerMoveAction(110, 110, downTimestamp));

      state = tool.onAction(state, createPointerUpAction(110, 110, downTimestamp));

      const shapeId = Object.keys(state.doc.shapes)[0];
      const shape = state.doc.shapes[shapeId];

      expect(shape?.type).toBe("stroke");
      if (shape?.type === "stroke") {
        expect(shape.props.points.length).toBe(2);
        expect(shape.props.points[1]).toEqual([110, 110]);
      }
    });

    it("should not add point if moved less than minimum distance", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      state = tool.onAction(state, createPointerDownAction(100, 100));

      state = tool.onAction(state, createPointerMoveAction(100.5, 100.5));

      const shapeId = Object.keys(state.doc.shapes)[0];
      const shape = state.doc.shapes[shapeId];

      expect(shape.type).toBe("stroke");
      if (shape.type === "stroke") {
        expect(shape.props.points.length).toBe(1);
      }
    });

    it("should finalize stroke on pointer up", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      state = tool.onAction(state, createPointerDownAction(100, 100));
      state = tool.onAction(state, createPointerMoveAction(150, 150));
      state = tool.onAction(state, createPointerUpAction(150, 150));

      expect(Object.keys(state.doc.shapes).length).toBe(1);
      const shapeId = Object.keys(state.doc.shapes)[0];
      const shape = state.doc.shapes[shapeId];

      expect(shape.type).toBe("stroke");
      if (shape.type === "stroke") {
        expect(shape.props.points.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("should delete stroke if too few points on pointer up", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();
      state = tool.onAction(state, createPointerDownAction(100, 100));
      state = tool.onAction(state, createPointerUpAction(100, 100));
      expect(Object.keys(state.doc.shapes).length).toBe(0);
    });
  });

  describe("Keyboard interactions", () => {
    it("should cancel stroke on Escape key", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      state = tool.onAction(state, createPointerDownAction(100, 100));
      state = tool.onAction(state, createPointerMoveAction(150, 150));

      expect(Object.keys(state.doc.shapes).length).toBe(1);

      state = tool.onAction(state, createKeyDownAction("Escape"));

      expect(Object.keys(state.doc.shapes).length).toBe(0);
      expect(state.ui.selectionIds.length).toBe(0);
    });

    it("should ignore other keys", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();

      state = tool.onAction(state, createPointerDownAction(100, 100));

      const newState = tool.onAction(state, createKeyDownAction("a"));

      expect(newState).toEqual(state);
    });
  });

  describe("Edge cases", () => {
    it("should handle pointer actions without current page", () => {
      const tool = new PenTool();
      const store = new Store();
      const state = store.getState();

      const pointerDown = createPointerDownAction(100, 100);
      const newState = tool.onAction(state, pointerDown);
      expect(Object.keys(newState.doc.shapes).length).toBe(0);
    });

    it("should handle pointer move without drawing", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const state = store.getState();
      const pointerMove = createPointerMoveAction(150, 150);
      const newState = tool.onAction(state, pointerMove);
      expect(newState).toEqual(state);
    });

    it("should select created stroke", () => {
      const tool = new PenTool();
      const store = new Store();
      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { [page.id]: page } },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      let state = store.getState();
      const pointerDown = createPointerDownAction(100, 100);
      state = tool.onAction(state, pointerDown);

      const shapeId = Object.keys(state.doc.shapes)[0];
      expect(state.ui.selectionIds).toEqual([shapeId]);
    });
  });
});
