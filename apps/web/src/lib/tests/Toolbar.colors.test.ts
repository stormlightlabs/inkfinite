import { EditorState, ShapeRecord, Store } from "inkfinite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import Toolbar from "../components/Toolbar.svelte";
import { createBrushStore } from "../status";

function createStoreWithRect() {
  const store = new Store();
  const base = EditorState.create();
  const pageId = "page:rect";
  const rect = ShapeRecord.createRect(
    pageId,
    0,
    0,
    { w: 100, h: 50, fill: "#4a90e2", stroke: "#2e5c8a", radius: 4 },
    "shape:rect",
  );
  store.setState(() => ({
    doc: {
      pages: { [pageId]: { id: pageId, name: "Page", shapeIds: [rect.id] } },
      shapes: { [rect.id]: rect },
      bindings: {},
    },
    ui: { currentPageId: pageId, selectionIds: [rect.id], toolId: "select" },
    camera: base.camera,
  }));
  return store;
}

function createStoreWithLine() {
  const store = new Store();
  const base = EditorState.create();
  const pageId = "page:line";
  const line = ShapeRecord.createLine(pageId, 0, 0, {
    a: { x: 0, y: 0 },
    b: { x: 50, y: 0 },
    stroke: "#495057",
    width: 2,
  }, "shape:line");
  store.setState(() => ({
    doc: {
      pages: { [pageId]: { id: pageId, name: "Page", shapeIds: [line.id] } },
      shapes: { [line.id]: line },
      bindings: {},
    },
    ui: { currentPageId: pageId, selectionIds: [line.id], toolId: "select" },
    camera: base.camera,
  }));
  return store;
}

describe("Toolbar color controls", () => {
  beforeEach(() => {
    cleanup();
  });

  function renderToolbar(store: Store) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const brushStore = createBrushStore();
    return render(Toolbar, {
      target,
      props: {
        currentTool: "select",
        onToolChange: () => {},
        store,
        getViewport: () => ({ width: 800, height: 600 }),
        brushStore,
      },
    });
  }

  it("updates fill color for selected shapes", () => {
    const store = createStoreWithRect();
    const { container } = renderToolbar(store);

    const input = container.querySelector("input[aria-label=\"Fill color\"]") as HTMLInputElement | null;
    expect(input).toBeTruthy();
    if (!input) return;
    input.value = "#ff3366";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const updated = store.getState().doc.shapes["shape:rect"];
    expect(updated?.type).toBe("rect");
    if (updated?.type !== "rect") {
      throw new Error("Expected rect shape");
    }
    expect(updated.props.fill).toBe("#ff3366");
  });

  it("updates stroke color for selectable shapes", () => {
    const store = createStoreWithRect();
    const { container } = renderToolbar(store);

    const input = container.querySelector("input[aria-label=\"Stroke color\"]") as HTMLInputElement | null;
    expect(input).toBeTruthy();
    if (!input) return;
    input.value = "#222299";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const updated = store.getState().doc.shapes["shape:rect"];
    expect(updated?.type).toBe("rect");
    if (updated?.type !== "rect") {
      throw new Error("Expected rect shape");
    }
    expect(updated.props.stroke).toBe("#222299");
  });

  it("disables fill control when selection has no fillable shapes", () => {
    const store = createStoreWithLine();
    const { container } = renderToolbar(store);

    const fillInput = container.querySelector("input[aria-label=\"Fill color\"]") as HTMLInputElement | null;
    const strokeInput = container.querySelector("input[aria-label=\"Stroke color\"]") as HTMLInputElement | null;
    expect(fillInput).toBeTruthy();
    expect(strokeInput).toBeTruthy();
    if (!fillInput || !strokeInput) return;

    expect(fillInput.disabled).toBe(true);
    expect(strokeInput.disabled).toBe(false);
  });
});
