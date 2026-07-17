import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, type EditorState } from "inkfinite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer } from "../src";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readRenderingFixture() {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, "fixtures/v1/rendering/all-shapes.json"), "utf8"),
  ) as { state: EditorState; expected: { shapeTypes: string[]; orderedShapeIds: string[] } };
}

describe("v1 rendering baseline", () => {
  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D;
  let scheduledFrames: FrameRequestCallback[];

  beforeEach(() => {
    canvas = document.createElement("canvas");
    scheduledFrames = [];
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
      measureText: vi.fn((text: string) => ({ width: text.length * 8 }) as TextMetrics),
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
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, "getContext").mockReturnValue(context);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it("draws the complete frozen fixture in persisted order", () => {
    const fixture = readRenderingFixture();
    const store = new Store(fixture.state);
    const renderer = createRenderer(canvas, store, {
      snapProvider: { get: () => ({ snapEnabled: false, gridEnabled: false, gridSize: 25 }) },
    });

    const frame = scheduledFrames.shift();
    expect(frame).toBeDefined();
    frame?.(0);

    const shapeTranslations = vi.mocked(context.translate).mock.calls
      .slice(2)
      .map(([x, y]) => [x, y]);
    const expectedTranslations = fixture.expected.orderedShapeIds.map((id) => {
      const shape = fixture.state.doc.shapes[id];
      return [shape.x, shape.y];
    });
    expect(shapeTranslations.slice(0, expectedTranslations.length)).toEqual(expectedTranslations);
    expect(new Set(Object.values(fixture.state.doc.shapes).map((shape) => shape.type))).toEqual(
      new Set(fixture.expected.shapeTypes),
    );
    expect(context.rect).toHaveBeenCalled();
    expect(context.ellipse).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
    expect(context.fillText).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();

    renderer.dispose();
  });
});
