import type { Action } from "./actions";
import { hitTestPoint, shapeBounds } from "./geom";
import { Box2, Vec2 } from "./math";
import { BindingRecord, createId, ShapeRecord } from "./model";
import type { EditorState, ToolId } from "./reactivity";
import { getCurrentPage } from "./reactivity";

/**
 * Tool interface - defines behavior for each editor tool
 *
 * Tools are explicit state machines that handle user input actions.
 * Each tool decides how to respond to actions and can update editor state.
 */
export interface Tool {
  /** Unique identifier for this tool */
  readonly id: ToolId;

  /**
   * Called when the tool becomes active
   *
   * @param state - Current editor state
   * @returns Updated editor state
   */
  onEnter(state: EditorState): EditorState;

  /**
   * Called when an action occurs while this tool is active
   *
   * @param state - Current editor state
   * @param action - The action to handle
   * @returns Updated editor state
   */
  onAction(state: EditorState, action: Action): EditorState;

  /**
   * Called when the tool becomes inactive
   *
   * @param state - Current editor state
   * @returns Updated editor state
   */
  onExit(state: EditorState): EditorState;
}

/**
 * Route an action to the currently active tool
 *
 * @param state - Current editor state
 * @param action - Action to route
 * @param tools - Map of tool ID to tool instance
 * @returns Updated editor state after tool handles the action
 */
export function routeAction(state: EditorState, action: Action, tools: Map<ToolId, Tool>): EditorState {
  const currentTool = tools.get(state.ui.toolId);
  if (!currentTool) return state;
  return currentTool.onAction(state, action);
}

/**
 * Switch from current tool to a new tool
 *
 * Calls onExit on the current tool (if it exists), then onEnter on the new tool.
 *
 * @param state - Current editor state
 * @param newToolId - ID of tool to switch to
 * @param tools - Map of tool ID to tool instance
 * @returns Updated editor state with new tool active
 */
export function switchTool(state: EditorState, newToolId: ToolId, tools: Map<ToolId, Tool>): EditorState {
  if (state.ui.toolId === newToolId) {
    return state;
  }

  const currentTool = tools.get(state.ui.toolId);
  let nextState = state;
  if (currentTool) {
    nextState = currentTool.onExit(nextState);
  }

  nextState = { ...nextState, ui: { ...nextState.ui, toolId: newToolId } };

  const newTool = tools.get(newToolId);
  if (newTool) {
    nextState = newTool.onEnter(nextState);
  }

  return nextState;
}

/**
 * Create a map of tools from an array
 *
 * @param toolList - Array of tool instances
 * @returns Map of tool ID to tool instance
 */
export function createToolMap(toolList: Tool[]): Map<ToolId, Tool> {
  const map = new Map<ToolId, Tool>();
  for (const tool of toolList) {
    map.set(tool.id, tool);
  }
  return map;
}

/**
 * Internal state for the select tool
 */
type SelectToolState = {
  /** Whether we're currently dragging selected shapes */
  isDragging: boolean;
  /** World coordinates where drag started */
  dragStartWorld: Vec2 | null;
  /** Initial positions of shapes being dragged (shape id -> {x, y}) */
  initialShapePositions: Map<string, Vec2>;
  /** Marquee selection start point in world coordinates */
  marqueeStart: Vec2 | null;
  /** Marquee selection end point in world coordinates */
  marqueeEnd: Vec2 | null;
};

/**
 * Select tool - allows selecting and moving shapes
 *
 * Features:
 * - Click to select shapes (clears previous selection unless shift is held)
 * - Shift-click to add/remove shapes from selection
 * - Drag selected shapes to move them
 * - Drag on empty canvas to create marquee selection
 * - Escape key to clear selection
 * - Delete/Backspace to remove selected shapes
 */
export class SelectTool implements Tool {
  readonly id: ToolId = "select";
  private toolState: SelectToolState;

  constructor() {
    this.toolState = {
      isDragging: false,
      dragStartWorld: null,
      initialShapePositions: new Map(),
      marqueeStart: null,
      marqueeEnd: null,
    };
  }

  onEnter(state: EditorState): EditorState {
    this.resetToolState();
    return state;
  }

  onExit(state: EditorState): EditorState {
    this.resetToolState();
    return state;
  }

