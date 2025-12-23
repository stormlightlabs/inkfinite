/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";

const actionHandlers: Array<(action: any) => void> = [];
const coreMocks = vi.hoisted(() => ({ sinkEnqueueSpy: vi.fn(), storeInstances: [] as any[] }));
const persistenceMocks = vi.hoisted(() => {
  const state = {
    instance: null as null | {
      sink: { enqueueDocPatch: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> };
      status: {
        get: () => { backend: string; state: string; pendingWrites: number };
        subscribe: () => () => void;
        update: () => void;
      };
      setActiveBoard: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    },
  };
  return {
    state,
    createPersistenceManager: vi.fn(() => {
      state.instance = {
        sink: { enqueueDocPatch: vi.fn(), flush: vi.fn() },
        status: {
          get: () => ({ backend: "indexeddb", state: "saved", pendingWrites: 0 }),
          subscribe: () => () => {},
          update: () => {},
        },
        setActiveBoard: vi.fn(),
        dispose: vi.fn(),
      };
      return state.instance;
    }),
  };
});

vi.mock("$lib/input", () => {
  return {
    createInputAdapter: vi.fn((config) => {
      actionHandlers.push(config.onAction);
      return { dispose: vi.fn() };
    }),
  };
});

vi.mock(
  "$lib/status",
  () => ({
    createPersistenceManager: persistenceMocks.createPersistenceManager,
    createStatusStore: () => ({
      get: () => ({ backend: "indexeddb", state: "saved", pendingWrites: 0 }),
      subscribe: () => () => {},
      update: () => {},
    }),
    createSnapStore: () => ({
      get: () => ({ snapEnabled: false, gridEnabled: true, gridSize: 25 }),
      subscribe: () => () => {},
      update: () => {},
      set: () => {},
    }),
    createBrushStore: () => ({
      get: () => ({ size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true }),
      subscribe: () => () => {},
      update: () => {},
      set: () => {},
    }),
  }),
);

vi.mock("inkfinite-renderer", () => {
  return { createRenderer: vi.fn(() => ({ dispose: vi.fn(), markDirty: vi.fn() })) };
});

const createDoc = () => ({
  pages: { "page:1": { id: "page:1", name: "Page 1", shapeIds: [] } },
  shapes: {},
  bindings: {},
  order: { pageIds: ["page:1"], shapeOrder: { "page:1": [] } },
});

