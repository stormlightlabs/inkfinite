import type { Camera } from "./camera";
import type { ShapeRecord } from "./model";
import type { EditorState } from "./reactivity";

export type CommandKind = "doc" | "ui" | "camera";

export type HistoryOperation = "do" | "undo" | "redo";

export type HistoryAppliedEvent = {
  op: HistoryOperation;
  commandId: number;
  command: Command;
  kind: CommandKind;
  beforeState: EditorState;
  afterState: EditorState;
};

/**
 * Command interface for undo/redo operations
 *
 * All user-visible changes must be wrapped as commands that can be undone/redone.
 */
export interface Command {
  /** Display name for this command (shown in history UI) */
  readonly name: string;
  /** Command category, used for persistence decisions */
  readonly kind: CommandKind;

  /**
   * Execute the command and return the new state
   * @param state - Current editor state
   * @returns New editor state with command applied
   */
  do(state: EditorState): EditorState;

  /**
   * Undo the command and return the previous state
   * @param state - Current editor state
   * @returns New editor state with command undone
   */
  undo(state: EditorState): EditorState;
}

/**
 * Create a shape command
 */
export class CreateShapeCommand implements Command {
  readonly name: string;
  readonly kind = "doc" as const;

  constructor(private readonly shape: ShapeRecord, private readonly pageId: string) {
    this.name = `Create ${shape.type}`;
  }

  do(state: EditorState): EditorState {
    const page = state.doc.pages[this.pageId];
    if (!page) {
      return state;
    }

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: { ...state.doc.shapes, [this.shape.id]: this.shape },
        pages: { ...state.doc.pages, [this.pageId]: { ...page, shapeIds: [...page.shapeIds, this.shape.id] } },
      },
    };
  }

  undo(state: EditorState): EditorState {
    const page = state.doc.pages[this.pageId];
    if (!page) {
      return state;
    }

    const { [this.shape.id]: _, ...remainingShapes } = state.doc.shapes;

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: remainingShapes,
        pages: {
          ...state.doc.pages,
          [this.pageId]: { ...page, shapeIds: page.shapeIds.filter((id) => id !== this.shape.id) },
        },
      },
    };
  }
}

/**
 * Update shape command (stores before/after snapshots)
 */
export class UpdateShapeCommand implements Command {
  readonly name: string;
  readonly kind = "doc" as const;

  constructor(
    private readonly shapeId: string,
    private readonly before: ShapeRecord,
    private readonly after: ShapeRecord,
  ) {
    this.name = `Update ${after.type}`;
  }

  do(state: EditorState): EditorState {
    return { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.shapeId]: this.after } } };
  }

  undo(state: EditorState): EditorState {
    return { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.shapeId]: this.before } } };
  }
}

/**
 * Delete shapes command (can delete multiple shapes)
 */
export class DeleteShapesCommand implements Command {
  readonly name: string;
  readonly kind = "doc" as const;

  constructor(private readonly shapes: ShapeRecord[], private readonly pageId: string) {
    this.name = shapes.length === 1 ? `Delete ${shapes[0].type}` : `Delete ${shapes.length} shapes`;
  }

  do(state: EditorState): EditorState {
    const page = state.doc.pages[this.pageId];
    if (!page) {
      return state;
    }

    const shapeIdsToDelete = new Set(this.shapes.map((s) => s.id));
    const remainingShapes = { ...state.doc.shapes };

    for (const id of shapeIdsToDelete) {
      delete remainingShapes[id];
    }

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: remainingShapes,
        pages: {
          ...state.doc.pages,
          [this.pageId]: { ...page, shapeIds: page.shapeIds.filter((id) => !shapeIdsToDelete.has(id)) },
        },
      },
    };
  }

  undo(state: EditorState): EditorState {
    const page = state.doc.pages[this.pageId];
    if (!page) {
      return state;
    }

    const restoredShapes = { ...state.doc.shapes };
    const shapeIds = this.shapes.map((s) => s.id);

    for (const shape of this.shapes) {
      restoredShapes[shape.id] = shape;
    }

    return {
      ...state,
      doc: {
        ...state.doc,
        shapes: restoredShapes,
        pages: { ...state.doc.pages, [this.pageId]: { ...page, shapeIds: [...page.shapeIds, ...shapeIds] } },
      },
    };
  }
}

