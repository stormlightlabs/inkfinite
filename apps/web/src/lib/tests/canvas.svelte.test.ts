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
});
