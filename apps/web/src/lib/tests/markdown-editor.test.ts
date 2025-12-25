import { EditorState, PageRecord, ShapeRecord, Store } from "inkfinite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditorController } from "../canvas/controllers/markdown-controller.svelte";

describe("MarkdownEditorController", () => {
  let store: Store;
  let controller: MarkdownEditorController;
  const mockRefreshCursor = vi.fn();
  const mockGetViewport = () => ({ width: 1024, height: 768 });

  beforeEach(() => {
    store = new Store();
    mockRefreshCursor.mockClear();
    controller = new MarkdownEditorController(store, mockGetViewport, mockRefreshCursor);
  });

  describe("start", () => {
    it("should start editing a markdown shape", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Hello World",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
        ui: { ...state.ui, currentPageId: "page1" },
      }));

      controller.start("shape1");

      expect(controller.isEditing).toBe(true);
      expect(controller.current).toEqual({ shapeId: "shape1", value: "# Hello World" });
      expect(mockRefreshCursor).toHaveBeenCalled();
    });

    it("should not start editing if shape is not markdown", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createRect("page1", 100, 200, {
        w: 100,
        h: 50,
        fill: "#fff",
        stroke: "#000",
        radius: 0,
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
      }));

      controller.start("shape1");

      expect(controller.isEditing).toBe(false);
      expect(controller.current).toBeNull();
    });

    it("should not start editing if shape does not exist", () => {
      controller.start("nonexistent");

      expect(controller.isEditing).toBe(false);
      expect(controller.current).toBeNull();
    });
  });

  describe("getLayout", () => {
    it("should return null when not editing", () => {
      expect(controller.getLayout()).toBeNull();
    });

    it("should compute layout when editing", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Test",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
        ui: { ...state.ui, currentPageId: "page1" },
        camera: { ...state.camera, x: 0, y: 0, zoom: 1 },
      }));

      controller.start("shape1");
      const layout = controller.getLayout();

      expect(layout).toBeTruthy();
      expect(layout?.width).toBe(300);
      expect(layout?.height).toBe(200);
      expect(layout?.fontSize).toBe(16);
    });

    it("should handle auto-computed height", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Test",
        w: 300,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
      }));

      controller.start("shape1");
      const layout = controller.getLayout();

      expect(layout).toBeTruthy();
      expect(layout?.height).toBe(160);
    });
  });

  describe("handleInput", () => {
    it("should update current value on input", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Hello",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
      }));

      controller.start("shape1");

      const mockEvent = { currentTarget: { value: "# Hello World" } as HTMLTextAreaElement } as unknown as Event;

      controller.handleInput(mockEvent);

      expect(controller.current?.value).toBe("# Hello World");
    });

    it("should do nothing if not editing", () => {
      const mockEvent = { currentTarget: { value: "test" } as HTMLTextAreaElement } as unknown as Event;

      controller.handleInput(mockEvent);

      expect(controller.current).toBeNull();
    });
  });

  describe("handleKeyDown", () => {
    beforeEach(() => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Test",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
      }));

      controller.start("shape1");
    });

    it("should insert spaces on Tab key", () => {
      const mockTextarea = { selectionStart: 6, selectionEnd: 6, value: "# Test" } as HTMLTextAreaElement;

      const mockEvent = {
        key: "Tab",
        preventDefault: vi.fn(),
        currentTarget: mockTextarea,
      } as unknown as KeyboardEvent;

      controller.handleKeyDown(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(controller.current?.value).toBe("# Test  ");
    });

    it("should replace selection with spaces on Tab", () => {
      controller.current!.value = "# Test Content";

      const mockTextarea = { selectionStart: 2, selectionEnd: 6, value: "# Test Content" } as HTMLTextAreaElement;

      const mockEvent = {
        key: "Tab",
        preventDefault: vi.fn(),
        currentTarget: mockTextarea,
      } as unknown as KeyboardEvent;

      controller.handleKeyDown(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(controller.current?.value).toBe("#    Content");
    });

    it("should cancel on Escape key", () => {
      const mockEvent = { key: "Escape", preventDefault: vi.fn() } as unknown as KeyboardEvent;

      controller.handleKeyDown(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(controller.isEditing).toBe(false);
      expect(mockRefreshCursor).toHaveBeenCalled();
    });

    it("should commit on Cmd+Enter", () => {
      controller.current!.value = "# Updated";

      const mockEvent = {
        key: "Enter",
        metaKey: true,
        ctrlKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      controller.handleKeyDown(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(controller.isEditing).toBe(false);

      const updatedShape = store.getState().doc.shapes["shape1"];
      expect(updatedShape).toBeTruthy();
      if (updatedShape?.type === "markdown") {
        expect(updatedShape.props.md).toBe("# Updated");
      }
    });

    it("should commit on Ctrl+Enter", () => {
      controller.current!.value = "# Updated";

      const mockEvent = {
        key: "Enter",
        metaKey: false,
        ctrlKey: true,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      controller.handleKeyDown(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(controller.isEditing).toBe(false);

      const updatedShape = store.getState().doc.shapes["shape1"];
      if (updatedShape?.type === "markdown") {
        expect(updatedShape.props.md).toBe("# Updated");
      }
    });
  });

  describe("commit", () => {
    it("should update markdown content and create history entry", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Original",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
      }));

      controller.start("shape1");
      controller.current!.value = "# Updated Content";
      controller.commit();

      expect(controller.isEditing).toBe(false);
      expect(mockRefreshCursor).toHaveBeenCalled();

      const updatedShape = store.getState().doc.shapes["shape1"];
      expect(updatedShape).toBeTruthy();
      if (updatedShape?.type === "markdown") {
        expect(updatedShape.props.md).toBe("# Updated Content");
      }
    });

    it("should not update if value is unchanged", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Original",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      const initialState = EditorState.create();
      initialState.doc = { ...initialState.doc, pages: { page1: page }, shapes: { shape1: shape } };
      store.setState(() => initialState);

      controller.start("shape1");
      controller.commit();

      const finalState = store.getState();
      expect(finalState).toEqual(initialState);
    });

    it("should do nothing if not editing", () => {
      const initialState = store.getState();
      controller.commit();
      expect(store.getState()).toBe(initialState);
    });
  });

  describe("cancel", () => {
    it("should stop editing without saving", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Original",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
      }));

      controller.start("shape1");
      controller.current!.value = "# Modified";
      controller.cancel();

      expect(controller.isEditing).toBe(false);
      expect(mockRefreshCursor).toHaveBeenCalled();

      const originalShape = store.getState().doc.shapes["shape1"];
      if (originalShape?.type === "markdown") {
        expect(originalShape.props.md).toBe("# Original");
      }
    });
  });

  describe("handleBlur", () => {
    it("should commit on blur", () => {
      const page = PageRecord.create("Test Page", "page1");
      const shape = ShapeRecord.createMarkdown("page1", 100, 200, {
        md: "# Original",
        w: 300,
        h: 200,
        fontSize: 16,
        fontFamily: "sans-serif",
        color: "#000",
      }, "shape1");

      page.shapeIds = ["shape1"];
      store.setState((state) => ({
        ...state,
        doc: { ...state.doc, pages: { page1: page }, shapes: { shape1: shape } },
      }));

      controller.start("shape1");
      controller.current!.value = "# Updated on Blur";
      controller.handleBlur();

      expect(controller.isEditing).toBe(false);

      const updatedShape = store.getState().doc.shapes["shape1"];
      if (updatedShape?.type === "markdown") {
        expect(updatedShape.props.md).toBe("# Updated on Blur");
      }
    });
  });
});