/**
 * Set selection command
 */
export class SetSelectionCommand implements Command {
  readonly name = "Change selection";
  readonly kind = "ui" as const;

  constructor(private readonly before: string[], private readonly after: string[]) {}

  do(state: EditorState): EditorState {
    return { ...state, ui: { ...state.ui, selectionIds: this.after } };
  }

  undo(state: EditorState): EditorState {
    return { ...state, ui: { ...state.ui, selectionIds: this.before } };
  }
}

/**
 * Set camera command
 */
export class SetCameraCommand implements Command {
  readonly name = "Move camera";
  readonly kind = "camera" as const;

  constructor(private readonly before: Camera, private readonly after: Camera) {}

  do(state: EditorState): EditorState {
    return { ...state, camera: this.after };
  }

  undo(state: EditorState): EditorState {
    return { ...state, camera: this.before };
  }
}

/**
 * History entry (command with timestamp)
 */
export type HistoryEntry = { command: Command; timestamp: number };

/**
 * History manager state
 */
export type HistoryState = { undoStack: HistoryEntry[]; redoStack: HistoryEntry[] };

/**
 * History namespace for managing undo/redo stacks
 */
export const History = {
  /**
   * Create empty history state
   */
  create(): HistoryState {
    return { undoStack: [], redoStack: [] };
  },

  /**
   * Execute a command and add it to history
   *
   * @param history - Current history state
   * @param state - Current editor state
   * @param command - Command to execute
   * @returns Tuple of [new history state, new editor state]
   */
  execute(history: HistoryState, state: EditorState, command: Command): [HistoryState, EditorState] {
    const newState = command.do(state);

    const entry: HistoryEntry = { command, timestamp: Date.now() };

    return [{ undoStack: [...history.undoStack, entry], redoStack: [] }, newState];
  },

  /**
   * Undo the last command
   *
   * @param history - Current history state
   * @param state - Current editor state
   * @returns Tuple of [new history state, new editor state] or null if nothing to undo
   */
  undo(history: HistoryState, state: EditorState): [HistoryState, EditorState] | null {
    if (history.undoStack.length === 0) {
      return null;
    }

    const entry = history.undoStack.at(-1)!;
    const newState = entry!.command.undo(state);

    return [{ undoStack: history.undoStack.slice(0, -1), redoStack: [...history.redoStack, entry] }, newState];
  },

  /**
   * Redo the last undone command
   *
   * @param history - Current history state
   * @param state - Current editor state
   * @returns Tuple of [new history state, new editor state] or null if nothing to redo
   */
  redo(history: HistoryState, state: EditorState): [HistoryState, EditorState] | null {
    if (history.redoStack.length === 0) {
      return null;
    }

    const entry = history.redoStack.at(-1)!;
    const newState = entry!.command.do(state);

    return [{ undoStack: [...history.undoStack, entry], redoStack: history.redoStack.slice(0, -1) }, newState];
  },

  /**
   * Check if there are commands to undo
   */
  canUndo(history: HistoryState): boolean {
    return history.undoStack.length > 0;
  },

  /**
   * Check if there are commands to redo
   */
  canRedo(history: HistoryState): boolean {
    return history.redoStack.length > 0;
  },

  /**
   * Get all history entries (undo + redo stacks combined)
   */
  getAllEntries(history: HistoryState): HistoryEntry[] {
    return [...history.undoStack, ...history.redoStack];
  },

  /**
   * Clear all history
   */
  clear(): HistoryState {
    return History.create();
  },
};