vi.mock("inkfinite-core", async () => {
  const actual = await vi.importActual<typeof import("inkfinite-core")>("inkfinite-core");
  const { sinkEnqueueSpy, storeInstances } = coreMocks;

  class BaseTool {
    constructor(readonly id: string) {}
    onEnter(state: any) {
      return state;
    }
    onExit(state: any) {
      return state;
    }
    onAction(state: any) {
      return state;
    }
    getHandleAtPoint() {
      return null;
    }
    getActiveHandle() {
      return null;
    }
  }

  class MockStore {
    state: any;
    private readonly options?: any;
    private readonly subscribers: Array<(state: any) => void> = [];
    readonly commands: any[] = [];
    private historyState = { undoStack: [] as any[], redoStack: [] as any[] };

    constructor(initialState?: any, options?: any) {
      this.state = initialState
        ?? {
          doc: createDoc(),
          ui: { currentPageId: null, selectionIds: [], toolId: "select" },
          camera: { x: 0, y: 0, zoom: 1 },
        };
      this.options = options;
      storeInstances.push(this);
    }

    getState() {
      return this.state;
    }

    setState(updater: (state: any) => any) {
      this.state = updater(this.state);
      for (const listener of this.subscribers) {
        listener(this.state);
      }
    }

    subscribe(listener: (state: any) => void) {
      this.subscribers.push(listener);
      listener(this.state);
      return () => {};
    }

    executeCommand(command: any) {
      this.commands.push(command);
      const before = this.state;
      const after = command.do(before);
      this.state = after;
      this.historyState.undoStack.push({ command, timestamp: Date.now() });
      this.historyState.redoStack = [];
      this.options?.onHistoryEvent?.({
        op: "do",
        commandId: Date.now(),
        command,
        kind: command.kind,
        beforeState: before,
        afterState: after,
      });
    }

    undo() {
      const entry = this.historyState.undoStack.pop();
      if (!entry) return false;
      this.historyState.redoStack.push(entry);
      return true;
    }

    redo() {
      const entry = this.historyState.redoStack.pop();
      if (!entry) return false;
      this.historyState.undoStack.push(entry);
      return true;
    }

    getHistory() {
      return this.historyState;
    }

    canUndo() {
      return this.historyState.undoStack.length > 0;
    }

    canRedo() {
      return this.historyState.redoStack.length > 0;
    }
  }

  const createWebDocRepo = vi.fn(() => ({
    listBoards: vi.fn(async () => [{ id: "board:1", name: "Board 1", createdAt: 0, updatedAt: 0 }]),
    createBoard: vi.fn(async () => "board:new"),
    openBoard: vi.fn(async () => {}),
    renameBoard: vi.fn(),
    deleteBoard: vi.fn(),
    loadDoc: vi.fn(async () => createDoc()),
    applyDocPatch: vi.fn(),
    exportBoard: vi.fn(async () => ({
      board: { id: "board:1", name: "", createdAt: 0, updatedAt: 0 },
      doc: createDoc(),
      order: { pageIds: [], shapeOrder: {} },
    })),
    importBoard: vi.fn(async () => "board:new"),
  }));

  const routeAction = vi.fn((state: any, action: any) => {
    if (action.type === "pointer-down") {
      const shapeId = `shape:${Date.now()}`;
      const currentPage = state.doc.pages["page:1"];
      return {
        ...state,
        doc: {
          ...state.doc,
          shapes: {
            ...state.doc.shapes,
            [shapeId]: {
              id: shapeId,
              type: "rect",
              pageId: "page:1",
              x: 0,
              y: 0,
              rot: 0,
              props: { w: 10, h: 10, fill: "#000", stroke: "#000", radius: 0 },
            },
          },
          pages: { ...state.doc.pages, "page:1": { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] } },
        },
      };
    }
    return state;
  });

  const EditorState = {
    create: () => ({
      doc: createDoc(),
      ui: { currentPageId: null, selectionIds: [], toolId: "select" },
      camera: { x: 0, y: 0, zoom: 1 },
    }),
    clone: (state: any) => structuredClone(state),
  };

  class SnapshotCommand {
    constructor(
      readonly name: string,
      readonly kind: string,
      private readonly before: any,
      private readonly after: any,
    ) {}
    do() {
      return structuredClone(this.after);
    }
    undo() {
      return structuredClone(this.before);
    }
  }

  return {
    ...actual,
    ArrowTool: class extends BaseTool {
      constructor() {
        super("arrow");
      }
    },
    EllipseTool: class extends BaseTool {
      constructor() {
        super("ellipse");
      }
    },
    LineTool: class extends BaseTool {
      constructor() {
        super("line");
      }
    },
    RectTool: class extends BaseTool {
      constructor() {
        super("rect");
      }
    },
    SelectTool: class extends BaseTool {
      constructor() {
        super("select");
      }
    },
    TextTool: class extends BaseTool {
      constructor() {
        super("text");
      }
    },
    Store: MockStore,
    EditorState,
    SnapshotCommand,
    Camera: {
      pan(camera: { x: number; y: number; zoom: number }, delta: { x: number; y: number }) {
        return { ...camera, x: camera.x - delta.x, y: camera.y - delta.y };
      },
    },
    ShapeRecord: { clone: (shape: any) => ({ ...shape }) },
    createToolMap: (toolList: any[]) => new Map(toolList.map((tool) => [tool.id, tool])),
    routeAction,
    switchTool: (state: any, toolId: string) => ({ ...state, ui: { ...state.ui, toolId } }),
    CursorStore: class {
      updateCursor() {}
      subscribe() {
        return () => {};
      }
      getState() {
        return { cursorWorld: { x: 0, y: 0 }, lastMoveAt: Date.now() };
      }
    },
    createWebDocRepo,
    createPersistenceSink: vi.fn(() => ({ enqueueDocPatch: sinkEnqueueSpy, flush: vi.fn() })),
    buildStatusBarVM: () => ({
      cursorWorld: { x: 0, y: 0 },
      toolId: "select",
      mode: "idle",
      selection: { count: 0 },
      snap: { enabled: false },
      persistence: { backend: "indexeddb", state: "saved" },
    }),
    getSelectedShapes: () => [],
    getShapesOnCurrentPage: () => [],
    shapeBounds: () => ({ min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }),
    diffDoc: vi.fn(() => ({})),
    InkfiniteDB: class {},
    exportToSVG: vi.fn(() => "<svg></svg>"),
    exportViewportToPNG: vi.fn(() => Promise.resolve(new Blob())),
    exportSelectionToPNG: vi.fn(() => Promise.resolve(new Blob())),
    __storeInstances: storeInstances,
    __sinkEnqueueSpy: sinkEnqueueSpy,
  };
});

import * as InkfiniteCore from "inkfinite-core";
import Canvas from "../canvas/Canvas.svelte";
const { sinkEnqueueSpy, storeInstances } = coreMocks;

describe("Canvas history integration", () => {
  beforeEach(() => {
    cleanup();
    actionHandlers.length = 0;
    storeInstances.length = 0;
    sinkEnqueueSpy.mockClear();
  });

  it("wraps pointer actions in SnapshotCommands and enqueues persistence", async () => {
    render(Canvas);

    await vi.waitFor(() => {
      expect(actionHandlers.length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      expect(persistenceMocks.createPersistenceManager).toHaveBeenCalled();
    });
    const handler = actionHandlers.at(-1);
    expect(handler).toBeTypeOf("function");

    handler?.({
      type: "pointer-down",
      screen: { x: 0, y: 0 },
      world: { x: 0, y: 0 },
      button: 0,
      buttons: { left: true, middle: false, right: false },
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      timestamp: Date.now(),
    });

    handler?.({
      type: "pointer-move",
      screen: { x: 10, y: 10 },
      world: { x: 10, y: 10 },
      buttons: { left: true, middle: false, right: false },
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      timestamp: Date.now(),
    });

    handler?.({
      type: "pointer-up",
      screen: { x: 10, y: 10 },
      world: { x: 10, y: 10 },
      button: 0,
      buttons: { left: false, middle: false, right: false },
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      timestamp: Date.now(),
    });

    const stores = (InkfiniteCore as any).__storeInstances as Array<{ commands: any[] }>;
    expect(stores.at(-1)?.commands).toHaveLength(1);
    expect(stores.at(-1)?.commands[0].kind).toBe("doc");
    expect(sinkEnqueueSpy).toHaveBeenCalledTimes(1);
  });
});
