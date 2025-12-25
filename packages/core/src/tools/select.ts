import type { Action } from "../actions";
import { computeNormalizedAnchor, computePolylineLength, getPointAtDistance, hitTestPoint, shapeBounds } from "../geom";
import { Box2, type Vec2, Vec2 as Vec2Ops } from "../math";
import { BindingRecord, ShapeRecord } from "../model";
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

type HandleKind = RectHandle | "rotate" | "line-start" | "line-end" | `arrow-point-${number}` | "arrow-label";

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

    if (action.modifiers.alt && state.ui.selectionIds.length === 1) {
      const shapeId = state.ui.selectionIds[0];
      const shape = state.doc.shapes[shapeId];
      if (shape?.type === "arrow") {
        const result = this.tryAddPointToArrowSegment(state, shape, action.world);
        if (result) {
          return result;
        }
      }
    }

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
    } else if (this.toolState.activeHandle === "arrow-label") {
      updated = this.adjustArrowLabel(initialShape, action.world);
    } else if (
      this.toolState.activeHandle === "line-start"
      || this.toolState.activeHandle === "line-end"
      || this.toolState.activeHandle.startsWith("arrow-point-")
    ) {
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

    let newState = { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [shapeId]: updated } } };

    if (
      currentShape.type === "arrow"
      && (this.toolState.activeHandle === "line-start" || this.toolState.activeHandle === "line-end")
    ) {
      const handle = this.toolState.activeHandle === "line-start" ? "start" : "end";

      const stateWithoutArrow = {
        ...newState,
        doc: {
          ...newState.doc,
          shapes: Object.fromEntries(Object.entries(newState.doc.shapes).filter(([id]) => id !== shapeId)),
        },
      };

      const hitShapeId = hitTestPoint(stateWithoutArrow, action.world);

      if (hitShapeId) {
        newState = {
          ...newState,
          ui: { ...newState.ui, bindingPreview: { arrowId: shapeId, targetShapeId: hitShapeId, handle } },
        };
      } else {
        newState = { ...newState, ui: { ...newState.ui, bindingPreview: undefined } };
      }
    }

    return newState;
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

    if (
      this.toolState.handleShapeId
      && (this.toolState.activeHandle === "line-start" || this.toolState.activeHandle === "line-end")
    ) {
      newState = this.updateArrowBindings(newState, this.toolState.handleShapeId, action.world);
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

    if (newState.ui.bindingPreview) {
      newState = { ...newState, ui: { ...newState.ui, bindingPreview: undefined } };
    }

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
      if (
        this.toolState.activeHandle
        && typeof this.toolState.activeHandle === "string"
        && this.toolState.activeHandle.startsWith("arrow-point-")
        && this.toolState.handleShapeId
      ) {
        return this.removeArrowPoint(state, this.toolState.handleShapeId, this.toolState.activeHandle);
      }

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
    } else if (shape.type === "line") {
      const start = this.localToWorld(shape, shape.props.a);
      const end = this.localToWorld(shape, shape.props.b);
      handles.push({ id: "line-start", position: start }, { id: "line-end", position: end });
    } else if (shape.type === "arrow") {
      if (shape.props.points && shape.props.points.length >= 2) {
        for (let i = 0; i < shape.props.points.length; i++) {
          const point = shape.props.points[i];
          const worldPos = this.localToWorld(shape, point);

          if (i === 0) {
            handles.push({ id: "line-start", position: worldPos });
          } else if (i === shape.props.points.length - 1) {
            handles.push({ id: "line-end", position: worldPos });
          } else {
            handles.push({ id: `arrow-point-${i}` as HandleKind, position: worldPos });
          }
        }

        if (shape.props.label) {
          const polylineLength = computePolylineLength(shape.props.points);
          const align = shape.props.label.align ?? "center";
          const offset = shape.props.label.offset ?? 0;

          let distance: number;
          if (align === "center") {
            distance = polylineLength / 2 + offset;
          } else if (align === "start") {
            distance = offset;
          } else {
            distance = polylineLength - offset;
          }

          distance = Math.max(0, Math.min(distance, polylineLength));
          const labelPos = getPointAtDistance(shape.props.points, distance);
          const worldLabelPos = this.localToWorld(shape, labelPos);
          handles.push({ id: "arrow-label", position: worldLabelPos });
        }
      }
    }
    return handles;
  }

  private resizeRectLikeShape(
    initial: ShapeRecord,
    bounds: Box2,
    pointer: Vec2,
    handle: HandleKind,
  ): ShapeRecord | null {
    if (
      initial.type !== "rect" && initial.type !== "ellipse" && initial.type !== "text" && initial.type !== "markdown"
    ) {
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

    if (initial.type === "markdown") {
      return { ...initial, x: minX, y: minY, props: { ...initial.props, w: width, h: height } };
    }

    // @ts-expect-error union mismatch
    return { ...initial, x: minX, y: minY, props: { ...initial.props, w: width, h: height } };
  }

  private adjustArrowLabel(initial: ShapeRecord, pointer: Vec2): ShapeRecord | null {
    if (initial.type !== "arrow" || !initial.props.points || initial.props.points.length < 2 || !initial.props.label) {
      return null;
    }

    const localPointer = this.worldToLocal(initial, pointer);
    const points = initial.props.points;
    const polylineLength = computePolylineLength(points);

    let closestDistance = 0;
    let minDistToLine = Number.POSITIVE_INFINITY;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const segmentLength = Vec2Ops.dist(a, b);

      const ab = Vec2Ops.sub(b, a);
      const ap = Vec2Ops.sub(localPointer, a);
      const t = Math.max(0, Math.min(1, Vec2Ops.dot(ap, ab) / Vec2Ops.dot(ab, ab)));
      const projection = Vec2Ops.add(a, Vec2Ops.mulScalar(ab, t));
      const distToLine = Vec2Ops.dist(localPointer, projection);

      if (distToLine < minDistToLine) {
        minDistToLine = distToLine;
        let distanceToSegmentStart = 0;
        for (let j = 0; j < i; j++) {
          distanceToSegmentStart += Vec2Ops.dist(points[j], points[j + 1]);
        }
        closestDistance = distanceToSegmentStart + t * segmentLength;
      }
    }

    const align = initial.props.label.align ?? "center";
    let newOffset: number;

    if (align === "center") {
      newOffset = closestDistance - polylineLength / 2;
    } else if (align === "start") {
      newOffset = closestDistance;
    } else {
      newOffset = polylineLength - closestDistance;
    }

    return { ...initial, props: { ...initial.props, label: { ...initial.props.label, offset: newOffset } } };
  }

  private resizeLineShape(initial: ShapeRecord, pointer: Vec2, handle: HandleKind): ShapeRecord | null {
    if (initial.type !== "line" && initial.type !== "arrow") {
      return null;
    }

    if (initial.type === "arrow" && typeof handle === "string" && handle.startsWith("arrow-point-")) {
      const pointIndex = Number.parseInt(handle.replace("arrow-point-", ""), 10);
      if (!initial.props.points || pointIndex < 1 || pointIndex >= initial.props.points.length - 1) {
        return null;
      }

      const newPoints = initial.props.points.map((p, i) => {
        if (i === pointIndex) {
          return { x: pointer.x - initial.x, y: pointer.y - initial.y };
        }
        return p;
      });

      const newProps = { ...initial.props, points: newPoints };
      return { ...initial, props: newProps };
    }

    if (handle !== "line-start" && handle !== "line-end") {
      return null;
    }

    let startPoint: Vec2, endPoint: Vec2;

    if (initial.type === "line") {
      startPoint = initial.props.a;
      endPoint = initial.props.b;
    } else {
      if (!initial.props.points || initial.props.points.length < 2) {
        return null;
      }
      startPoint = initial.props.points[0];
      endPoint = initial.props.points[initial.props.points.length - 1];
    }

    const startWorld = this.localToWorld(initial, startPoint);
    const endWorld = this.localToWorld(initial, endPoint);
    const newStart = handle === "line-start" ? pointer : startWorld;
    const newEnd = handle === "line-end" ? pointer : endWorld;

    if (initial.type === "line") {
      const newProps = {
        ...initial.props,
        a: { x: 0, y: 0 },
        b: { x: newEnd.x - newStart.x, y: newEnd.y - newStart.y },
      };
      return { ...initial, x: newStart.x, y: newStart.y, props: newProps };
    } else {
      const newPoints = initial.props.points.map((p, i) => {
        if (i === 0) {
          return { x: 0, y: 0 };
        } else if (i === initial.props.points.length - 1) {
          return { x: newEnd.x - newStart.x, y: newEnd.y - newStart.y };
        } else {
          const worldPos = this.localToWorld(initial, p);
          return { x: worldPos.x - newStart.x, y: worldPos.y - newStart.y };
        }
      });

      const newProps = { ...initial.props, points: newPoints };
      return { ...initial, x: newStart.x, y: newStart.y, props: newProps };
    }
  }

  private rotateShape(initial: ShapeRecord, pointer: Vec2): ShapeRecord | null {
    if (!this.toolState.rotationCenter || this.toolState.rotationStartAngle === null) {
      return null;
    }
    if (
      initial.type !== "rect" && initial.type !== "ellipse" && initial.type !== "text" && initial.type !== "markdown"
    ) {
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

  private worldToLocal(shape: ShapeRecord, point: Vec2): Vec2 {
    if (shape.rot === 0) {
      return { x: point.x - shape.x, y: point.y - shape.y };
    }
    const dx = point.x - shape.x;
    const dy = point.y - shape.y;
    const cos = Math.cos(-shape.rot);
    const sin = Math.sin(-shape.rot);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }

  /**
   * Remove an intermediate point from an arrow
   */
  private removeArrowPoint(state: EditorState, arrowId: string, handle: HandleKind): EditorState {
    const arrow = state.doc.shapes[arrowId];
    if (!arrow || arrow.type !== "arrow" || !arrow.props.points) {
      return state;
    }

    const pointIndex = Number.parseInt((handle as string).replace("arrow-point-", ""), 10);
    if (Number.isNaN(pointIndex) || pointIndex < 1 || pointIndex >= arrow.props.points.length - 1) {
      return state;
    }

    const newPoints = arrow.props.points.filter((_, i) => i !== pointIndex);

    if (newPoints.length < 2) {
      return state;
    }

    const updatedArrow = { ...arrow, props: { ...arrow.props, points: newPoints } };

    this.resetToolState();

    return { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [arrowId]: updatedArrow } } };
  }

  /**
   * Try to add a point to an arrow segment at the clicked location
   * Returns updated state if successful, null otherwise
   */
  private tryAddPointToArrowSegment(state: EditorState, arrow: ShapeRecord, clickWorld: Vec2): EditorState | null {
    if (arrow.type !== "arrow" || !arrow.props.points || arrow.props.points.length < 2) {
      return null;
    }

    const clickLocal = { x: clickWorld.x - arrow.x, y: clickWorld.y - arrow.y };
    const tolerance = 10;

    for (let i = 0; i < arrow.props.points.length - 1; i++) {
      const a = arrow.props.points[i];
      const b = arrow.props.points[i + 1];

      const ab = Vec2Ops.sub(b, a);
      const ap = Vec2Ops.sub(clickLocal, a);
      const abLengthSq = Vec2Ops.lenSq(ab);

      if (abLengthSq === 0) continue;

      const t = Math.max(0, Math.min(1, Vec2Ops.dot(ap, ab) / abLengthSq));
      const projection = Vec2Ops.add(a, Vec2Ops.mulScalar(ab, t));
      const distance = Vec2Ops.dist(clickLocal, projection);

      if (distance <= tolerance) {
        const newPoints = [...arrow.props.points.slice(0, i + 1), clickLocal, ...arrow.props.points.slice(i + 1)];

        const updatedArrow = { ...arrow, props: { ...arrow.props, points: newPoints } };
        return { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [arrow.id]: updatedArrow } } };
      }
    }

    return null;
  }

  /**
   * Update arrow bindings when an endpoint is dragged
   *
   * Creates or updates bindings for arrow endpoints based on hit testing.
   * If the endpoint is over a shape, creates/updates an edge anchor binding.
   * If the endpoint is not over a shape, removes any existing binding.
   */
  private updateArrowBindings(state: EditorState, arrowId: string, endpointWorld: Vec2): EditorState {
    const arrow = state.doc.shapes[arrowId];
    if (!arrow || arrow.type !== "arrow") return state;

    const handle = this.toolState.activeHandle === "line-start" ? "start" : "end";

    const stateWithoutArrow = {
      ...state,
      doc: {
        ...state.doc,
        shapes: Object.fromEntries(Object.entries(state.doc.shapes).filter(([id]) => id !== arrowId)),
      },
    };

    const hitShapeId = hitTestPoint(stateWithoutArrow, endpointWorld);

    const newBindings = { ...state.doc.bindings };

    for (const [bindingId, binding] of Object.entries(newBindings)) {
      if (binding.fromShapeId === arrowId && binding.handle === handle) {
        delete newBindings[bindingId];
      }
    }

    if (hitShapeId) {
      const targetShape = state.doc.shapes[hitShapeId];
      if (targetShape) {
        const anchor = computeNormalizedAnchor(endpointWorld, targetShape);
        const binding = BindingRecord.create(arrowId, hitShapeId, handle, {
          kind: "edge",
          nx: anchor.nx,
          ny: anchor.ny,
        });
        newBindings[binding.id] = binding;
      }
    }

    return { ...state, doc: { ...state.doc, bindings: newBindings } };
  }
}