  onAction(state: EditorState, action: Action): EditorState {
    switch (action.type) {
      case "pointer-down": {
        return this.handlePointerDown(state, action);
      }
      case "pointer-move": {
        return this.handlePointerMove(state, action);
      }
      case "pointer-up": {
        return this.handlePointerUp(state, action);
      }
      case "key-down": {
        return this.handleKeyDown(state, action);
      }
      default: {
        return state;
      }
    }
  }

  /**
   * Handle pointer down - select shapes or start marquee
   */
  private handlePointerDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const hitShapeId = hitTestPoint(state, action.world);

    return hitShapeId ? this.handleShapeClick(state, hitShapeId, action) : this.handleEmptyClick(state, action);
  }

  /**
   * Handle clicking on a shape
   */
  private handleShapeClick(state: EditorState, shapeId: string, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const isShiftHeld = action.modifiers.shift;
    const isAlreadySelected = state.ui.selectionIds.includes(shapeId);

    let newSelectionIds: string[];

    if (isShiftHeld) {
      newSelectionIds = isAlreadySelected
        ? state.ui.selectionIds.filter((id) => id !== shapeId)
        : [...state.ui.selectionIds, shapeId];
    } else {
      newSelectionIds = isAlreadySelected ? state.ui.selectionIds : [shapeId];
    }

    this.toolState.isDragging = true;
    this.toolState.dragStartWorld = action.world;
    this.toolState.initialShapePositions.clear();

    for (const id of newSelectionIds) {
      const shape = state.doc.shapes[id];
      if (shape) {
        this.toolState.initialShapePositions.set(id, { x: shape.x, y: shape.y });
      }
    }

    return { ...state, ui: { ...state.ui, selectionIds: newSelectionIds } };
  }

  /**
   * Handle clicking on empty canvas - clear selection or start marquee
   */
  private handleEmptyClick(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const isShiftHeld = action.modifiers.shift;

    if (!isShiftHeld) {
      this.toolState.marqueeStart = action.world;
      this.toolState.marqueeEnd = action.world;

      return { ...state, ui: { ...state.ui, selectionIds: [] } };
    }

    return state;
  }

  /**
   * Handle pointer move - drag shapes or update marquee
   */
  private handlePointerMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move") return state;

    if (this.toolState.isDragging && this.toolState.dragStartWorld) {
      return this.handleDragMove(state, action);
    } else if (this.toolState.marqueeStart) {
      return this.handleMarqueeMove(state, action);
    }

    return state;
  }

  /**
   * Handle dragging selected shapes
   */
  private handleDragMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move" || !this.toolState.dragStartWorld) return state;

    const delta = Vec2.sub(action.world, this.toolState.dragStartWorld);

    const newShapes = { ...state.doc.shapes };

    for (const [shapeId, initialPos] of this.toolState.initialShapePositions) {
      const shape = newShapes[shapeId];
      if (shape) {
        newShapes[shapeId] = { ...shape, x: initialPos.x + delta.x, y: initialPos.y + delta.y };
      }
    }

    return { ...state, doc: { ...state.doc, shapes: newShapes } };
  }

  /**
   * Handle updating marquee selection
   */
  private handleMarqueeMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move") return state;

    this.toolState.marqueeEnd = action.world;

    return state;
  }

  /**
   * Handle pointer up - end drag or complete marquee selection
   */
  private handlePointerUp(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-up") return state;

    let newState = state;

    if (this.toolState.marqueeStart && this.toolState.marqueeEnd) {
      newState = this.completeMarqueeSelection(state);
    }

    this.toolState.isDragging = false;
    this.toolState.dragStartWorld = null;
    this.toolState.initialShapePositions.clear();
    this.toolState.marqueeStart = null;
    this.toolState.marqueeEnd = null;

    return newState;
  }

  /**
   * Complete marquee selection - select shapes whose bounds intersect the marquee
   */
  private completeMarqueeSelection(state: EditorState): EditorState {
    if (!this.toolState.marqueeStart || !this.toolState.marqueeEnd) return state;

    const marqueeBox = Box2.fromPoints([this.toolState.marqueeStart, this.toolState.marqueeEnd]);
    const currentPage = getCurrentPage(state);

    if (!currentPage) return state;

    const selectedIds: string[] = [];

    for (const shapeId of currentPage.shapeIds) {
      const shape = state.doc.shapes[shapeId];
      if (shape) {
        const bounds = shapeBounds(shape);
        if (Box2.intersectsBox(marqueeBox, bounds)) {
          selectedIds.push(shapeId);
        }
      }
    }

    return { ...state, ui: { ...state.ui, selectionIds: selectedIds } };
  }

  /**
   * Handle keyboard input - Escape to clear selection, Delete to remove shapes
   */
  private handleKeyDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "key-down") return state;

    if (action.key === "Escape") {
      return { ...state, ui: { ...state.ui, selectionIds: [] } };
    }

    if (action.key === "Delete" || action.key === "Backspace") {
      return this.deleteSelectedShapes(state);
    }

    return state;
  }

  /**
   * Delete all selected shapes
   */
  private deleteSelectedShapes(state: EditorState): EditorState {
    const shapesToDelete = new Set(state.ui.selectionIds);

    if (shapesToDelete.size === 0) return state;

    const newShapes = { ...state.doc.shapes };
    const newBindings = { ...state.doc.bindings };
    const newPages = { ...state.doc.pages };

    for (const shapeId of shapesToDelete) {
      delete newShapes[shapeId];
    }

    for (const [bindingId, binding] of Object.entries(newBindings)) {
      if (shapesToDelete.has(binding.fromShapeId) || shapesToDelete.has(binding.toShapeId)) {
        delete newBindings[bindingId];
      }
    }

    for (const [pageId, page] of Object.entries(newPages)) {
      const filteredShapeIds = page.shapeIds.filter((id) => !shapesToDelete.has(id));
      if (filteredShapeIds.length !== page.shapeIds.length) {
        newPages[pageId] = { ...page, shapeIds: filteredShapeIds };
      }
    }

    return {
      ...state,
      doc: { ...state.doc, shapes: newShapes, bindings: newBindings, pages: newPages },
      ui: { ...state.ui, selectionIds: [] },
    };
  }

  /**
   * Reset internal tool state
   */
  private resetToolState(): void {
    this.toolState = {
      isDragging: false,
      dragStartWorld: null,
      initialShapePositions: new Map(),
      marqueeStart: null,
      marqueeEnd: null,
    };
  }

  /**
   * Get current marquee bounds (for rendering)
   */
  getMarqueeBounds(): Box2 | null {
    if (!this.toolState.marqueeStart || !this.toolState.marqueeEnd) return null;
    return Box2.fromPoints([this.toolState.marqueeStart, this.toolState.marqueeEnd]);
  }
}

