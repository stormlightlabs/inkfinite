import type { Action } from "../actions";
import type { StrokePoint } from "../model";
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
 * Default brush configuration
 */
const DEFAULT_BRUSH = { size: 16, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true };

/**
 * Default stroke style
 */
const DEFAULT_STYLE = { color: "#000000", opacity: 1.0 };

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

  constructor() {
    this.toolState = { isDrawing: false, draftPoints: [], draftShapeId: null };
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

    // Start with first point
    const firstPoint: StrokePoint = [action.world.x, action.world.y];

    const shape = ShapeRecord.createStroke(currentPage.id, 0, 0, {
      points: [firstPoint],
      brush: DEFAULT_BRUSH,
      style: DEFAULT_STYLE,
    }, shapeId);

    this.toolState.isDrawing = true;
    this.toolState.draftPoints = [firstPoint];
    this.toolState.draftShapeId = shapeId;

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

    const updatedShape = { ...shape, props: { ...shape.props, points: [...this.toolState.draftPoints] } };

    return {
      ...state,
      doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.draftShapeId]: updatedShape } },
    };
  }

  private handlePointerUp(state: EditorState, action: Action): EditorState {
    if (action.type !== "pointer-up" || !this.toolState.draftShapeId) return state;

    const shape = state.doc.shapes[this.toolState.draftShapeId];
    if (!shape || shape.type !== "stroke") return state;

    let newState = state;

    if (this.toolState.draftPoints.length < MIN_POINTS) {
      newState = this.cancelStroke(state);
    }

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
    this.toolState = { isDrawing: false, draftPoints: [], draftShapeId: null };
  }
}
