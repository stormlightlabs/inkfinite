import type { Action } from "../actions";
import { computeNormalizedAnchor, hitTestPoint } from "../geom";
import { Vec2 } from "../math";
import { BindingRecord, createId, ShapeRecord } from "../model";
import type { EditorState, ToolId } from "../reactivity";
import { getCurrentPage } from "../reactivity";
import type { Tool } from "../tools/base";

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
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      start: { kind: "free" },
      end: { kind: "free" },
      style: { stroke: "#495057", width: 2, headEnd: true },
      routing: { kind: "straight" },
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
    const updatedPoints = [{ x: 0, y: 0 }, b];
    const updatedShape = { ...shape, props: { ...shape.props, points: updatedPoints } };

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

    const points = shape.props.points;
    if (!points || points.length < 2) {
      newState = this.cancelShapeCreation(state);
      this.resetToolState();
      return newState;
    }

    const endPoint = points[points.length - 1];
    const arrowLength = Vec2.len(endPoint);
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

    const points = arrow.props.points;
    if (!points || points.length < 2) return state;

    const startPoint = points[0];
    const endPoint = points[points.length - 1];

    const startWorld = { x: arrow.x + startPoint.x, y: arrow.y + startPoint.y };
    const endWorld = { x: arrow.x + endPoint.x, y: arrow.y + endPoint.y };

    const newBindings = { ...state.doc.bindings };
    let updatedArrow = arrow;

    const stateWithoutArrow = {
      ...state,
      doc: {
        ...state.doc,
        shapes: Object.fromEntries(Object.entries(state.doc.shapes).filter(([id]) => id !== arrowId)),
      },
    };

    const startHitId = hitTestPoint(stateWithoutArrow, startWorld);
    if (startHitId) {
      const targetShape = state.doc.shapes[startHitId];
      if (targetShape) {
        const anchor = computeNormalizedAnchor(startWorld, targetShape);
        const binding = BindingRecord.create(arrowId, startHitId, "start", {
          kind: "edge",
          nx: anchor.nx,
          ny: anchor.ny,
        });
        newBindings[binding.id] = binding;
        updatedArrow = {
          ...updatedArrow,
          props: { ...updatedArrow.props, start: { kind: "bound", bindingId: binding.id } },
        };
      }
    }

    const endHitId = hitTestPoint(stateWithoutArrow, endWorld);
    if (endHitId) {
      const targetShape = state.doc.shapes[endHitId];
      if (targetShape) {
        const anchor = computeNormalizedAnchor(endWorld, targetShape);
        const binding = BindingRecord.create(arrowId, endHitId, "end", { kind: "edge", nx: anchor.nx, ny: anchor.ny });
        newBindings[binding.id] = binding;
        updatedArrow = {
          ...updatedArrow,
          props: { ...updatedArrow.props, end: { kind: "bound", bindingId: binding.id } },
        };
      }
    }

    return {
      ...state,
      doc: { ...state.doc, bindings: newBindings, shapes: { ...state.doc.shapes, [arrowId]: updatedArrow } },
    };
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
