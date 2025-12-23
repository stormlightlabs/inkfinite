import type { Action } from "../actions";
import type { BrushConfig, StrokePoint, StrokeStyle } from "../model";
import { createId, ShapeRecord } from "../model";
import type { EditorState, ToolId } from "../reactivity";
import { getCurrentPage } from "../reactivity";
import type { Tool } from "../tools/base";

/**
 * Internal state for pen tool
 */
type PenToolState = {
  /** Whether we're currently drawing a stroke */
  isDrawing: boolean;
  /** Points being collected for the current stroke */
  draftPoints: StrokePoint[];
  /** ID of the shape being created */
  draftShapeId: string | null;
  /** Whether draft points are unsynced with document */
  draftNeedsSync: boolean;
  /** Frame bucket when draft was last synced */
  lastUpdateFrame: number | null;
};

/**
 * Minimum points required for a valid stroke
 */
const MIN_POINTS = 2;

/**
 * Minimum distance (in world units) between points to avoid redundant data
 */
const MIN_POINT_DISTANCE = 1;

/**
 * Duration for a render frame (~60 FPS)
 */
const FRAME_DURATION_MS = 1000 / 60;

/**
 * Default brush configuration
 */
const DEFAULT_BRUSH = { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true };

/**
 * Default stroke style
 */
const DEFAULT_STYLE: StrokeStyle = { color: "#000000", opacity: 1.0 };

/**
 * Pen tool - creates freehand stroke shapes using perfect-freehand
 *
 * Features:
 * - Draw smooth strokes by dragging
 * - Points include optional pressure data
 * - One undo step per stroke
 * - Draft stroke is not persisted until pointer up
 */
export class PenTool implements Tool {
  readonly id: ToolId = "pen";
  private toolState: PenToolState;
  private getBrush: () => BrushConfig;
  private getStrokeStyle: () => StrokeStyle;

  constructor(getBrush?: () => BrushConfig, getStrokeStyle?: () => StrokeStyle) {
    this.toolState = {
      isDrawing: false,
      draftPoints: [],
      draftShapeId: null,
      draftNeedsSync: false,
      lastUpdateFrame: null,
    };
    this.getBrush = getBrush ?? (() => DEFAULT_BRUSH);
    this.getStrokeStyle = getStrokeStyle ?? (() => DEFAULT_STYLE);
  }

  onEnter(state: EditorState): EditorState {
    this.resetToolState();
    return state;
  }

  onExit(state: EditorState): EditorState {
    let newState = state;
    if (this.toolState.draftShapeId) {
      newState = this.cancelStroke(state);
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
    const firstPoint: StrokePoint = [action.world.x, action.world.y];

    const strokeStyle = { ...this.getStrokeStyle() };

    const shape = ShapeRecord.createStroke(currentPage.id, 0, 0, {
      points: [firstPoint],
      brush: this.getBrush(),
      style: strokeStyle,
    }, shapeId);

    this.toolState.isDrawing = true;
    this.toolState.draftPoints = [firstPoint];
    this.toolState.draftShapeId = shapeId;
    this.toolState.draftNeedsSync = false;
    this.toolState.lastUpdateFrame = frameFromTimestamp(action.timestamp);

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
    if (action.type !== "pointer-move" || !this.toolState.isDrawing) return state;
    if (!this.toolState.draftShapeId) return state;

    const shape = state.doc.shapes[this.toolState.draftShapeId];
    if (!shape || shape.type !== "stroke") return state;

    const lastPoint = this.toolState.draftPoints[this.toolState.draftPoints.length - 1];
    const dx = action.world.x - lastPoint[0];
    const dy = action.world.y - lastPoint[1];
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < MIN_POINT_DISTANCE) {
      return state;
    }

    const newPoint: StrokePoint = [action.world.x, action.world.y];
    this.toolState.draftPoints.push(newPoint);
    this.toolState.draftNeedsSync = true;

    if (this.shouldSyncNow(action.timestamp)) {
      return this.syncDraftShape(state);
    }

    return state;
  }

  private handlePointerUp(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-up" || !this.toolState.draftShapeId) return state;

    let newState = this.syncDraftShape(state);

    const shape = newState.doc.shapes[this.toolState.draftShapeId];
    if (!shape || shape.type !== "stroke") {
      this.resetToolState();
      return newState;
    }

    if (this.toolState.draftPoints.length < MIN_POINTS) {
      newState = this.cancelStroke(newState);
    }

    this.toolState.lastUpdateFrame = frameFromTimestamp(action.timestamp);
    this.resetToolState();
    return newState;
  }

  private handleKeyDown(state: EditorState, action: Action): EditorState {
    if (action.type !== "key-down") return state;

    if (action.key === "Escape" && this.toolState.draftShapeId) {
      const newState = this.cancelStroke(state);
      this.resetToolState();
      return newState;
    }

    return state;
  }

  private cancelStroke(state: EditorState): EditorState {
    if (!this.toolState.draftShapeId) return state;

    const shape = state.doc.shapes[this.toolState.draftShapeId];
    if (!shape) return state;

    const newShapes = { ...state.doc.shapes };
    delete newShapes[this.toolState.draftShapeId];

    const currentPage = getCurrentPage(state);
    if (!currentPage) return state;

    const newPage = {
      ...currentPage,
      shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.draftShapeId),
    };

    return {
      ...state,
      doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
      ui: { ...state.ui, selectionIds: [] },
    };
  }

  private resetToolState(): void {
    this.toolState = {
      isDrawing: false,
      draftPoints: [],
      draftShapeId: null,
      draftNeedsSync: false,
      lastUpdateFrame: null,
    };
  }

  private shouldSyncNow(timestamp: number): boolean {
    const frame = frameFromTimestamp(timestamp);
    if (this.toolState.lastUpdateFrame === null) {
      this.toolState.lastUpdateFrame = frame;
      return true;
    }
    if (frame !== this.toolState.lastUpdateFrame) {
      this.toolState.lastUpdateFrame = frame;
      return true;
    }
    return false;
  }

  private syncDraftShape(state: EditorState): EditorState {
    if (!this.toolState.draftShapeId || !this.toolState.draftNeedsSync) {
      return state;
    }

    const shape = state.doc.shapes[this.toolState.draftShapeId];
    if (!shape || shape.type !== "stroke") {
      this.toolState.draftNeedsSync = false;
      return state;
    }

    const updatedShape = { ...shape, props: { ...shape.props, points: [...this.toolState.draftPoints] } };
    this.toolState.draftNeedsSync = false;

    return {
      ...state,
      doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.draftShapeId]: updatedShape } },
    };
  }
}

function frameFromTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    return 0;
  }
  return Math.floor(timestamp / FRAME_DURATION_MS);
}
