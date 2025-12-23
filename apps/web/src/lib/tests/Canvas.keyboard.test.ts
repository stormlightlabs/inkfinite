import type { Action, Command, Store } from "inkfinite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";

const actionHandlers: Array<(action: Action) => void> = [];
const coreMocks = vi.hoisted(() => ({ storeInstances: [] as Store[], executeCommandSpy: vi.fn() }));

async function selectShapeAt(handler: (action: Action) => void, position: { x: number; y: number }) {
  const timestamp = Date.now();
  handler({
    type: "pointer-down",
    button: 0,
    buttons: { left: true, middle: false, right: false },
    world: position,
    screen: position,
    modifiers: { ctrl: false, shift: false, alt: false, meta: false },
    timestamp,
  });
  handler({
    type: "pointer-up",
    button: 0,
    buttons: { left: false, middle: false, right: false },
    world: position,
    screen: position,
    modifiers: { ctrl: false, shift: false, alt: false, meta: false },
    timestamp: timestamp + 16,
  });
  await Promise.resolve();
}

async function selectDefaultShape(handler: (action: Action) => void) {
  await selectShapeAt(handler, { x: 110, y: 110 });
}

async function selectSecondaryShape(handler: (action: Action) => void) {
  await selectShapeAt(handler, { x: 210, y: 210 });
}

async function waitForDocumentReady() {
  await vi.waitFor(() => {
    const store = coreMocks.storeInstances.at(-1);
    expect(store).toBeTruthy();
    const pages = Object.keys(store!.getState().doc.pages);
    expect(pages.length).toBeGreaterThan(0);
  });
}

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
    createPersistenceManager: () => ({
      sink: { enqueueDocPatch: vi.fn(), flush: vi.fn() },
      status: {
        get: () => ({ backend: "indexeddb", state: "saved", pendingWrites: 0 }),
        subscribe: () => () => {},
        update: () => {},
      },
      setActiveBoard: vi.fn(),
      dispose: vi.fn(),
    }),
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
      get: () => ({
        size: 16,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: true,
        color: "#88c0d0",
      }),
      subscribe: () => () => {},
      update: () => {},
      set: () => {},
    }),
  }),
);

vi.mock("inkfinite-renderer", () => {
  return { createRenderer: vi.fn(() => ({ dispose: vi.fn(), markDirty: vi.fn() })) };
});

vi.mock("inkfinite-core", async () => {
  const actual = await vi.importActual<typeof import("inkfinite-core")>("inkfinite-core");
  const { executeCommandSpy } = coreMocks;

  class MockStore extends actual.Store {
    constructor(...args: ConstructorParameters<typeof actual.Store>) {
      super(...args);
      coreMocks.storeInstances.push(this as unknown as Store);
    }

    executeCommand(command: unknown) {
      executeCommandSpy(command);
      return super.executeCommand(command as Command);
    }
  }

  class MockInkfiniteDB {
    boards = { toArray: async () => [], add: async () => "board-1" };
    boardDocuments = { get: async () => null, put: async () => {} };
  }

  return {
    ...actual,
    Store: MockStore,
    InkfiniteDB: MockInkfiniteDB,
    createWebDocRepo: vi.fn(() => ({
      listBoards: async () => [{ id: "board-1", name: "Test Board", createdAt: 0, updatedAt: 0 }],
      createBoard: async () => "board-1",
      openBoard: async () => {},
      renameBoard: async () => {},
      deleteBoard: async () => {},
      loadDoc: async () => ({
        pages: { "page:1": { id: "page:1", name: "Page 1", shapeIds: ["shape:1", "shape:2"] } },
        shapes: {
          "shape:1": {
            id: "shape:1",
            type: "rect",
            pageId: "page:1",
            x: 100,
            y: 100,
            rot: 0,
            props: { w: 50, h: 50, fill: "#ff0000", stroke: "#000000", radius: 0 },
          },
          "shape:2": {
            id: "shape:2",
            type: "ellipse",
            pageId: "page:1",
            x: 200,
            y: 200,
            rot: 0,
            props: { w: 40, h: 40, fill: "#00ff00", stroke: "#000000" },
          },
        },
        bindings: {},
        order: { pageIds: ["page:1"] },
      }),
      applyDocPatch: async () => {},
      exportBoard: async () => ({
        board: { id: "board-1", name: "Test Board", createdAt: 0, updatedAt: 0 },
        doc: { pages: {}, shapes: {}, bindings: {} },
        order: { pageIds: [], shapeOrder: {} },
      }),
      importBoard: async () => "board-1",
    })),
  };
});

import Canvas from "../canvas/Canvas.svelte";