/**
 * Internal state for shape creation tools
 */
type ShapeCreationToolState = {
  /** Whether we're currently creating a shape */
  isCreating: boolean;
  /** World coordinates where creation started */
  startWorld: Vec2 | null;
  /** ID of the shape being created */
  creatingShapeId: string | null;
};

/**
 * Minimum size threshold for shapes (in world units)
 * Shapes smaller than this on either dimension will be deleted
 */
const MIN_SHAPE_SIZE = 5;

/**
 * Rect tool - creates rectangle shapes by dragging
 *
 * Features:
 * - Drag to create a rectangle from start point to current point
 * - Click-cancel: shapes too small are deleted on pointer up
 */
export class RectTool implements Tool {
  readonly id: ToolId = "rect";
  private toolState: ShapeCreationToolState;

  constructor() {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }

  onEnter(state: EditorState): EditorState {
    this.resetToolState();
    return state;
  }

  onExit(state: EditorState): EditorState {
    let newState = state;
    if (this.toolState.creatingShapeId) {
      newState = this.cancelShapeCreation(state);
    }
    this.resetToolState();
    return newState;
  }

  onAction(state: EditorState, action: Action): EditorState {
    switch (action.type) {
      case "pointer-down": {
        return this.handlePointerDown(state, action);
      }
      case "pointer-move": {
        return this.handlePointerMove(state, action);
      }
      case "pointer-up": {
        return this.handlePointerUp(state, action);
      }
      case "key-down": {
        return this.handleKeyDown(state, action);
      }
      default: {
        return state;
      }
    }
  }

  private handlePointerDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const shapeId = createId("shape");

    const shape = ShapeRecord.createRect(currentPage.id, action.world.x, action.world.y, {
      w: 0,
      h: 0,
      fill: "#4a90e2",
      stroke: "#2e5c8a",
      radius: 4,
    }, shapeId);

    this.toolState.isCreating = true;
    this.toolState.startWorld = action.world;
    this.toolState.creatingShapeId = shapeId;

