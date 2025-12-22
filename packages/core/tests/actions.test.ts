import { describe, expect, it } from "vitest";
import { Action, Modifiers, PointerButtons } from "../src/actions";

describe("Modifiers", () => {
  describe("create", () => {
    it("should create modifiers with default values", () => {
      const modifiers = Modifiers.create();
      expect(modifiers).toEqual({ ctrl: false, shift: false, alt: false, meta: false });
    });

    it("should create modifiers with custom values", () => {
      const modifiers = Modifiers.create(true, false, true, false);
      expect(modifiers).toEqual({ ctrl: true, shift: false, alt: true, meta: false });
    });
  });

  describe("fromEvent", () => {
    it("should extract modifiers from event object", () => {
      const event = { ctrlKey: true, shiftKey: false, altKey: true, metaKey: false };
      const modifiers = Modifiers.fromEvent(event);
      expect(modifiers).toEqual({ ctrl: true, shift: false, alt: true, meta: false });
    });

    it("should handle all modifiers pressed", () => {
      const event = { ctrlKey: true, shiftKey: true, altKey: true, metaKey: true };
      const modifiers = Modifiers.fromEvent(event);
      expect(modifiers).toEqual({ ctrl: true, shift: true, alt: true, meta: true });
    });

    it("should handle no modifiers pressed", () => {
      const event = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
      const modifiers = Modifiers.fromEvent(event);
      expect(modifiers).toEqual({ ctrl: false, shift: false, alt: false, meta: false });
    });
  });

  describe("isEmpty", () => {
    it("should return true when no modifiers are active", () => {
      const modifiers = Modifiers.create();
      expect(Modifiers.isEmpty(modifiers)).toBe(true);
    });

    it("should return false when any modifier is active", () => {
      expect(Modifiers.isEmpty(Modifiers.create(true, false, false, false))).toBe(false);
      expect(Modifiers.isEmpty(Modifiers.create(false, true, false, false))).toBe(false);
      expect(Modifiers.isEmpty(Modifiers.create(false, false, true, false))).toBe(false);
      expect(Modifiers.isEmpty(Modifiers.create(false, false, false, true))).toBe(false);
    });
  });

  describe("isPrimaryModifier", () => {
    it("should detect primary modifier on different platforms", () => {
      const withCtrl = Modifiers.create(true, false, false, false);
      const withMeta = Modifiers.create(false, false, false, true);
      const ctrlIsPrimary = Modifiers.isPrimaryModifier(withCtrl);
      const metaIsPrimary = Modifiers.isPrimaryModifier(withMeta);
      expect(ctrlIsPrimary || metaIsPrimary).toBe(true);
    });
  });
});

describe("PointerButtons", () => {
  describe("create", () => {
    it("should create button state with default values", () => {
      const buttons = PointerButtons.create();
      expect(buttons).toEqual({ left: false, middle: false, right: false });
    });

    it("should create button state with custom values", () => {
      const buttons = PointerButtons.create(true, false, true);
      expect(buttons).toEqual({ left: true, middle: false, right: true });
    });
  });

  describe("fromButtons", () => {
    it.each([
      { description: "no buttons pressed", buttons: 0, expected: { left: false, middle: false, right: false } },
      { description: "left button only", buttons: 1, expected: { left: true, middle: false, right: false } },
      { description: "right button only", buttons: 2, expected: { left: false, middle: false, right: true } },
      { description: "middle button only", buttons: 4, expected: { left: false, middle: true, right: false } },
      { description: "left and right", buttons: 3, expected: { left: true, middle: false, right: true } },
      { description: "left and middle", buttons: 5, expected: { left: true, middle: true, right: false } },
      { description: "right and middle", buttons: 6, expected: { left: false, middle: true, right: true } },
      { description: "all buttons", buttons: 7, expected: { left: true, middle: true, right: true } },
    ])("should decode bitmask: $description", ({ buttons, expected }) => {
      expect(PointerButtons.fromButtons(buttons)).toEqual(expected);
    });
  });

  describe("isAnyPressed", () => {
    it("should return false when no buttons pressed", () => {
      expect(PointerButtons.isAnyPressed(PointerButtons.create())).toBe(false);
    });

    it("should return true when any button is pressed", () => {
      expect(PointerButtons.isAnyPressed(PointerButtons.create(true, false, false))).toBe(true);
      expect(PointerButtons.isAnyPressed(PointerButtons.create(false, true, false))).toBe(true);
      expect(PointerButtons.isAnyPressed(PointerButtons.create(false, false, true))).toBe(true);
    });
  });

  describe("isEmpty", () => {
    it("should return true when no buttons pressed", () => {
      expect(PointerButtons.isEmpty(PointerButtons.create())).toBe(true);
    });

    it("should return false when any button is pressed", () => {
      expect(PointerButtons.isEmpty(PointerButtons.create(true, false, false))).toBe(false);
      expect(PointerButtons.isEmpty(PointerButtons.create(false, true, false))).toBe(false);
      expect(PointerButtons.isEmpty(PointerButtons.create(false, false, true))).toBe(false);
    });
  });
});

