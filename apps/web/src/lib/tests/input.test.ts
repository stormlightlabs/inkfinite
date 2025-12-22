import { Action, type Action as ActionType, Camera, Modifiers, PointerButtons } from "inkfinite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInputAdapter, InputAdapter, type PointerState } from "../input";

/**
 * Create a mock canvas element with getBoundingClientRect
 */
function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;

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

  return canvas;
}

/**
 * Create a mock pointer event
 */
function createPointerEvent(
  type: string,
  options: {
    clientX?: number;
    clientY?: number;
    button?: number;
    buttons?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {},
): PointerEvent {
  return new PointerEvent(type, {
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    button: options.button ?? 0,
    buttons: options.buttons ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}

/**
 * Create a mock wheel event
 */
function createWheelEvent(
  options: {
    clientX?: number;
    clientY?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {},
): WheelEvent {
  return new WheelEvent("wheel", {
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    deltaY: options.deltaY ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}

/**
 * Create a mock keyboard event
 */
function createKeyboardEvent(
  type: string,
  options: {
    key?: string;
    code?: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    repeat?: boolean;
  } = {},
): KeyboardEvent {
  return new KeyboardEvent(type, {
    key: options.key ?? "a",
    code: options.code ?? "KeyA",
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    repeat: options.repeat ?? false,
    bubbles: true,
    cancelable: true,
  });
}

describe("InputAdapter", () => {
  let canvas: HTMLCanvasElement;
  let camera: Camera;
  let actions: ActionType[];
  let adapter: InputAdapter;

  beforeEach(() => {
    canvas = createMockCanvas();
    camera = Camera.create(0, 0, 1);
    actions = [];

    adapter = new InputAdapter({
      canvas,
      getCamera: () => camera,
      getViewport: () => ({ width: 800, height: 600 }),
      onAction: (action) => actions.push(action),
      preventDefault: true,
      captureKeyboard: true,
    });
  });

  afterEach(() => {
    adapter.dispose();
  });

  describe("constructor and disposal", () => {
    it("should create adapter and attach event listeners", () => {
      const onAction = vi.fn();
      const testAdapter = new InputAdapter({
        canvas,
        getCamera: () => camera,
        getViewport: () => ({ width: 800, height: 600 }),
        onAction,
      });

      const event = createPointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      canvas.dispatchEvent(event);

      expect(onAction).toHaveBeenCalled();
      testAdapter.dispose();
    });

    it("should remove event listeners on dispose", () => {
      const onAction = vi.fn();
      const testAdapter = new InputAdapter({
        canvas,
        getCamera: () => camera,
        getViewport: () => ({ width: 800, height: 600 }),
        onAction,
      });

      testAdapter.dispose();

      const event = createPointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      canvas.dispatchEvent(event);

      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe("pointer events", () => {
    it("should dispatch pointer down action", () => {
      const event = createPointerEvent("pointerdown", { clientX: 100, clientY: 200, button: 0, buttons: 1 });
      canvas.dispatchEvent(event);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("pointer-down");
      expect(actions[0]).toMatchObject({ screen: { x: 100, y: 200 }, button: 0 });
    });

    it("should dispatch pointer move action", () => {
      const event = createPointerEvent("pointermove", { clientX: 150, clientY: 250, buttons: 1 });
      canvas.dispatchEvent(event);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("pointer-move");
      expect(actions[0]).toMatchObject({ screen: { x: 150, y: 250 } });
    });

    it("should dispatch pointer up action", () => {
      const event = createPointerEvent("pointerup", { clientX: 100, clientY: 200, button: 0, buttons: 0 });
      canvas.dispatchEvent(event);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("pointer-up");
      expect(actions[0]).toMatchObject({ screen: { x: 100, y: 200 }, button: 0 });
    });

    it("should convert screen coordinates to world coordinates", () => {
      const event = createPointerEvent("pointerdown", { clientX: 400, clientY: 300, buttons: 1 });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ screen: { x: 400, y: 300 }, world: { x: 0, y: 0 } });
    });

    it("should track pointer state", () => {
      let state = adapter.getPointerState();
      expect(state.isDown).toBe(false);
      expect(state.startWorld).toBe(null);

      const downEvent = createPointerEvent("pointerdown", { clientX: 100, clientY: 100, buttons: 1 });
      canvas.dispatchEvent(downEvent);

      state = adapter.getPointerState();
      expect(state.isDown).toBe(true);
      expect(state.startWorld).not.toBe(null);
      expect(state.startScreen).toEqual({ x: 100, y: 100 });

      const upEvent = createPointerEvent("pointerup", { clientX: 150, clientY: 150, buttons: 0 });
      canvas.dispatchEvent(upEvent);

      state = adapter.getPointerState();
      expect(state.isDown).toBe(false);
      expect(state.startWorld).toBe(null);
    });

    it("should handle modifier keys in pointer events", () => {
      const event = createPointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        buttons: 1,
        ctrlKey: true,
        shiftKey: false,
      });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ modifiers: { ctrl: true, shift: false, alt: false, meta: false } });
    });

    it("should decode pointer buttons bitmask", () => {
      const event = createPointerEvent("pointerdown", { clientX: 100, clientY: 100, button: 0, buttons: 5 });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ buttons: { left: true, middle: true, right: false } });
    });
  });

  describe("cursor updates", () => {
    it("throttles onCursorUpdate via requestAnimationFrame", () => {
      adapter.dispose();
      const rafCallbacks: FrameRequestCallback[] = [];
      const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
      const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
      const onCursorUpdate = vi.fn();

      adapter = new InputAdapter({
        canvas,
        getCamera: () => camera,
        getViewport: () => ({ width: 800, height: 600 }),
        onAction: (action) => actions.push(action),
        onCursorUpdate,
      });

      canvas.dispatchEvent(createPointerEvent("pointermove", { clientX: 10, clientY: 20 }));
      canvas.dispatchEvent(createPointerEvent("pointermove", { clientX: 50, clientY: 60 }));

      expect(onCursorUpdate).not.toHaveBeenCalled();
      expect(rafCallbacks).toHaveLength(1);

      rafCallbacks[0](16);

      expect(onCursorUpdate).toHaveBeenCalledTimes(1);
      expect(onCursorUpdate).toHaveBeenCalledWith({ x: -350, y: -240 }, { x: 50, y: 60 });

      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    });
  });

  describe("wheel events", () => {
    it("should dispatch wheel action", () => {
      const event = createWheelEvent({ clientX: 400, clientY: 300, deltaY: -100 });
      canvas.dispatchEvent(event);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("wheel");
      expect(actions[0]).toMatchObject({ screen: { x: 400, y: 300 }, deltaY: -100 });
    });

    it("should include modifiers in wheel events", () => {
      const event = createWheelEvent({ clientX: 400, clientY: 300, deltaY: 100, ctrlKey: true });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ modifiers: { ctrl: true, shift: false, alt: false, meta: false } });
    });
  });

  describe("keyboard events", () => {
    it("should dispatch key down action", () => {
      const event = createKeyboardEvent("keydown", { key: "a", code: "KeyA" });
      window.dispatchEvent(event);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("key-down");
      expect(actions[0]).toMatchObject({ key: "a", code: "KeyA", repeat: false });
    });

    it("should dispatch key up action", () => {
      const event = createKeyboardEvent("keyup", { key: "b", code: "KeyB" });
      window.dispatchEvent(event);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("key-up");
      expect(actions[0]).toMatchObject({ key: "b", code: "KeyB" });
    });

    it("should handle repeat key events", () => {
      const event = createKeyboardEvent("keydown", { key: "a", code: "KeyA", repeat: true });
      window.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ repeat: true });
    });

    it("should include modifiers in keyboard events", () => {
      const event = createKeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true });
      window.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ modifiers: { ctrl: true, shift: false, alt: false, meta: false } });
    });

    it("should not capture keyboard events when captureKeyboard is false", () => {
      const testActions: ActionType[] = [];
      const testAdapter = new InputAdapter({
        canvas,
        getCamera: () => camera,
        getViewport: () => ({ width: 800, height: 600 }),
        onAction: (action) => testActions.push(action),
        captureKeyboard: false,
      });

      const event = createKeyboardEvent("keydown", { key: "a" });
      window.dispatchEvent(event);

      expect(testActions).toHaveLength(0);
      testAdapter.dispose();
    });

    it("should ignore keyboard events from input elements", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);

      const event = new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true, cancelable: true });

      Object.defineProperty(event, "target", { value: input, enumerable: true });
      window.dispatchEvent(event);

      expect(actions).toHaveLength(0);

      document.body.removeChild(input);
    });
  });

  describe("coordinate transformation", () => {
    it("should handle camera panning", () => {
      camera = Camera.create(100, 50, 1);

      const event = createPointerEvent("pointerdown", { clientX: 400, clientY: 300, buttons: 1 });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ screen: { x: 400, y: 300 }, world: { x: 100, y: 50 } });
    });

    it("should handle camera zoom", () => {
      camera = Camera.create(0, 0, 2);

      const event = createPointerEvent("pointerdown", { clientX: 500, clientY: 300, buttons: 1 });
      canvas.dispatchEvent(event);
      expect(actions[0]).toMatchObject({ screen: { x: 500, y: 300 }, world: { x: 50, y: 0 } });
    });

    it("should handle combined camera transform", () => {
      camera = Camera.create(200, 100, 0.5);

      const event = createPointerEvent("pointerdown", { clientX: 600, clientY: 450, buttons: 1 });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ screen: { x: 600, y: 450 }, world: { x: 600, y: 400 } });
    });
  });

  describe("edge cases", () => {
    it("should handle pointer events at canvas edges", () => {
      let event = createPointerEvent("pointerdown", { clientX: 0, clientY: 0, buttons: 1 });
      canvas.dispatchEvent(event);
      expect(actions[0]).toMatchObject({ screen: { x: 0, y: 0 } });

      actions.length = 0;

      event = createPointerEvent("pointerdown", { clientX: 800, clientY: 600, buttons: 1 });
      canvas.dispatchEvent(event);
      expect(actions[0]).toMatchObject({ screen: { x: 800, y: 600 } });
    });

    it("should handle multiple pointer buttons simultaneously", () => {
      const event = createPointerEvent("pointerdown", { clientX: 100, clientY: 100, button: 2, buttons: 7 });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ button: 2, buttons: { left: true, middle: true, right: true } });
    });

    it("should handle zero deltaY in wheel events", () => {
      const event = createWheelEvent({ clientX: 400, clientY: 300, deltaY: 0 });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ deltaY: 0 });
    });

    it("should handle special keys", () => {
      const specialKeys = [
        { key: "Escape", code: "Escape" },
        { key: "Enter", code: "Enter" },
        { key: " ", code: "Space" },
        { key: "ArrowUp", code: "ArrowUp" },
        { key: "Tab", code: "Tab" },
      ];

      specialKeys.forEach(({ key, code }) => {
        actions.length = 0;
        const event = createKeyboardEvent("keydown", { key, code });
        window.dispatchEvent(event);

        expect(actions[0]).toMatchObject({ key, code });
      });
    });

    it("should handle rapid pointer move events", () => {
      for (let i = 0; i < 100; i++) {
        const event = createPointerEvent("pointermove", { clientX: 100 + i, clientY: 100 + i, buttons: 1 });
        canvas.dispatchEvent(event);
      }

      expect(actions).toHaveLength(100);
      expect(actions.every((action) => action.type === "pointer-move")).toBe(true);
    });

    it("should update pointer state on each move", () => {
      const downEvent = createPointerEvent("pointerdown", { clientX: 100, clientY: 100, buttons: 1 });
      canvas.dispatchEvent(downEvent);

      const moveEvent = createPointerEvent("pointermove", { clientX: 200, clientY: 200, buttons: 1 });
      canvas.dispatchEvent(moveEvent);

      const state = adapter.getPointerState();
      expect(state.lastScreen).toEqual({ x: 200, y: 200 });
      expect(state.startScreen).toEqual({ x: 100, y: 100 });
    });

    it("should preserve start position until all buttons released", () => {
      const down1 = createPointerEvent("pointerdown", { clientX: 100, clientY: 100, button: 0, buttons: 1 });
      canvas.dispatchEvent(down1);

      let state = adapter.getPointerState();
      expect(state.startScreen).toEqual({ x: 100, y: 100 });

      const down2 = createPointerEvent("pointerdown", { clientX: 150, clientY: 150, button: 1, buttons: 5 });
      canvas.dispatchEvent(down2);

      const up1 = createPointerEvent("pointerup", { clientX: 200, clientY: 200, button: 0, buttons: 4 });
      canvas.dispatchEvent(up1);

      state = adapter.getPointerState();
      expect(state.startScreen).not.toBe(null);

      const up2 = createPointerEvent("pointerup", { clientX: 250, clientY: 250, button: 1, buttons: 0 });
      canvas.dispatchEvent(up2);

      state = adapter.getPointerState();
      expect(state.startScreen).toBe(null);
    });

    it("should handle negative coordinates from camera transform", () => {
      camera = Camera.create(-1000, -1000, 1);

      const event = createPointerEvent("pointerdown", { clientX: 400, clientY: 300, buttons: 1 });
      canvas.dispatchEvent(event);

      expect(actions[0]).toMatchObject({ world: { x: -1000, y: -1000 } });
    });

    it("should handle very large coordinates", () => {
      camera = Camera.create(1e10, 1e10, 0.001);

      const event = createPointerEvent("pointerdown", { clientX: 400, clientY: 300, buttons: 1 });
      canvas.dispatchEvent(event);

      const action = actions[0] as { world: { x: number; y: number } };
      expect(action.world.x).toBeCloseTo(1e10, -5);
      expect(action.world.y).toBeCloseTo(1e10, -5);
    });
  });

  describe("createInputAdapter", () => {
    it("should create and return an InputAdapter instance", () => {
      const testAdapter = createInputAdapter({
        canvas,
        getCamera: () => camera,
        getViewport: () => ({ width: 800, height: 600 }),
        onAction: (action) => actions.push(action),
      });

      expect(testAdapter).toBeInstanceOf(InputAdapter);
      testAdapter.dispose();
    });
  });
});