    const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [shapeId]: shape },
        pages: { ...state.doc.pages, [currentPage.id]: newPage },
      },
      ui: { ...state.ui, selectionIds: [shapeId] },
    };
  }

  private handlePointerMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move" || !this.toolState.isCreating || !this.toolState.startWorld) return state;
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "rect") return state;

    const delta = Vec2.sub(action.world, this.toolState.startWorld);
    const w = Math.abs(delta.x);
    const h = Math.abs(delta.y);

    const x = delta.x < 0 ? this.toolState.startWorld.x - w : this.toolState.startWorld.x;
    const y = delta.y < 0 ? this.toolState.startWorld.y - h : this.toolState.startWorld.y;

    const updatedShape = { ...shape, x, y, props: { ...shape.props, w, h } };

    return {
      ...state,
      doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } },
    };
  }

  private handlePointerUp(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-up" || !this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "rect") return state;

    let newState = state;

    if (shape.props.w < MIN_SHAPE_SIZE || shape.props.h < MIN_SHAPE_SIZE) {
      newState = this.cancelShapeCreation(state);
    }

    this.resetToolState();
    return newState;
  }

  private handleKeyDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "key-down") return state;

    if (action.key === "Escape" && this.toolState.creatingShapeId) {
      const newState = this.cancelShapeCreation(state);
      this.resetToolState();
      return newState;
    }

    return state;
  }

  private cancelShapeCreation(state: EditorState): EditorState {
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape) return state;

    const newShapes = { ...state.doc.shapes };
    delete newShapes[this.toolState.creatingShapeId];

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const newPage = {
      ...currentPage,
      shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId),
    };

    return {
      ...state,
      doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
      ui: { ...state.ui, selectionIds: [] },
    };
  }

  private resetToolState(): void {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }
}

/**
 * Ellipse tool - creates ellipse shapes by dragging
 *
 * Features:
 * - Drag to create an ellipse from start point to current point
 * - Click-cancel: shapes too small are deleted on pointer up
 */
export class EllipseTool implements Tool {
  readonly id: ToolId = "ellipse";
  private toolState: ShapeCreationToolState;

  constructor() {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }

  onEnter(state: EditorState): EditorState {
    this.resetToolState();
    return state;
  }

  onExit(state: EditorState): EditorState {
    let newState = state;
    if (this.toolState.creatingShapeId) {
      newState = this.cancelShapeCreation(state);
    }
    this.resetToolState();
    return newState;
  }

  onAction(state: EditorState, action: Action): EditorState {
    switch (action.type) {
      case "pointer-down": {
        return this.handlePointerDown(state, action);
      }
      case "pointer-move": {
        return this.handlePointerMove(state, action);
      }
      case "pointer-up": {
        return this.handlePointerUp(state, action);
      }
      case "key-down": {
        return this.handleKeyDown(state, action);
      }
      default: {
        return state;
      }
    }
  }

  private handlePointerDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const shapeId = createId("shape");

    const shape = ShapeRecord.createEllipse(currentPage.id, action.world.x, action.world.y, {
      w: 0,
      h: 0,
      fill: "#51cf66",
      stroke: "#2f9e44",
    }, shapeId);

    this.toolState.isCreating = true;
    this.toolState.startWorld = action.world;
    this.toolState.creatingShapeId = shapeId;

    const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [shapeId]: shape },
        pages: { ...state.doc.pages, [currentPage.id]: newPage },
      },
      ui: { ...state.ui, selectionIds: [shapeId] },
    };
  }

  private handlePointerMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move" || !this.toolState.isCreating || !this.toolState.startWorld) return state;
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "ellipse") return state;

    const delta = Vec2.sub(action.world, this.toolState.startWorld);
    const w = Math.abs(delta.x);
    const h = Math.abs(delta.y);

    const x = delta.x < 0 ? this.toolState.startWorld.x - w : this.toolState.startWorld.x;
    const y = delta.y < 0 ? this.toolState.startWorld.y - h : this.toolState.startWorld.y;

    const updatedShape = { ...shape, x, y, props: { ...shape.props, w, h } };

    return {
      ...state,
      doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } },
    };
  }

  private handlePointerUp(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-up" || !this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "ellipse") return state;

    let newState = state;

    if (shape.props.w < MIN_SHAPE_SIZE || shape.props.h < MIN_SHAPE_SIZE) {
      newState = this.cancelShapeCreation(state);
    }

    this.resetToolState();
    return newState;
  }

  private handleKeyDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "key-down") return state;

    if (action.key === "Escape" && this.toolState.creatingShapeId) {
      const newState = this.cancelShapeCreation(state);
      this.resetToolState();
      return newState;
    }

    return state;
  }

  private cancelShapeCreation(state: EditorState): EditorState {
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape) return state;

    const newShapes = { ...state.doc.shapes };
    delete newShapes[this.toolState.creatingShapeId];

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const newPage = {
      ...currentPage,
      shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId),
    };

    return {
      ...state,
      doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
      ui: { ...state.ui, selectionIds: [] },
    };
  }

  private resetToolState(): void {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }
}