describe("Action", () => {
  const screen = { x: 100, y: 200 };
  const world = { x: 50, y: 100 };
  const modifiers = Modifiers.create(true, false, false, false);
  const buttons = PointerButtons.create(true, false, false);
  const timestamp = 1_234_567_890;

  describe("pointerDown", () => {
    it("should create pointer down action with all required fields", () => {
      const action = Action.pointerDown(screen, world, 0, buttons, modifiers, timestamp);

      expect(action).toEqual({ type: "pointer-down", screen, world, button: 0, buttons, modifiers, timestamp });
    });

    it("should use current timestamp when not provided", () => {
      const before = Date.now();
      const action = Action.pointerDown(screen, world, 0, buttons, modifiers);
      const after = Date.now();

      expect(action.timestamp).toBeGreaterThanOrEqual(before);
      expect(action.timestamp).toBeLessThanOrEqual(after);
    });

    it("should handle different button values", () => {
      expect(Action.pointerDown(screen, world, 0, buttons, modifiers).button).toBe(0);
      expect(Action.pointerDown(screen, world, 1, buttons, modifiers).button).toBe(1);
      expect(Action.pointerDown(screen, world, 2, buttons, modifiers).button).toBe(2);
    });
  });

  describe("pointerMove", () => {
    it("should create pointer move action with all required fields", () => {
      const action = Action.pointerMove(screen, world, buttons, modifiers, timestamp);

      expect(action).toEqual({ type: "pointer-move", screen, world, buttons, modifiers, timestamp });
    });

    it("should use current timestamp when not provided", () => {
      const before = Date.now();
      const action = Action.pointerMove(screen, world, buttons, modifiers);
      const after = Date.now();

      expect(action.timestamp).toBeGreaterThanOrEqual(before);
      expect(action.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("pointerUp", () => {
    it("should create pointer up action with all required fields", () => {
      const action = Action.pointerUp(screen, world, 0, buttons, modifiers, timestamp);

      expect(action).toEqual({ type: "pointer-up", screen, world, button: 0, buttons, modifiers, timestamp });
    });

    it("should use current timestamp when not provided", () => {
      const before = Date.now();
      const action = Action.pointerUp(screen, world, 0, buttons, modifiers);
      const after = Date.now();

      expect(action.timestamp).toBeGreaterThanOrEqual(before);
      expect(action.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("wheel", () => {
    it("should create wheel action with all required fields", () => {
      const deltaY = -100;
      const action = Action.wheel(screen, world, deltaY, modifiers, timestamp);

      expect(action).toEqual({ type: "wheel", screen, world, deltaY, modifiers, timestamp });
    });

    it("should use current timestamp when not provided", () => {
      const before = Date.now();
      const action = Action.wheel(screen, world, -100, modifiers);
      const after = Date.now();

      expect(action.timestamp).toBeGreaterThanOrEqual(before);
      expect(action.timestamp).toBeLessThanOrEqual(after);
    });

    it("should handle positive and negative deltaY", () => {
      expect(Action.wheel(screen, world, -100, modifiers).deltaY).toBe(-100);
      expect(Action.wheel(screen, world, 100, modifiers).deltaY).toBe(100);
      expect(Action.wheel(screen, world, 0, modifiers).deltaY).toBe(0);
    });
  });

  describe("keyDown", () => {
    it("should create key down action with all required fields", () => {
      const action = Action.keyDown("a", "KeyA", modifiers, false, timestamp);

      expect(action).toEqual({ type: "key-down", key: "a", code: "KeyA", modifiers, repeat: false, timestamp });
    });

    it("should use current timestamp when not provided", () => {
      const before = Date.now();
      const action = Action.keyDown("a", "KeyA", modifiers);
      const after = Date.now();

      expect(action.timestamp).toBeGreaterThanOrEqual(before);
      expect(action.timestamp).toBeLessThanOrEqual(after);
    });

    it("should handle repeat flag", () => {
      expect(Action.keyDown("a", "KeyA", modifiers, false).repeat).toBe(false);
      expect(Action.keyDown("a", "KeyA", modifiers, true).repeat).toBe(true);
    });

    it("should handle special keys", () => {
      expect(Action.keyDown("Escape", "Escape", modifiers).key).toBe("Escape");
      expect(Action.keyDown("Enter", "Enter", modifiers).key).toBe("Enter");
      expect(Action.keyDown(" ", "Space", modifiers).key).toBe(" ");
    });
  });

  describe("keyUp", () => {
    it("should create key up action with all required fields", () => {
      const action = Action.keyUp("a", "KeyA", modifiers, timestamp);

      expect(action).toEqual({ type: "key-up", key: "a", code: "KeyA", modifiers, timestamp });
    });

    it("should use current timestamp when not provided", () => {
      const before = Date.now();
      const action = Action.keyUp("a", "KeyA", modifiers);
      const after = Date.now();

      expect(action.timestamp).toBeGreaterThanOrEqual(before);
      expect(action.timestamp).toBeLessThanOrEqual(after);
    });
  });
});

describe("Action edge cases", () => {
  describe("coordinate edge cases", () => {
    it("should handle zero coordinates", () => {
      const screen = { x: 0, y: 0 };
      const world = { x: 0, y: 0 };
      const action = Action.pointerDown(screen, world, 0, PointerButtons.create(), Modifiers.create());

      expect(action.screen).toEqual({ x: 0, y: 0 });
      expect(action.world).toEqual({ x: 0, y: 0 });
    });

    it("should handle negative coordinates", () => {
      const screen = { x: -100, y: -200 };
      const world = { x: -50, y: -100 };
      const action = Action.pointerMove(screen, world, PointerButtons.create(), Modifiers.create());

      expect(action.screen).toEqual({ x: -100, y: -200 });
      expect(action.world).toEqual({ x: -50, y: -100 });
    });

    it("should handle very large coordinates", () => {
      const screen = { x: 1e10, y: 1e10 };
      const world = { x: 1e10, y: 1e10 };
      const action = Action.pointerUp(screen, world, 0, PointerButtons.create(), Modifiers.create());

      expect(action.screen).toEqual({ x: 1e10, y: 1e10 });
      expect(action.world).toEqual({ x: 1e10, y: 1e10 });
    });

    it("should handle floating point coordinates", () => {
      const screen = { x: 100.5, y: 200.7 };
      const world = { x: 50.3, y: 100.9 };
      const action = Action.pointerMove(screen, world, PointerButtons.create(), Modifiers.create());

      expect(action.screen).toEqual({ x: 100.5, y: 200.7 });
      expect(action.world).toEqual({ x: 50.3, y: 100.9 });
    });
  });

  describe("button edge cases", () => {
    it("should handle invalid button numbers gracefully", () => {
      const action = Action.pointerDown(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        99,
        PointerButtons.create(),
        Modifiers.create(),
      );
      expect(action.button).toBe(99);
    });

    it("should handle negative button numbers", () => {
      const action = Action.pointerDown(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        -1,
        PointerButtons.create(),
        Modifiers.create(),
      );
      expect(action.button).toBe(-1);
    });
  });

  describe("wheel deltaY edge cases", () => {
    it("should handle very large deltaY values", () => {
      const action = Action.wheel({ x: 0, y: 0 }, { x: 0, y: 0 }, 1e6, Modifiers.create());
      expect(action.deltaY).toBe(1e6);
    });

    it("should handle very small deltaY values", () => {
      const action = Action.wheel({ x: 0, y: 0 }, { x: 0, y: 0 }, -1e-10, Modifiers.create());
      expect(action.deltaY).toBe(-1e-10);
    });
  });

  describe("keyboard edge cases", () => {
    it("should handle empty key string", () => {
      const action = Action.keyDown("", "", Modifiers.create());
      expect(action.key).toBe("");
      expect(action.code).toBe("");
    });

    it("should handle multi-character keys", () => {
      const action = Action.keyDown("ArrowUp", "ArrowUp", Modifiers.create());
      expect(action.key).toBe("ArrowUp");
      expect(action.code).toBe("ArrowUp");
    });

    it("should handle unicode characters", () => {
      const action = Action.keyDown("�", "Euro", Modifiers.create());
      expect(action.key).toBe("�");
    });
  });

  describe("timestamp edge cases", () => {
    it("should handle zero timestamp", () => {
      const action = Action.pointerDown(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        0,
        PointerButtons.create(),
        Modifiers.create(),
        0,
      );
      expect(action.timestamp).toBe(0);
    });

    it("should handle negative timestamp", () => {
      const action = Action.keyDown("a", "KeyA", Modifiers.create(), false, -100);
      expect(action.timestamp).toBe(-100);
    });

    it("should handle very large timestamp", () => {
      const largeTimestamp = Number.MAX_SAFE_INTEGER;
      const action = Action.wheel({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, Modifiers.create(), largeTimestamp);
      expect(action.timestamp).toBe(largeTimestamp);
    });
  });
});
