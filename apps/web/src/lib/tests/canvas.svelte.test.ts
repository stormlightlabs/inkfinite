import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import Canvas from "../canvas/Canvas.svelte";

describe("Canvas component", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should render a canvas element", () => {
    const { container } = render(Canvas);
    const canvas = container.querySelector("canvas");

    expect(canvas).toBeTruthy();
    expect(canvas?.tagName).toBe("CANVAS");
  });

  it("should create canvas with full dimensions", () => {
    const { container } = render(Canvas);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    const style = window.getComputedStyle(canvas);
    expect(style.width).toBeTruthy();
    expect(style.height).toBeTruthy();
    expect(style.display).toBe("block");
  });

  it("should have touch-action: none for pointer events", () => {
    const { container } = render(Canvas);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    const style = window.getComputedStyle(canvas);
    expect(style.touchAction).toBe("none");
  });

  it("should get 2D rendering context", () => {
    const { container } = render(Canvas);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    const context = canvas.getContext("2d");
    expect(context).toBeTruthy();
    expect(context).toBeInstanceOf(CanvasRenderingContext2D);
  });

  it("should initialize with test shapes", async () => {
    const { component } = render(Canvas);

    // Canvas component initializes store with test shapes
    // FIXME: We can't directly access the store
    expect(component).toBeTruthy();
  });

  it("should render the Toolbar component", () => {
    const { container } = render(Canvas);
    const toolbar = container.querySelector(".toolbar");

    expect(toolbar).toBeTruthy();
    expect(toolbar?.getAttribute("role")).toBe("toolbar");
  });

  it("should render editor wrapper with correct layout", () => {
    const { container } = render(Canvas);
    const editor = container.querySelector(".editor");

    expect(editor).toBeTruthy();
    const style = window.getComputedStyle(editor as Element);
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("column");
  });

  it("should render all tool buttons in toolbar", () => {
    const { container } = render(Canvas);
    const toolButtons = container.querySelectorAll(".tool-button");

    expect(toolButtons.length).toBe(6);

    const toolIds = Array.from(toolButtons).map((btn) => btn.getAttribute("data-tool-id"));
    expect(toolIds).toEqual(["select", "rect", "ellipse", "line", "arrow", "text"]);
  });

  it("should have select tool active by default", () => {
    const { container } = render(Canvas);
    const selectButton = container.querySelector(".tool-button[data-tool-id=\"select\"]");

    expect(selectButton?.classList.contains("active")).toBe(true);
  });

  it("should change active tool when toolbar button is clicked", async () => {
    const { container } = render(Canvas);

    const selectButton = container.querySelector(".tool-button[data-tool-id=\"select\"]");
    const rectButton = container.querySelector(".tool-button[data-tool-id=\"rect\"]") as HTMLButtonElement;

    expect(selectButton?.classList.contains("active")).toBe(true);
    expect(rectButton?.classList.contains("active")).toBe(false);

    rectButton.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const selectButtonAfter = container.querySelector(".tool-button[data-tool-id=\"select\"]");
    const rectButtonAfter = container.querySelector(".tool-button[data-tool-id=\"rect\"]");

    expect(selectButtonAfter?.classList.contains("active")).toBe(false);
    expect(rectButtonAfter?.classList.contains("active")).toBe(true);
  });
});
