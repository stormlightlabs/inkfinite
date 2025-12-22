import { BehaviorSubject, type Subscription } from "rxjs";
import type { Camera } from "./camera";
import { Camera as CameraOps } from "./camera";
import { type Command, History, type HistoryState } from "./history";
import type { Document, PageRecord, ShapeRecord } from "./model";
import { Document as DocumentOps } from "./model";

export type ToolId = "select" | "rect" | "ellipse" | "line" | "arrow" | "text" | "pen";

export type UIState = { currentPageId: string | null; selectionIds: string[]; toolId: ToolId };

export type EditorState = { doc: Document; ui: UIState; camera: Camera };

export const EditorState = {
  /**
   * Create initial editor state
   */
  create(): EditorState {
    return {
      doc: DocumentOps.create(),
      ui: { currentPageId: null, selectionIds: [], toolId: "select" },
      camera: CameraOps.create(),
    };
  },

  /**
   * Clone editor state
   */
  clone(state: EditorState): EditorState {
    return {
      doc: DocumentOps.clone(state.doc),
      ui: { currentPageId: state.ui.currentPageId, selectionIds: [...state.ui.selectionIds], toolId: state.ui.toolId },
      camera: CameraOps.clone(state.camera),
    };
  },
};

export type StateUpdater = (state: EditorState) => EditorState;
export type StateListener = (state: EditorState) => void;

/**
 * Reactive store for editor state
 *
 * Features:
 * - Observable state using RxJS BehaviorSubject
 * - Immutable state updates
 * - Invariant enforcement (repairs invalid state)
 * - Subscription management
 * - Undo/redo history support
 */
export class Store {
  private readonly state$: BehaviorSubject<EditorState>;
  private history: HistoryState;

  constructor(initialState?: EditorState) {
    this.state$ = new BehaviorSubject(initialState ?? EditorState.create());
    this.history = History.create();
  }

  /**
   * Get the current state snapshot
   */
  getState(): EditorState {
    return this.state$.value;
  }

  /**
   * Update the state using an updater function
   *
   * The updater receives the current state and returns a new state.
   * Invariants are enforced after the update.
   *
   * Note: This bypasses history. Use executeCommand() for undoable changes.
   *
   * @param updater - Function that transforms current state to new state
   */
  setState(updater: StateUpdater): void {
    const currentState = this.state$.value;
    const newState = updater(currentState);
    const repairedState = enforceInvariants(newState);
    this.state$.next(repairedState);
  }

  /**
   * Execute a command and add it to history
   *
   * This is the preferred way to make undoable changes to the state.
   *
   * @param command - Command to execute
   */
  executeCommand(command: Command): void {
    const currentState = this.state$.value;
    const [newHistory, newState] = History.execute(this.history, currentState, command);
    this.history = newHistory;
    const repairedState = enforceInvariants(newState);
    this.state$.next(repairedState);
  }

  /**
   * Undo the last command
   *
   * @returns True if undo was successful, false if nothing to undo
   */
  undo(): boolean {
    const currentState = this.state$.value;
    const result = History.undo(this.history, currentState);

    if (!result) {
      return false;
    }

    const [newHistory, newState] = result;
    this.history = newHistory;
    const repairedState = enforceInvariants(newState);
    this.state$.next(repairedState);
    return true;
  }

  /**
   * Redo the last undone command
   *
   * @returns True if redo was successful, false if nothing to redo
   */
  redo(): boolean {
    const currentState = this.state$.value;
    const result = History.redo(this.history, currentState);

    if (!result) {
      return false;
    }

    const [newHistory, newState] = result;
    this.history = newHistory;
    const repairedState = enforceInvariants(newState);
    this.state$.next(repairedState);
    return true;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return History.canUndo(this.history);
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return History.canRedo(this.history);
  }

  /**
   * Get the history state (for debugging/UI)
   */
  getHistory(): HistoryState {
    return this.history;
  }