describe("Canvas keyboard shortcuts", () => {
  beforeEach(() => {
    cleanup();
    actionHandlers.length = 0;
    coreMocks.executeCommandSpy.mockClear();
  });

  it("should handle space key for panning mode", async () => {
    render(Canvas);
    await vi.waitFor(() => expect(actionHandlers.length).toBeGreaterThan(0));
    coreMocks.executeCommandSpy.mockClear();

    const handler = actionHandlers[0];

    handler({
      type: "key-down",
      key: " ",
      code: "Space",
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      repeat: false,
      timestamp: Date.now(),
    });

    expect(coreMocks.executeCommandSpy).not.toHaveBeenCalled();

    handler({
      type: "key-up",
      key: " ",
      code: "Space",
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      timestamp: Date.now(),
    });

    expect(coreMocks.executeCommandSpy).not.toHaveBeenCalled();
  });

  it("should nudge selected shapes with arrow keys", async () => {
    render(Canvas);
    await vi.waitFor(() => expect(actionHandlers.length).toBeGreaterThan(0));
    await waitForDocumentReady();

    const handler = actionHandlers[0];
    await selectDefaultShape(handler);

    coreMocks.executeCommandSpy.mockClear();

    handler({
      type: "key-down",
      key: "ArrowRight",
      code: "ArrowRight",
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      repeat: false,
      timestamp: Date.now(),
    });

    await vi.waitFor(() => {
      const calls = coreMocks.executeCommandSpy.mock.calls;
      const nudgeCalls = calls.filter((call) => call[0]?.name === "Nudge");
      expect(nudgeCalls.length).toBeGreaterThan(0);
    });
  });

  it("should nudge by 10px with shift modifier", async () => {
    render(Canvas);
    await vi.waitFor(() => expect(actionHandlers.length).toBeGreaterThan(0));
    await waitForDocumentReady();

    const handler = actionHandlers[0];
    await selectDefaultShape(handler);
    coreMocks.executeCommandSpy.mockClear();

    handler({
      type: "key-down",
      key: "ArrowDown",
      code: "ArrowDown",
      modifiers: { ctrl: false, shift: true, alt: false, meta: false },
      repeat: false,
      timestamp: Date.now(),
    });

    await vi.waitFor(() => {
      const calls = coreMocks.executeCommandSpy.mock.calls;
      const nudgeCalls = calls.filter((call) => call[0]?.name === "Nudge");
      expect(nudgeCalls.length).toBeGreaterThan(0);
    });
  });

  it("should duplicate selected shapes with Cmd/Ctrl+D", async () => {
    render(Canvas);
    await vi.waitFor(() => expect(actionHandlers.length).toBeGreaterThan(0));
    await waitForDocumentReady();

    const handler = actionHandlers[0];
    await selectDefaultShape(handler);
    coreMocks.executeCommandSpy.mockClear();

    const isMac = navigator.userAgent.toUpperCase().includes("MAC");
    handler({
      type: "key-down",
      key: "d",
      code: "KeyD",
      modifiers: { ctrl: !isMac, shift: false, alt: false, meta: isMac },
      repeat: false,
      timestamp: Date.now(),
    });

    await vi.waitFor(() => {
      const calls = coreMocks.executeCommandSpy.mock.calls;
      const duplicateCalls = calls.filter((call) => call[0]?.name === "Duplicate");
      expect(duplicateCalls.length).toBeGreaterThan(0);
    });
  });

  it("should bring shapes forward with Cmd/Ctrl+]", async () => {
    render(Canvas);
    await vi.waitFor(() => expect(actionHandlers.length).toBeGreaterThan(0));
    await waitForDocumentReady();

    const handler = actionHandlers[0];
    await selectDefaultShape(handler);
    coreMocks.executeCommandSpy.mockClear();

    const isMac = navigator.userAgent.toUpperCase().includes("MAC");
    handler({
      type: "key-down",
      key: "]",
      code: "BracketRight",
      modifiers: { ctrl: !isMac, shift: false, alt: false, meta: isMac },
      repeat: false,
      timestamp: Date.now(),
    });

    await vi.waitFor(() => {
      const calls = coreMocks.executeCommandSpy.mock.calls;
      const bringForwardCalls = calls.filter((call) => call[0]?.name === "Bring Forward");
      expect(bringForwardCalls.length).toBeGreaterThan(0);
    });
  });

  it("should send shapes backward with Cmd/Ctrl+[", async () => {
    render(Canvas);
    await vi.waitFor(() => expect(actionHandlers.length).toBeGreaterThan(0));
    await waitForDocumentReady();

    const handler = actionHandlers[0];
    await selectSecondaryShape(handler);
    coreMocks.executeCommandSpy.mockClear();

    const isMac = navigator.userAgent.toUpperCase().includes("MAC");
    handler({
      type: "key-down",
      key: "[",
      code: "BracketLeft",
      modifiers: { ctrl: !isMac, shift: false, alt: false, meta: isMac },
      repeat: false,
      timestamp: Date.now(),
    });

    await vi.waitFor(() => {
      const calls = coreMocks.executeCommandSpy.mock.calls;
      const sendBackwardCalls = calls.filter((call) => call[0]?.name === "Send Backward");
      expect(sendBackwardCalls.length).toBeGreaterThan(0);
    });
  });

  it("should not process tool actions while space is held", async () => {
    render(Canvas);
    await vi.waitFor(() => expect(actionHandlers.length).toBeGreaterThan(0));
    await waitForDocumentReady();

    const handler = actionHandlers[0];
    await selectDefaultShape(handler);
    coreMocks.executeCommandSpy.mockClear();

    handler({
      type: "key-down",
      key: " ",
      code: "Space",
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      repeat: false,
      timestamp: Date.now(),
    });

    handler({
      type: "key-down",
      key: "ArrowRight",
      code: "ArrowRight",
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
      repeat: false,
      timestamp: Date.now(),
    });

    expect(coreMocks.executeCommandSpy).not.toHaveBeenCalled();
  });
});
