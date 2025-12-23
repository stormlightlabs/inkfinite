import type { Action } from "../actions";
import { hitTestPoint, shapeBounds } from "../geom";
import { Box2, type Vec2, Vec2 as Vec2Ops } from "../math";
import { ShapeRecord } from "../model";
import { EditorState, getCurrentPage, type ToolId } from "../reactivity";
import type { Tool } from "./base";

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
  /** Active resize/rotate handle identifier */
  activeHandle: HandleKind | null;
  /** Shape being manipulated by handle */
  handleShapeId: string | null;
  /** Bounds snapshot at the time handle drag started */
  handleStartBounds: Box2 | null;
  /** Initial shapes snapshot for handle drags */
  handleInitialShapes: Map<string, ShapeRecord>;
  /** Rotation pivot in world coordinates */
  rotationCenter: Vec2 | null;
  /** Starting angle for rotation handle */
  rotationStartAngle: number | null;
};

type RectHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type HandleKind = RectHandle | "rotate" | "line-start" | "line-end";

const HANDLE_HIT_RADIUS = 10;
const ROTATE_HANDLE_OFFSET = 40;
const MIN_RESIZE_SIZE = 5;

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
  private readonly marqueeListener?: (bounds: Box2 | null) => void;

  constructor(onMarqueeChange?: (bounds: Box2 | null) => void) {
    this.marqueeListener = onMarqueeChange;
    this.toolState = {
      isDragging: false,
      dragStartWorld: null,
      initialShapePositions: new Map(),
      marqueeStart: null,
      marqueeEnd: null,
      activeHandle: null,
      handleShapeId: null,
      handleStartBounds: null,
      handleInitialShapes: new Map(),
      rotationCenter: null,
      rotationStartAngle: null,
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

    const handleHit = this.hitTestHandle(state, action.world);
    if (handleHit) {
      return this.beginHandleDrag(state, handleHit.shape, handleHit.handle, action.world);
    }

    const hitShapeId = hitTestPoint(state, action.world);

    return hitShapeId ? this.handleShapeClick(state, hitShapeId, action) : this.handleEmptyClick(state, action);
  }

  private hitTestHandle(state: EditorState, point: Vec2): { handle: HandleKind; shape: ShapeRecord } | null {
    if (state.ui.selectionIds.length !== 1) {
      return null;
    }
    const shapeId = state.ui.selectionIds[0];
    const shape = state.doc.shapes[shapeId];
    if (!shape) {
      return null;
    }
    const handles = this.getHandlePositions(shape);
    for (const handle of handles) {
      if (Vec2Ops.dist(point, handle.position) <= HANDLE_HIT_RADIUS) {
        return { handle: handle.id, shape };
      }
    }
    return null;
  }

  private beginHandleDrag(state: EditorState, shape: ShapeRecord, handle: HandleKind, point: Vec2): EditorState {
    this.toolState.activeHandle = handle;
    this.toolState.handleShapeId = shape.id;
    this.toolState.handleStartBounds = shapeBounds(shape);
    this.toolState.handleInitialShapes.clear();
    this.toolState.handleInitialShapes.set(shape.id, ShapeRecord.clone(shape));
    this.toolState.isDragging = false;
    this.toolState.dragStartWorld = point;
    const bounds = this.toolState.handleStartBounds;
    this.toolState.rotationCenter = bounds
      ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 }
      : null;
    this.toolState.rotationStartAngle = this.toolState.rotationCenter
      ? Math.atan2(point.y - this.toolState.rotationCenter.y, point.x - this.toolState.rotationCenter.x)
      : null;
    return state;
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
      this.notifyMarqueeChange();

      return { ...state, ui: { ...state.ui, selectionIds: [] } };
    }

    return state;
  }

  /**
   * Handle pointer move - drag shapes or update marquee
   */
  private handlePointerMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move") return state;

    if (this.toolState.activeHandle && this.toolState.handleShapeId) {
      return this.handleHandleDrag(state, action);
    }

    if (this.toolState.isDragging && this.toolState.dragStartWorld) {
      return this.handleDragMove(state, action);
    } else if (this.toolState.marqueeStart) {
      return this.handleMarqueeMove(state, action);
    }

    return state;
  }

  private handleHandleDrag(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move" || !this.toolState.handleShapeId || !this.toolState.activeHandle) {
      return state;
    }
    const shapeId = this.toolState.handleShapeId;
    const currentShape = state.doc.shapes[shapeId];
    const initialShape = this.toolState.handleInitialShapes.get(shapeId);
    if (!currentShape || !initialShape) {
      return state;
    }

    let updated: ShapeRecord | null = null;
    if (this.toolState.activeHandle === "rotate") {
      updated = this.rotateShape(initialShape, action.world);
    } else if (this.toolState.activeHandle === "line-start" || this.toolState.activeHandle === "line-end") {
      updated = this.resizeLineShape(initialShape, action.world, this.toolState.activeHandle);
    } else if (this.toolState.handleStartBounds) {
      updated = this.resizeRectLikeShape(
        initialShape,
        this.toolState.handleStartBounds,
        action.world,
        this.toolState.activeHandle,
      );
    }

    if (!updated) {
      return state;
    }

    return { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [shapeId]: updated } } };
  }

  /**
   * Handle dragging selected shapes
   */
  private handleDragMove(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-move" || !this.toolState.dragStartWorld) return state;

    const delta = Vec2Ops.sub(action.world, this.toolState.dragStartWorld);

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
    this.notifyMarqueeChange();

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

    this.toolState.activeHandle = null;
    this.toolState.handleShapeId = null;
    this.toolState.handleStartBounds = null;
    this.toolState.handleInitialShapes.clear();
    this.toolState.rotationCenter = null;
    this.toolState.rotationStartAngle = null;
    this.toolState.isDragging = false;
    this.toolState.dragStartWorld = null;
    this.toolState.initialShapePositions.clear();
    this.toolState.marqueeStart = null;
    this.toolState.marqueeEnd = null;
    this.notifyMarqueeChange();

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
      activeHandle: null,
      handleShapeId: null,
      handleStartBounds: null,
      handleInitialShapes: new Map(),
      rotationCenter: null,
      rotationStartAngle: null,
    };
    this.notifyMarqueeChange();
  }

  /**
   * Get current marquee bounds (for rendering)
   */
  getMarqueeBounds(): Box2 | null {
    if (!this.toolState.marqueeStart || !this.toolState.marqueeEnd) return null;
    return Box2.fromPoints([this.toolState.marqueeStart, this.toolState.marqueeEnd]);
  }

  private notifyMarqueeChange(): void {
    if (this.marqueeListener) {
      this.marqueeListener(this.getMarqueeBounds());
    }
  }

  getHandleAtPoint(state: EditorState, point: Vec2): HandleKind | null {
    const hit = this.hitTestHandle(state, point);
    return hit?.handle ?? null;
  }

  getActiveHandle(): HandleKind | null {
    return this.toolState.activeHandle;
  }

  private getHandlePositions(shape: ShapeRecord): Array<{ id: HandleKind; position: Vec2 }> {
    const handles: Array<{ id: HandleKind; position: Vec2 }> = [];
    if (shape.type === "rect" || shape.type === "ellipse" || shape.type === "text") {
      const bounds = shapeBounds(shape);
      const minX = bounds.min.x;
      const maxX = bounds.max.x;
      const minY = bounds.min.y;
      const maxY = bounds.max.y;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      handles.push(
        { id: "nw", position: { x: minX, y: minY } },
        { id: "n", position: { x: centerX, y: minY } },
        { id: "ne", position: { x: maxX, y: minY } },
        { id: "e", position: { x: maxX, y: centerY } },
        { id: "se", position: { x: maxX, y: maxY } },
        { id: "s", position: { x: centerX, y: maxY } },
        { id: "sw", position: { x: minX, y: maxY } },
        { id: "w", position: { x: minX, y: centerY } },
        { id: "rotate", position: { x: centerX, y: minY - ROTATE_HANDLE_OFFSET } },
      );
    } else if (shape.type === "line" || shape.type === "arrow") {
      const start = this.localToWorld(shape, shape.props.a);
      const end = this.localToWorld(shape, shape.props.b);
      handles.push({ id: "line-start", position: start }, { id: "line-end", position: end });
    }
    return handles;
  }

  private resizeRectLikeShape(
    initial: ShapeRecord,
    bounds: Box2,
    pointer: Vec2,
    handle: HandleKind,
  ): ShapeRecord | null {
    if (initial.type !== "rect" && initial.type !== "ellipse" && initial.type !== "text") {
      return null;
    }
    let minX = bounds.min.x;
    let maxX = bounds.max.x;
    let minY = bounds.min.y;
    let maxY = bounds.max.y;

    const clampX = (value: number) => Math.min(Math.max(value, -1e6), 1e6);
    const clampY = (value: number) => Math.min(Math.max(value, -1e6), 1e6);

    switch (handle) {
      case "nw": {
        minX = Math.min(clampX(pointer.x), maxX - MIN_RESIZE_SIZE);
        minY = Math.min(clampY(pointer.y), maxY - MIN_RESIZE_SIZE);
        break;
      }
      case "n": {
        minY = Math.min(clampY(pointer.y), maxY - MIN_RESIZE_SIZE);
        break;
      }
      case "ne": {
        maxX = Math.max(clampX(pointer.x), minX + MIN_RESIZE_SIZE);
        minY = Math.min(clampY(pointer.y), maxY - MIN_RESIZE_SIZE);
        break;
      }
      case "e": {
        maxX = Math.max(clampX(pointer.x), minX + MIN_RESIZE_SIZE);
        break;
      }
      case "se": {
        maxX = Math.max(clampX(pointer.x), minX + MIN_RESIZE_SIZE);
        maxY = Math.max(clampY(pointer.y), minY + MIN_RESIZE_SIZE);
        break;
      }
      case "s": {
        maxY = Math.max(clampY(pointer.y), minY + MIN_RESIZE_SIZE);
        break;
      }
      case "sw": {
        minX = Math.min(clampX(pointer.x), maxX - MIN_RESIZE_SIZE);
        maxY = Math.max(clampY(pointer.y), minY + MIN_RESIZE_SIZE);
        break;
      }
      case "w": {
        minX = Math.min(clampX(pointer.x), maxX - MIN_RESIZE_SIZE);
        break;
      }
    }

    const width = Math.max(maxX - minX, MIN_RESIZE_SIZE);
    const height = Math.max(maxY - minY, MIN_RESIZE_SIZE);

    if (initial.type === "text") {
      return { ...initial, x: minX, y: minY, props: { ...initial.props, w: width } };
    }

    // @ts-expect-error union mismatch
    return { ...initial, x: minX, y: minY, props: { ...initial.props, w: width, h: height } };
  }

  private resizeLineShape(initial: ShapeRecord, pointer: Vec2, handle: "line-start" | "line-end"): ShapeRecord | null {
    if (initial.type !== "line" && initial.type !== "arrow") {
      return null;
    }
    const startWorld = this.localToWorld(initial, initial.props.a);
    const endWorld = this.localToWorld(initial, initial.props.b);
    const newStart = handle === "line-start" ? pointer : startWorld;
    const newEnd = handle === "line-end" ? pointer : endWorld;
    const newProps = { ...initial.props, a: { x: 0, y: 0 }, b: { x: newEnd.x - newStart.x, y: newEnd.y - newStart.y } };
    return { ...initial, x: newStart.x, y: newStart.y, props: newProps };
  }

  private rotateShape(initial: ShapeRecord, pointer: Vec2): ShapeRecord | null {
    if (!this.toolState.rotationCenter || this.toolState.rotationStartAngle === null) {
      return null;
    }
    if (initial.type !== "rect" && initial.type !== "ellipse" && initial.type !== "text") {
      return null;
    }
    const currentAngle = Math.atan2(
      pointer.y - this.toolState.rotationCenter.y,
      pointer.x - this.toolState.rotationCenter.x,
    );
    const delta = currentAngle - this.toolState.rotationStartAngle;
    return { ...initial, rot: initial.rot + delta };
  }

  private localToWorld(shape: ShapeRecord, point: Vec2): Vec2 {
    if (shape.rot === 0) {
      return { x: shape.x + point.x, y: shape.y + point.y };
    }
    const cos = Math.cos(shape.rot);
    const sin = Math.sin(shape.rot);
    return { x: shape.x + point.x * cos - point.y * sin, y: shape.y + point.x * sin + point.y * cos };
  }
}