  /**
   * Clear all history
   */
  clearHistory(): void {
    this.history = History.clear();
  }

  /**
   * Subscribe to state changes
   *
   * The listener is called immediately with the current state,
   * and then on every state change.
   *
   * @param listener - Function called with new state
   * @returns Unsubscribe function
   */
  subscribe(listener: StateListener): () => void {
    const subscription: Subscription = this.state$.subscribe(listener);
    return () => subscription.unsubscribe();
  }

  /**
   * Get the underlying RxJS observable
   */
  getObservable() {
    return this.state$.asObservable();
  }
}

/**
 * Enforce state invariants by repairing invalid state
 *
 * Invariants:
 * 1. currentPageId must reference an existing page (or be null)
 * 2. selectionIds must only reference existing shapes
 * 3. selectionIds must only reference shapes on the current page
 *
 * @param state - State to validate and repair
 * @returns Repaired state
 */
function enforceInvariants(state: EditorState): EditorState {
  const pages = Object.keys(state.doc.pages);
  const shapes = state.doc.shapes;

  let currentPageId = state.ui.currentPageId;
  if (currentPageId !== null && !state.doc.pages[currentPageId]) {
    currentPageId = pages.length > 0 ? pages[0] : null;
  }

  let selectionIds = state.ui.selectionIds;
  if (currentPageId === null) {
    selectionIds = [];
  } else {
    const currentPage = state.doc.pages[currentPageId];
    const validShapeIds = new Set(currentPage?.shapeIds);

    selectionIds = selectionIds.filter((id) => {
      return shapes[id] && validShapeIds.has(id);
    });
  }

  if (currentPageId === state.ui.currentPageId && arraysEqual(selectionIds, state.ui.selectionIds)) {
    return state;
  }

  return { ...state, ui: { ...state.ui, currentPageId, selectionIds } };
}

/**
 * Check if two arrays are equal
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  let index = 0;
  for (const item of a) {
    if (item !== b[index]) return false;
    index++;
  }
  return true;
}

/**
 * Get the current page record
 *
 * @param state - Editor state
 * @returns Current page or null if no page is selected
 */
export function getCurrentPage(state: EditorState): PageRecord | null {
  if (state.ui.currentPageId === null) {
    return null;
  }
  return state.doc.pages[state.ui.currentPageId] ?? null;
}

/**
 * Get all shapes on the current page
 *
 * @param state - Editor state
 * @returns Array of shapes on current page (empty if no page selected)
 */
export function getShapesOnCurrentPage(state: EditorState): ShapeRecord[] {
  const currentPage = getCurrentPage(state);
  if (!currentPage) {
    return [];
  }

  return currentPage.shapeIds.map((id) => state.doc.shapes[id]).filter((shape): shape is ShapeRecord =>
    shape !== undefined
  );
}

/**
 * Get all selected shapes
 *
 * @param state - Editor state
 * @returns Array of selected shapes (empty if no selection)
 */
export function getSelectedShapes(state: EditorState): ShapeRecord[] {
  return state.ui.selectionIds.map((id) => state.doc.shapes[id]).filter((shape): shape is ShapeRecord =>
    shape !== undefined
  );
}

/**
 * Check if a shape is selected
 *
 * @param state - Editor state
 * @param shapeId - Shape ID to check
 * @returns True if shape is selected
 */
export function isShapeSelected(state: EditorState, shapeId: string): boolean {
  return state.ui.selectionIds.includes(shapeId);
}

/**
 * Get all pages
 *
 * @param state - Editor state
 * @returns Array of all pages
 */
export function getAllPages(state: EditorState): PageRecord[] {
  return Object.values(state.doc.pages);
}

/**
 * Get shape by ID
 *
 * @param state - Editor state
 * @param shapeId - Shape ID
 * @returns Shape or undefined if not found
 */
export function getShape(state: EditorState, shapeId: string): ShapeRecord | undefined {
  return state.doc.shapes[shapeId];
}
