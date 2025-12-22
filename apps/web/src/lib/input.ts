import {
  Action,
  type Action as ActionType,
  Camera,
  Modifiers,
  PointerButtons,
  type Vec2,
  type Viewport,
} from "inkfinite-core";

/**
 * Pointer state tracked by the input adapter
 */
export type PointerState = {
  /** Whether any pointer button is currently down */
  isDown: boolean;
  /** Last known world coordinates */
  lastWorld: { x: number; y: number } | null;
  /** World coordinates where pointer was first pressed */
  startWorld: { x: number; y: number } | null;
  /** Last known screen coordinates */
  lastScreen: { x: number; y: number } | null;
  /** Screen coordinates where pointer was first pressed */
  startScreen: { x: number; y: number } | null;
  /** Current button state */
  buttons: PointerButtons;
};

/**
 * Input adapter configuration
 */
export type InputAdapterConfig = {
  /** Canvas element to attach listeners to */
  canvas: HTMLCanvasElement;
  /** Function to get current camera state */
  getCamera: () => Camera;
  /** Function to get current viewport dimensions */
  getViewport: () => Viewport;
  /** Callback for dispatching actions */
  onAction: (action: ActionType) => void;
  /** Optional callback for raw cursor updates */
  onCursorUpdate?: (world: Vec2, screen: Vec2) => void;
  /** Whether to prevent default browser behavior (default: true) */
  preventDefault?: boolean;
  /** Whether to capture keyboard events on window (default: true) */
  captureKeyboard?: boolean;
};

/**
 * Input adapter for capturing and normalizing DOM input events
 *
 * Features:
 * - Captures pointer events (down, move, up) on canvas
 * - Captures wheel events for zooming
 * - Captures keyboard events (optionally on window)
 * - Converts screen coordinates to world coordinates
 * - Tracks pointer state
 * - Normalizes modifiers (ctrl/cmd, shift, alt)
 * - Dispatches normalized actions
 */
export class InputAdapter {
  private config: InputAdapterConfig & { preventDefault: boolean; captureKeyboard: boolean };
  private pointerState: PointerState;
  private boundHandlers: {
    pointerDown: (e: PointerEvent) => void;
    pointerMove: (e: PointerEvent) => void;
    pointerUp: (e: PointerEvent) => void;
    wheel: (e: WheelEvent) => void;
    keyDown: (e: KeyboardEvent) => void;
    keyUp: (e: KeyboardEvent) => void;
    contextMenu: (e: Event) => void;
  };
  private cursorUpdateFrame: number | null;
  private pendingCursorWorld: Vec2 | null;
  private pendingCursorScreen: Vec2 | null;

  constructor(config: InputAdapterConfig) {
    this.config = {
      ...config,
      preventDefault: config.preventDefault ?? true,
      captureKeyboard: config.captureKeyboard ?? true,
    };

    this.pointerState = {
      isDown: false,
      lastWorld: null,
      startWorld: null,
      lastScreen: null,
      startScreen: null,
      buttons: PointerButtons.create(),
    };

    this.boundHandlers = {
      pointerDown: this.handlePointerDown.bind(this),
      pointerMove: this.handlePointerMove.bind(this),
      pointerUp: this.handlePointerUp.bind(this),
      wheel: this.handleWheel.bind(this),
      keyDown: this.handleKeyDown.bind(this),
      keyUp: this.handleKeyUp.bind(this),
      contextMenu: this.handleContextMenu.bind(this),
    };
    this.cursorUpdateFrame = null;
    this.pendingCursorWorld = null;
    this.pendingCursorScreen = null;

    this.attach();
  }

  /**
   * Get current pointer state
   */
  getPointerState(): Readonly<PointerState> {
    return { ...this.pointerState };
  }

  /**
   * Attach event listeners
   */
  private attach(): void {
    const { canvas } = this.config;

    canvas.addEventListener("pointerdown", this.boundHandlers.pointerDown);
    canvas.addEventListener("pointermove", this.boundHandlers.pointerMove);
    canvas.addEventListener("pointerup", this.boundHandlers.pointerUp);
    canvas.addEventListener("wheel", this.boundHandlers.wheel, { passive: false });
    canvas.addEventListener("contextmenu", this.boundHandlers.contextMenu);

    if (this.config.captureKeyboard) {
      window.addEventListener("keydown", this.boundHandlers.keyDown);
      window.addEventListener("keyup", this.boundHandlers.keyUp);
    }
  }

  /**
   * Detach event listeners and cleanup
   */
  dispose(): void {
    const { canvas } = this.config;

    canvas.removeEventListener("pointerdown", this.boundHandlers.pointerDown);
    canvas.removeEventListener("pointermove", this.boundHandlers.pointerMove);
    canvas.removeEventListener("pointerup", this.boundHandlers.pointerUp);
    canvas.removeEventListener("wheel", this.boundHandlers.wheel);
    canvas.removeEventListener("contextmenu", this.boundHandlers.contextMenu);

    if (this.config.captureKeyboard) {
      window.removeEventListener("keydown", this.boundHandlers.keyDown);
      window.removeEventListener("keyup", this.boundHandlers.keyUp);
    }

    if (
      this.cursorUpdateFrame !== null
      && typeof window !== "undefined"
      && typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(this.cursorUpdateFrame);
      this.cursorUpdateFrame = null;
    }
  }

