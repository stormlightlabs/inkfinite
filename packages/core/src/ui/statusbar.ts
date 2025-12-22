import type { CursorState } from "../cursor";
import { shapeBounds } from "../geom";
import { type Box2, Box2 as Box2Ops, type Vec2, Vec2 as Vec2Ops } from "../math";
import type { EditorState, ToolId } from "../reactivity";
import { getSelectedShapes } from "../reactivity";

export type SelectionSummary = { count: number; kind?: string; bounds?: { w: number; h: number } };

export type SnapSummary = { enabled: boolean; gridSize?: number; angleStepDeg?: number };

export type PersistenceStatus = {
  backend: "indexeddb";
  state: "saved" | "saving" | "error";
  lastSavedAt?: number;
  pendingWrites?: number;
  errorMsg?: string;
};

export type StatusBarVM = {
  cursorWorld: Vec2;
  cursorScreen?: Vec2;
  toolId: ToolId;
  mode: "idle" | "dragging" | "panning" | "text-edit" | string;
  selection: SelectionSummary;
  snap: SnapSummary;
  persistence: PersistenceStatus;
};

/**
 * Convert the current camera zoom factor into a human-friendly percentage.
 */
export function getZoomPct(state: EditorState): number {
  const pct = state.camera.zoom * 100;
  if (!Number.isFinite(pct)) {
    return 100;
  }
  return Math.round(pct);
}

/**
 * Get the active tool identifier from UI state.
 */
export function getToolId(state: EditorState): ToolId {
  return state.ui.toolId;
}

/**
 * Summarize the current selection for display.
 */
export function getSelectionSummary(state: EditorState): SelectionSummary {
  const shapes = getSelectedShapes(state);
  const count = shapes.length;

  if (count === 0) {
    return { count: 0 };
  }

  const combinedBounds = combineBounds(shapes.map((shape) => shapeBounds(shape)));

  const kind = count === 1
    ? shapes[0].type
    : (shapes.every((shape) => shape.type === shapes[0].type) ? shapes[0].type : "mixed");

  return {
    count,
    kind,
    bounds: combinedBounds ? { w: Box2Ops.width(combinedBounds), h: Box2Ops.height(combinedBounds) } : undefined,
  };
}

const SNAP_DEFAULT: SnapSummary = { enabled: false };

/**
 * Provide safe defaults for snap/grid summary until features are enabled.
 */
export function getSnapSummary(_: EditorState): SnapSummary {
  return { ...SNAP_DEFAULT };
}

/**
 * Compose the full StatusBar view model from editor/cursor/persistence state.
 */
export function buildStatusBarVM(
  editorState: EditorState,
  cursorState: CursorState,
  persistence: PersistenceStatus,
  mode: StatusBarVM["mode"] = "idle",
): StatusBarVM {
  return {
    cursorWorld: Vec2Ops.clone(cursorState.cursorWorld),
    cursorScreen: cursorState.cursorScreen ? Vec2Ops.clone(cursorState.cursorScreen) : undefined,
    toolId: getToolId(editorState),
    mode,
    selection: getSelectionSummary(editorState),
    snap: getSnapSummary(editorState),
    persistence: { ...persistence },
  };
}

function combineBounds(boxes: Box2[]): Box2 | null {
  if (boxes.length === 0) {
    return null;
  }
  let combined = Box2Ops.clone(boxes[0]);
  for (let index = 1; index < boxes.length; index++) {
    const box = boxes[index];
    combined = {
      min: { x: Math.min(combined.min.x, box.min.x), y: Math.min(combined.min.y, box.min.y) },
      max: { x: Math.max(combined.max.x, box.max.x), y: Math.max(combined.max.y, box.max.y) },
    };
  }
  return combined;
}