/**
 * Line tool - creates line shapes by dragging
 *
 * Features:
 * - Drag to create a line from start point (a) to current point (b)
 * - Click-cancel: very short lines are deleted on pointer up
 */
export class LineTool implements Tool {
  readonly id: ToolId = "line";
  private toolState: ShapeCreationToolState;

  constructor() {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }

  onEnter(state: EditorState): EditorState {
    this.resetToolState();
    return state;
  }

  onExit(state: EditorState): EditorState {
    let newState = state;
    if (this.toolState.creatingShapeId) {
      newState = this.cancelShapeCreation(state);
    }
    this.resetToolState();
    return newState;
  }

  onAction(state: EditorState, action: Action): EditorState {
    switch (action.type) {
      case "pointer-down": {
        return this.handlePointerDown(state, action);
      }
      case "pointer-move": {
        return this.handlePointerMove(state, action);
      }
      case "pointer-up": {
        return this.handlePointerUp(state, action);
      }
      case "key-down": {
        return this.handleKeyDown(state, action);
      }
      default: {
        return state;
      }
    }
  }

  private handlePointerDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const shapeId = createId("shape");

    const shape = ShapeRecord.createLine(currentPage.id, action.world.x, action.world.y, {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 0 },
      stroke: "#495057",
      width: 2,
    }, shapeId);

    this.toolState.isCreating = true;
    this.toolState.startWorld = action.world;
    this.toolState.creatingShapeId = shapeId;

    const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [shapeId]: shape },
        pages: { ...state.doc.pages, [currentPage.id]: newPage },
      },
      ui: { ...state.ui, selectionIds: [shapeId] },
    };
  }

  private handlePointerMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move" || !this.toolState.isCreating || !this.toolState.startWorld) return state;
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "line") return state;

    const b = Vec2.sub(action.world, this.toolState.startWorld);
    const updatedShape = { ...shape, props: { ...shape.props, b } };

    return {
      ...state,
      doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } },
    };
  }

  private handlePointerUp(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-up" || !this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "line") return state;

    let newState = state;

    const lineLength = Vec2.len(shape.props.b);
    if (lineLength < MIN_SHAPE_SIZE) {
      newState = this.cancelShapeCreation(state);
    }

    this.resetToolState();
    return newState;
  }

  private handleKeyDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "key-down") return state;

    if (action.key === "Escape" && this.toolState.creatingShapeId) {
      const newState = this.cancelShapeCreation(state);
      this.resetToolState();
      return newState;
    }

    return state;
  }

  private cancelShapeCreation(state: EditorState): EditorState {
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape) return state;

    const newShapes = { ...state.doc.shapes };
    delete newShapes[this.toolState.creatingShapeId];

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const newPage = {
      ...currentPage,
      shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId),
    };

    return {
      ...state,
      doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
      ui: { ...state.ui, selectionIds: [] },
    };
  }

  private resetToolState(): void {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }
}

/**
 * Arrow tool - creates arrow shapes by dragging
 *
 * Features:
 * - Drag to create an arrow from start point (a) to current point (b)
 * - Click-cancel: very short arrows are deleted on pointer up
 */
export class ArrowTool implements Tool {
  readonly id: ToolId = "arrow";
  private toolState: ShapeCreationToolState;

  constructor() {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }

  onEnter(state: EditorState): EditorState {
    this.resetToolState();
    return state;
  }

  onExit(state: EditorState): EditorState {
    let newState = state;
    if (this.toolState.creatingShapeId) {
      newState = this.cancelShapeCreation(state);
    }
    this.resetToolState();
    return newState;
  }

  onAction(state: EditorState, action: Action): EditorState {
    switch (action.type) {
      case "pointer-down": {
        return this.handlePointerDown(state, action);
      }
      case "pointer-move": {
        return this.handlePointerMove(state, action);
      }
      case "pointer-up": {
        return this.handlePointerUp(state, action);
      }
      case "key-down": {
        return this.handleKeyDown(state, action);
      }
      default: {
        return state;
      }
    }
  }