  /**
   * Get screen coordinates from pointer event
   */
  private getScreenCoords(e: PointerEvent): { x: number; y: number } {
    const rect = this.config.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  private screenToWorld(screen: { x: number; y: number }): { x: number; y: number } {
    const camera = this.config.getCamera();
    const viewport = this.config.getViewport();
    return Camera.screenToWorld(camera, screen, viewport);
  }

  /**
   * Handle pointer down event
   */
  private handlePointerDown(e: PointerEvent): void {
    if (this.config.preventDefault) {
      e.preventDefault();
    }

    const screen = this.getScreenCoords(e);
    const world = this.screenToWorld(screen);
    const buttons = PointerButtons.fromButtons(e.buttons);
    const modifiers = Modifiers.fromEvent(e);

    this.pointerState.isDown = true;
    this.pointerState.startWorld = world;
    this.pointerState.startScreen = screen;
    this.pointerState.lastWorld = world;
    this.pointerState.lastScreen = screen;
    this.pointerState.buttons = buttons;

    this.config.onAction(Action.pointerDown(screen, world, e.button, buttons, modifiers));
  }

  /**
   * Handle pointer move event
   */
  private handlePointerMove(e: PointerEvent): void {
    if (this.config.preventDefault && this.pointerState.isDown) {
      e.preventDefault();
    }

    const screen = this.getScreenCoords(e);
    const world = this.screenToWorld(screen);
    const buttons = PointerButtons.fromButtons(e.buttons);
    const modifiers = Modifiers.fromEvent(e);

    this.pointerState.lastWorld = world;
    this.pointerState.lastScreen = screen;
    this.pointerState.buttons = buttons;

    this.config.onAction(Action.pointerMove(screen, world, buttons, modifiers));
    this.queueCursorUpdate(world, screen);
  }

  /**
   * Handle pointer up event
   */
  private handlePointerUp(e: PointerEvent): void {
    if (this.config.preventDefault) {
      e.preventDefault();
    }

    const screen = this.getScreenCoords(e);
    const world = this.screenToWorld(screen);
    const buttons = PointerButtons.fromButtons(e.buttons);
    const modifiers = Modifiers.fromEvent(e);

    this.pointerState.isDown = false;
    this.pointerState.lastWorld = world;
    this.pointerState.lastScreen = screen;
    this.pointerState.buttons = buttons;

    if (PointerButtons.isEmpty(buttons)) {
      this.pointerState.startWorld = null;
      this.pointerState.startScreen = null;
    }

    this.config.onAction(Action.pointerUp(screen, world, e.button, buttons, modifiers));
  }

  /**
   * Handle wheel event
   */
  private handleWheel(e: WheelEvent): void {
    if (this.config.preventDefault) {
      e.preventDefault();
    }

    const rect = this.config.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = this.screenToWorld(screen);
    const modifiers = Modifiers.fromEvent(e);

    this.config.onAction(Action.wheel(screen, world, e.deltaY, modifiers));
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
      return;
    }

    const modifiers = Modifiers.fromEvent(e);

    this.config.onAction(Action.keyDown(e.key, e.code, modifiers, e.repeat));

    if (this.config.preventDefault && this.shouldPreventDefault(e)) {
      e.preventDefault();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
      return;
    }

    const modifiers = Modifiers.fromEvent(e);
    this.config.onAction(Action.keyUp(e.key, e.code, modifiers));
  }

  private handleContextMenu(e: Event): void {
    if (this.config.preventDefault) {
      e.preventDefault();
    }
  }

  /**
   * Throttle cursor updates using requestAnimationFrame.
   */
  private queueCursorUpdate(world: Vec2, screen: Vec2): void {
    if (!this.config.onCursorUpdate) {
      return;
    }

    this.pendingCursorWorld = { x: world.x, y: world.y };
    this.pendingCursorScreen = { x: screen.x, y: screen.y };

    if (this.cursorUpdateFrame !== null) {
      return;
    }

    const schedule = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : null;

    if (!schedule) {
      this.flushCursorUpdate();
      return;
    }

    this.cursorUpdateFrame = schedule(() => {
      this.cursorUpdateFrame = null;
      this.flushCursorUpdate();
    });
  }

  private flushCursorUpdate(): void {
    if (!this.config.onCursorUpdate || !this.pendingCursorWorld || !this.pendingCursorScreen) {
      this.pendingCursorWorld = null;
      this.pendingCursorScreen = null;
      return;
    }

    this.config.onCursorUpdate(this.pendingCursorWorld, this.pendingCursorScreen);
    this.pendingCursorWorld = null;
    this.pendingCursorScreen = null;
  }

  /**
   * Determine if default behavior should be prevented for a key event
   *
   * Prevents default for:
   * - Space (scroll)
   * - Arrow keys (scroll)
   * - Backspace/Delete (navigation)
   * - Cmd/Ctrl+Z, Cmd/Ctrl+Y (browser undo/redo)
   * - Tab (focus change)
   */
  private shouldPreventDefault(e: KeyboardEvent): boolean {
    const key = e.key;
    const modifiers = Modifiers.fromEvent(e);

    if (key === " " || key.startsWith("Arrow")) {
      return true;
    }

    if (key === "Backspace" || key === "Delete") {
      return true;
    }

    if (key === "Tab") {
      return true;
    }

    if (Modifiers.isPrimaryModifier(modifiers) && (key === "z" || key === "Z")) {
      return true;
    }

    if (Modifiers.isPrimaryModifier(modifiers) && (key === "y" || key === "Y")) {
      return true;
    }

    return false;
  }
}

/**
 * Create an input adapter
 *
 * @param config - Input adapter configuration
 * @returns Input adapter instance
 */
export function createInputAdapter(config: InputAdapterConfig): InputAdapter {
  return new InputAdapter(config);
}
