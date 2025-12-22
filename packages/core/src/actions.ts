import type { Vec2 } from "./math";

/**
 * Keyboard modifier keys state
 */
export type Modifiers = { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

/**
 * Pointer button state
 * - left: 0
 * - middle: 1
 * - right: 2
 */
export type PointerButtons = { left: boolean; middle: boolean; right: boolean };

/**
 * Pointer down event - user pressed pointer button
 */
export type PointerDownAction = {
  type: "pointer-down";
  /** Point in screen coordinates (pixels) */
  screen: Vec2;
  /** Point in world coordinates */
  world: Vec2;
  /** Which button was pressed */
  button: number;
  /** State of all buttons after this event */
  buttons: PointerButtons;
  /** Modifier keys state */
  modifiers: Modifiers;
  /** Timestamp of the event */
  timestamp: number;
};

/**
 * Pointer move event - user moved pointer
 */
export type PointerMoveAction = {
  type: "pointer-move";
  /** Point in screen coordinates (pixels) */
  screen: Vec2;
  /** Point in world coordinates */
  world: Vec2;
  /** State of all buttons */
  buttons: PointerButtons;
  /** Modifier keys state */
  modifiers: Modifiers;
  /** Timestamp of the event */
  timestamp: number;
};

/**
 * Pointer up event - user released pointer button
 */
export type PointerUpAction = {
  type: "pointer-up";
  /** Point in screen coordinates (pixels) */
  screen: Vec2;
  /** Point in world coordinates */
  world: Vec2;
  /** Which button was released */
  button: number;
  /** State of all buttons after this event */
  buttons: PointerButtons;
  /** Modifier keys state */
  modifiers: Modifiers;
  /** Timestamp of the event */
  timestamp: number;
};

/**
 * Wheel event - user scrolled wheel
 */
export type WheelAction = {
  type: "wheel";
  /** Point in screen coordinates where wheel event occurred */
  screen: Vec2;
  /** Point in world coordinates */
  world: Vec2;
  /** Wheel delta (usually negative = zoom in, positive = zoom out) */
  deltaY: number;
  /** Modifier keys state */
  modifiers: Modifiers;
  /** Timestamp of the event */
  timestamp: number;
};

/**
 * Key down event - user pressed a key
 */
export type KeyDownAction = {
  type: "key-down";
  /** The key that was pressed (e.g., "a", "Enter", "Escape") */
  key: string;
  /** The code of the key (e.g., "KeyA", "Enter", "Escape") */
  code: string;
  /** Modifier keys state */
  modifiers: Modifiers;
  /** Whether this is a repeated key event (key held down) */
  repeat: boolean;
  /** Timestamp of the event */
  timestamp: number;
};

/**
 * Key up event - user released a key
 */
export type KeyUpAction = {
  type: "key-up";
  /** The key that was released */
  key: string;
  /** The code of the key */
  code: string;
  /** Modifier keys state */
  modifiers: Modifiers;
  /** Timestamp of the event */
  timestamp: number;
};

/**
 * Union of all input actions
 */
export type Action =
  | PointerDownAction
  | PointerMoveAction
  | PointerUpAction
  | WheelAction
  | KeyDownAction
  | KeyUpAction;

/**
 * Action namespace for helper functions
 */
export const Action = {
  /**
   * Create a PointerDownAction
   */
  pointerDown(
    screen: Vec2,
    world: Vec2,
    button: number,
    buttons: PointerButtons,
    modifiers: Modifiers,
    timestamp = Date.now(),
  ): PointerDownAction {
    return { type: "pointer-down", screen, world, button, buttons, modifiers, timestamp };
  },

  /**
   * Create a PointerMoveAction
   */
  pointerMove(
    screen: Vec2,
    world: Vec2,
    buttons: PointerButtons,
    modifiers: Modifiers,
    timestamp = Date.now(),
  ): PointerMoveAction {
    return { type: "pointer-move", screen, world, buttons, modifiers, timestamp };
  },

  /**
   * Create a PointerUpAction
   */
  pointerUp(
    screen: Vec2,
    world: Vec2,
    button: number,
    buttons: PointerButtons,
    modifiers: Modifiers,
    timestamp = Date.now(),
  ): PointerUpAction {
    return { type: "pointer-up", screen, world, button, buttons, modifiers, timestamp };
  },

  /**
   * Create a WheelAction
   */
  wheel(screen: Vec2, world: Vec2, deltaY: number, modifiers: Modifiers, timestamp = Date.now()): WheelAction {
    return { type: "wheel", screen, world, deltaY, modifiers, timestamp };
  },

  /**
   * Create a KeyDownAction
   */
  keyDown(key: string, code: string, modifiers: Modifiers, repeat = false, timestamp = Date.now()): KeyDownAction {
    return { type: "key-down", key, code, modifiers, repeat, timestamp };
  },

  /**
   * Create a KeyUpAction
   */
  keyUp(key: string, code: string, modifiers: Modifiers, timestamp = Date.now()): KeyUpAction {
    return { type: "key-up", key, code, modifiers, timestamp };
  },
};

/**
 * Create Modifiers object from DOM event
 */
export const Modifiers = {
  /**
   * Create a Modifiers object with default values (all false)
   */
  create(ctrl = false, shift = false, alt = false, meta = false): Modifiers {
    return { ctrl, shift, alt, meta };
  },

  /**
   * Create Modifiers from a keyboard or mouse event
   */
  fromEvent(event: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): Modifiers {
    return { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey };
  },

  /**
   * Check if no modifiers are active
   */
  isEmpty(modifiers: Modifiers): boolean {
    return !modifiers.ctrl && !modifiers.shift && !modifiers.alt && !modifiers.meta;
  },

  /**
   * Check if Cmd (Mac) or Ctrl (other platforms) is pressed
   */
  isPrimaryModifier(modifiers: Modifiers): boolean {
    const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
    return isMac ? modifiers.meta : modifiers.ctrl;
  },
};

/**
 * PointerButtons helpers
 */
export const PointerButtons = {
  /**
   * Create a PointerButtons object with default values (all false)
   */
  create(left = false, middle = false, right = false): PointerButtons {
    return { left, middle, right };
  },

  /**
   * Create PointerButtons from DOM PointerEvent buttons bitmask
   *
   * @param buttons - Bitmask from PointerEvent.buttons
   */
  fromButtons(buttons: number): PointerButtons {
    return { left: (buttons & 1) !== 0, right: (buttons & 2) !== 0, middle: (buttons & 4) !== 0 };
  },

  /**
   * Check if any button is pressed
   */
  isAnyPressed(buttons: PointerButtons): boolean {
    return buttons.left || buttons.middle || buttons.right;
  },

  /**
   * Check if no buttons are pressed
   */
  isEmpty(buttons: PointerButtons): boolean {
    return !buttons.left && !buttons.middle && !buttons.right;
  },
};
