import type { ToolId } from "inkfinite-core";
import { Store } from "inkfinite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import Toolbar from "../../components/Toolbar.svelte";
import { createBrushStore } from "../../status";

const createMockStore = () => new Store();
const createMockGetViewport = () => () => ({ width: 1024, height: 768 });

describe("Toolbar component", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should render all tool buttons", () => {
    const onToolChange = vi.fn();
    const store = createMockStore();
    const getViewport = createMockGetViewport();
    const brushStore = createBrushStore();
    const { container } = render(Toolbar, { currentTool: "select", onToolChange, store, getViewport, brushStore });

    const buttons = container.querySelectorAll(".tool-button");
    expect(buttons.length).toBe(7);

    const toolIds = Array.from(buttons).map((btn) => btn.getAttribute("data-tool-id"));
    expect(toolIds).toEqual(["select", "rect", "ellipse", "line", "arrow", "text", "pen"]);
  });

  it("should mark the current tool as active", () => {
    const onToolChange = vi.fn();
    const store = createMockStore();
    const getViewport = createMockGetViewport();
    const brushStore = createBrushStore();
    const { container } = render(Toolbar, { currentTool: "rect", onToolChange, store, getViewport, brushStore });

    const activeButton = container.querySelector(".tool-button[data-tool-id=\"rect\"]");
    expect(activeButton?.classList.contains("active")).toBe(true);
    expect(activeButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("should call onToolChange when a tool button is clicked", async () => {
    const onToolChange = vi.fn();
    const store = createMockStore();
    const getViewport = createMockGetViewport();
    const brushStore = createBrushStore();
    const { container } = render(Toolbar, { currentTool: "select", onToolChange, store, getViewport, brushStore });

    const ellipseButton = container.querySelector(".tool-button[data-tool-id=\"ellipse\"]") as HTMLButtonElement;
    expect(ellipseButton).toBeTruthy();

    ellipseButton.click();

    expect(onToolChange).toHaveBeenCalledTimes(1);
    expect(onToolChange).toHaveBeenCalledWith("ellipse");
  });

  it.each([
    { toolId: "select" as ToolId, label: "Select" },
    { toolId: "rect" as ToolId, label: "Rectangle" },
    { toolId: "ellipse" as ToolId, label: "Ellipse" },
    { toolId: "line" as ToolId, label: "Line" },
    { toolId: "arrow" as ToolId, label: "Arrow" },
    { toolId: "text" as ToolId, label: "Text" },
    { toolId: "pen" as ToolId, label: "Pen" },
  ])("should have correct aria-label for $toolId tool", ({ toolId, label }) => {
    const onToolChange = vi.fn();
    const store = createMockStore();
    const getViewport = createMockGetViewport();
    const brushStore = createBrushStore();
    const { container } = render(Toolbar, { currentTool: "select", onToolChange, store, getViewport, brushStore });

    const button = container.querySelector(`.tool-button[data-tool-id="${toolId}"]`);
    expect(button?.getAttribute("aria-label")).toBe(label);
  });

  it("should update active state when currentTool prop changes", async () => {
    const onToolChange = vi.fn();
    const store = createMockStore();
    const getViewport = createMockGetViewport();
    const brushStore = createBrushStore();
    const { container, rerender } = render(Toolbar, {
      currentTool: "select",
      onToolChange,
      store,
      getViewport,
      brushStore,
    });

    let selectButton = container.querySelector(".tool-button[data-tool-id=\"select\"]");
    let rectButton = container.querySelector(".tool-button[data-tool-id=\"rect\"]");

    expect(selectButton?.classList.contains("active")).toBe(true);
    expect(rectButton?.classList.contains("active")).toBe(false);

    await rerender({ currentTool: "rect", onToolChange, store, getViewport, brushStore });

    selectButton = container.querySelector(".tool-button[data-tool-id=\"select\"]");
    rectButton = container.querySelector(".tool-button[data-tool-id=\"rect\"]");

    expect(selectButton?.classList.contains("active")).toBe(false);
    expect(rectButton?.classList.contains("active")).toBe(true);
  });

  it("should have proper accessibility attributes", () => {
    const onToolChange = vi.fn();
    const store = createMockStore();
    const getViewport = createMockGetViewport();
    const brushStore = createBrushStore();
    const { container } = render(Toolbar, { currentTool: "select", onToolChange, store, getViewport, brushStore });

    const toolbar = container.querySelector(".toolbar");
    expect(toolbar?.getAttribute("role")).toBe("toolbar");
    expect(toolbar?.getAttribute("aria-label")).toBe("Drawing tools");
  });
});
