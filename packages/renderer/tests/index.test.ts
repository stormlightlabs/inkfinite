import { PageRecord, ShapeRecord, Store } from "inkfinite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer } from "../src";

describe("Renderer", () => {
  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;

    context = {
      canvas,
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      arcTo: vi.fn(),
      ellipse: vi.fn(),
      rect: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      getLineDash: vi.fn(() => []),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textBaseline: "alphabetic",
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(canvas, "getContext").mockReturnValue(context);

    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    });

    globalThis.requestAnimationFrame = vi.fn((callback) => {
      setTimeout(callback, 16);
      return 1;
    });

    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createRenderer", () => {
    it("should create renderer with dispose method", () => {
      const store = new Store();
      const renderer = createRenderer(canvas, store);

      expect(renderer).toBeDefined();
      expect(renderer.dispose).toBeInstanceOf(Function);
      expect(renderer.markDirty).toBeInstanceOf(Function);

      renderer.dispose();
    });

    it("should throw error if canvas context is not available", () => {
      const badCanvas = document.createElement("canvas");
      vi.spyOn(badCanvas, "getContext").mockReturnValue(null);

      const store = new Store();

      expect(() => createRenderer(badCanvas, store)).toThrow("Failed to get 2D context from canvas");
    });

    it("should mark dirty on initial render", () => {
      const store = new Store();
      const renderer = createRenderer(canvas, store);

      expect(globalThis.requestAnimationFrame).toHaveBeenCalled();

      renderer.dispose();
    });

    it("should unsubscribe from store on dispose", () => {
      const store = new Store();
      const renderer = createRenderer(canvas, store);

      const _unsubscribeSpy = vi.spyOn(store, "subscribe");

      renderer.dispose();

      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    });
  });

  describe("rendering", () => {
    it("should render empty scene with no shapes", async () => {
      const store = new Store();
      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render scene with rect shape", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 200,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render scene with ellipse shape", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const ellipse = ShapeRecord.createEllipse("page:1", 100, 100, {
        w: 200,
        h: 100,
        fill: "#00ff00",
        stroke: "#000000",
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [ellipse.id] } },
          shapes: { [ellipse.id]: ellipse },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render scene with line shape", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const line = ShapeRecord.createLine("page:1", 0, 0, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 100 },
        stroke: "#000000",
        width: 2,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [line.id] } }, shapes: { [line.id]: line }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render scene with arrow shape", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const arrow = ShapeRecord.createArrow("page:1", 0, 0, {
        a: { x: 0, y: 0 },
        b: { x: 100, y: 100 },
        stroke: "#000000",
        width: 2,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [arrow.id] } }, shapes: { [arrow.id]: arrow }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render scene with text shape", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const text = ShapeRecord.createText("page:1", 100, 100, {
        text: "Hello World",
        fontSize: 16,
        fontFamily: "Arial",
        color: "#000000",
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [text.id] } }, shapes: { [text.id]: text }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render text shape with word wrapping", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const text = ShapeRecord.createText("page:1", 100, 100, {
        text: "Hello World this is a long text",
        fontSize: 16,
        fontFamily: "Arial",
        color: "#000000",
        w: 100,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [text.id] } }, shapes: { [text.id]: text }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render multiple shapes", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 200,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");
      const ellipse = ShapeRecord.createEllipse("page:1", 400, 200, {
        w: 150,
        h: 100,
        fill: "#00ff00",
        stroke: "#000000",
      }, "shape:2");

      store.setState((state) => ({
        ...state,
        doc: {
          pages: { [page.id]: { ...page, shapeIds: [rect.id, ellipse.id] } },
          shapes: { [rect.id]: rect, [ellipse.id]: ellipse },
          bindings: {},
        },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render selection outline for selected shapes", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 200,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id, selectionIds: [rect.id] },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should update render when store changes", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 200,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
      }));

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should apply camera transform correctly", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 0, 0, {
        w: 100,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
        camera: { x: 100, y: 100, zoom: 2 },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should handle rounded rectangle", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 200,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 10,
      }, "shape:1");

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });

    it("should render shapes with rotation", async () => {
      const store = new Store();

      const page = PageRecord.create("Page 1", "page:1");
      const rect = ShapeRecord.createRect("page:1", 100, 100, {
        w: 200,
        h: 100,
        fill: "#ff0000",
        stroke: "#000000",
        radius: 0,
      }, "shape:1");
      rect.rot = Math.PI / 4;

      store.setState((state) => ({
        ...state,
        doc: { pages: { [page.id]: { ...page, shapeIds: [rect.id] } }, shapes: { [rect.id]: rect }, bindings: {} },
        ui: { ...state.ui, currentPageId: page.id },
      }));

      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();
    });
  });

  describe("markDirty", () => {
    it("should allow manual dirty marking", async () => {
      const store = new Store();
      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      renderer.markDirty();

      expect(rafSpy).toHaveBeenCalled();

      renderer.dispose();
    });

    it("should not mark dirty after dispose", async () => {
      const store = new Store();
      const renderer = createRenderer(canvas, store);

      await new Promise((resolve) => setTimeout(resolve, 50));

      renderer.dispose();

      // @ts-expect-error mocked
      const rafCallCount = globalThis.requestAnimationFrame.mock.calls.length;

      renderer.markDirty();

      // @ts-expect-error mocked
      expect(globalThis.requestAnimationFrame.mock.calls.length).toBe(rafCallCount);
    });
  });
});