  private handlePointerDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const shapeId = createId("shape");

    const shape = ShapeRecord.createArrow(currentPage.id, action.world.x, action.world.y, {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 0 },
      stroke: "#495057",
      width: 2,
    }, shapeId);

    this.toolState.isCreating = true;
    this.toolState.startWorld = action.world;
    this.toolState.creatingShapeId = shapeId;

    const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [shapeId]: shape },
        pages: { ...state.doc.pages, [currentPage.id]: newPage },
      },
      ui: { ...state.ui, selectionIds: [shapeId] },
    };
  }

  private handlePointerMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move" || !this.toolState.isCreating || !this.toolState.startWorld) return state;
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "arrow") return state;

    const b = Vec2.sub(action.world, this.toolState.startWorld);
    const updatedShape = { ...shape, props: { ...shape.props, b } };

    return {
      ...state,
      doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } },
    };
  }

  private handlePointerUp(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-up" || !this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape || shape.type !== "arrow") return state;

    let newState = state;

    const arrowLength = Vec2.len(shape.props.b);
    if (arrowLength < MIN_SHAPE_SIZE) {
      newState = this.cancelShapeCreation(state);
    } else {
      newState = this.createBindingsForArrow(state, this.toolState.creatingShapeId);
    }

    this.resetToolState();
    return newState;
  }

  /**
   * Create bindings for arrow endpoints that hit other shapes
   */
  private createBindingsForArrow(state: EditorState, arrowId: string): EditorState {
    const arrow = state.doc.shapes[arrowId];
    if (!arrow || arrow.type !== "arrow") return state;

    const startWorld = { x: arrow.x + arrow.props.a.x, y: arrow.y + arrow.props.a.y };
    const endWorld = { x: arrow.x + arrow.props.b.x, y: arrow.y + arrow.props.b.y };

    const newBindings = { ...state.doc.bindings };

    const stateWithoutArrow = {
      ...state,
      doc: {
        ...state.doc,
        shapes: Object.fromEntries(Object.entries(state.doc.shapes).filter(([id]) => id !== arrowId)),
      },
    };

    const startHitId = hitTestPoint(stateWithoutArrow, startWorld);
    if (startHitId) {
      const binding = BindingRecord.create(arrowId, startHitId, "start");
      newBindings[binding.id] = binding;
    }

    const endHitId = hitTestPoint(stateWithoutArrow, endWorld);
    if (endHitId) {
      const binding = BindingRecord.create(arrowId, endHitId, "end");
      newBindings[binding.id] = binding;
    }

    return { ...state, doc: { ...state.doc, bindings: newBindings } };
  }

  private handleKeyDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "key-down") return state;

    if (action.key === "Escape" && this.toolState.creatingShapeId) {
      const newState = this.cancelShapeCreation(state);
      this.resetToolState();
      return newState;
    }

    return state;
  }

  private cancelShapeCreation(state: EditorState): EditorState {
    if (!this.toolState.creatingShapeId) return state;

    const shape = state.doc.shapes[this.toolState.creatingShapeId];
    if (!shape) return state;

    const newShapes = { ...state.doc.shapes };
    delete newShapes[this.toolState.creatingShapeId];

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const newPage = {
      ...currentPage,
      shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId),
    };

    return {
      ...state,
      doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
      ui: { ...state.ui, selectionIds: [] },
    };
  }

  private resetToolState(): void {
    this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
  }
}

/**
 * Text tool - creates text shapes on click
 *
 * Features:
 * - Click to create a text shape at the pointer position
 * - Text is created with default content "Text"
 * - Shape is immediately selected after creation
 */
export class TextTool implements Tool {
  readonly id: ToolId = "text";

  onEnter(state: EditorState): EditorState {
    return state;
  }

  onExit(state: EditorState): EditorState {
    return state;
  }

  onAction(state: EditorState, action: Action): EditorState {
    switch (action.type) {
      case "pointer-down": {
        return this.handlePointerDown(state, action);
      }
      default: {
        return state;
      }
    }
  }

  private handlePointerDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-down") return state;

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const shapeId = createId("shape");

    const shape = ShapeRecord.createText(currentPage.id, action.world.x, action.world.y, {
      text: "Text",
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#000000",
    }, shapeId);

    const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [shapeId]: shape },
        pages: { ...state.doc.pages, [currentPage.id]: newPage },
      },
      ui: { ...state.ui, selectionIds: [shapeId] },
    };
  }
}
