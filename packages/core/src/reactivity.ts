import { BehaviorSubject, type Subscription } from 'rxjs';
import type { Camera } from './camera';
import { Camera as CameraOps } from './camera';
import {
	type Command,
	History,
	type HistoryAppliedEvent,
	type HistoryEntry,
	type HistoryOperation,
	type HistoryState
} from './history';
import type { Document, LayerRecord, PageRecord, ShapeRecord } from './model';
import { Document as DocumentOps, ensureDocumentLayers } from './model';

export type ToolId = 'select' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'pen' | 'markdown';

export type BindingPreview = { arrowId: string; targetShapeId: string; handle: 'start' | 'end' };

export type UIState = {
	currentPageId: string | null;
	/** Active destination for newly created shapes on the current page. */
	activeLayerId?: string | null;
	selectionIds: string[];
	toolId: ToolId;
	bindingPreview?: BindingPreview;
};

export type EditorState = { doc: Document; ui: UIState; camera: Camera };

export const EditorState = {
	/**
	 * Create initial editor state
	 */
	create(): EditorState {
		return {
			doc: DocumentOps.create(),
			ui: { currentPageId: null, activeLayerId: null, selectionIds: [], toolId: 'select' },
			camera: CameraOps.create()
		};
	},

	/**
	 * Clone editor state
	 */
	clone(state: EditorState): EditorState {
		return {
			doc: DocumentOps.clone(state.doc),
			ui: {
				currentPageId: state.ui.currentPageId,
				activeLayerId: state.ui.activeLayerId,
				selectionIds: [...state.ui.selectionIds],
				toolId: state.ui.toolId,
				bindingPreview: state.ui.bindingPreview ? { ...state.ui.bindingPreview } : undefined
			},
			camera: CameraOps.clone(state.camera)
		};
	}
};

export type StateUpdater = (state: EditorState) => EditorState;
export type StateListener = (state: EditorState) => void;
export type StoreOptions = { onHistoryEvent?: (event: HistoryAppliedEvent) => void };

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
	private readonly historyListener?: (event: HistoryAppliedEvent) => void;

	constructor(initialState?: EditorState, options?: StoreOptions) {
		this.state$ = new BehaviorSubject(enforceInvariants(initialState ?? EditorState.create()));
		this.history = History.create();
		this.historyListener = options?.onHistoryEvent;
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
		const entry = this.history.undoStack.at(-1);
		if (entry) {
			this.emitHistoryEvent('do', entry, currentState, repairedState);
		}
	}

	/**
	 * Undo the last command
	 *
	 * @returns True if undo was successful, false if nothing to undo
	 */
	undo(): boolean {
		const currentState = this.state$.value;
		const entry = this.history.undoStack.at(-1);
		const result = History.undo(this.history, currentState);

		if (!result) {
			return false;
		}

		const [newHistory, newState] = result;
		this.history = newHistory;
		const repairedState = enforceInvariants(newState);
		this.state$.next(repairedState);
		if (entry) {
			this.emitHistoryEvent('undo', entry, currentState, repairedState);
		}
		return true;
	}

	/**
	 * Redo the last undone command
	 *
	 * @returns True if redo was successful, false if nothing to redo
	 */
	redo(): boolean {
		const currentState = this.state$.value;
		const entry = this.history.redoStack.at(-1);
		const result = History.redo(this.history, currentState);

		if (!result) {
			return false;
		}

		const [newHistory, newState] = result;
		this.history = newHistory;
		const repairedState = enforceInvariants(newState);
		this.state$.next(repairedState);
		if (entry) {
			this.emitHistoryEvent('redo', entry, currentState, repairedState);
		}
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

	private emitHistoryEvent(
		op: HistoryOperation,
		entry: HistoryEntry,
		beforeState: EditorState,
		afterState: EditorState
	): void {
		if (!this.historyListener) {
			return;
		}

		this.historyListener({
			op,
			commandId: entry.timestamp,
			command: entry.command,
			kind: entry.command.kind,
			beforeState,
			afterState
		});
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
	const activeLayerId = state.ui.activeLayerId;
	const taggedDocument = activeLayerId
		? {
				...state.doc,
				shapes: Object.fromEntries(
					Object.entries(state.doc.shapes).map(([id, shape]) => [
						id,
						shape.layerId ? shape : { ...shape, layerId: activeLayerId }
					])
				)
			}
		: state.doc;
	const doc = ensureDocumentLayers(taggedDocument);
	const pages = Object.keys(doc.pages);
	const shapes = doc.shapes;

	let currentPageId = state.ui.currentPageId;
	if (currentPageId !== null && !doc.pages[currentPageId]) {
		currentPageId = pages.length > 0 ? pages[0] : null;
	}

	let selectionIds = state.ui.selectionIds;
	if (currentPageId === null) {
		selectionIds = [];
	} else {
		const currentPage = doc.pages[currentPageId];
		const validShapeIds = new Set(getInteractiveShapeIds(doc, currentPage));

		selectionIds = selectionIds.filter((id) => {
			return shapes[id] && validShapeIds.has(id);
		});
	}

	const currentPage = currentPageId ? doc.pages[currentPageId] : undefined;
	const layerIds = currentPage?.layerIds ?? [];
	const requestedActiveLayer = state.ui.activeLayerId ? doc.layers?.[state.ui.activeLayerId] : undefined;
	const nextActiveLayerId =
		requestedActiveLayer &&
		layerIds.includes(requestedActiveLayer.id) &&
		requestedActiveLayer.visible &&
		!requestedActiveLayer.locked
			? requestedActiveLayer.id
			: ([...layerIds].reverse().find((id) => doc.layers?.[id]?.visible && !doc.layers?.[id]?.locked) ?? null);

	return { ...state, doc, ui: { ...state.ui, currentPageId, activeLayerId: nextActiveLayerId, selectionIds } };
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

/** Returns whether the current active layer can receive a newly created shape. */
export function canCreateShapeOnActiveLayer(state: EditorState): boolean {
	const page = getCurrentPage(state);
	if (!page) return false;
	if (!state.doc.layers || !page.layerIds?.length) return true;
	const layerId = state.ui.activeLayerId;
	const layer = layerId ? state.doc.layers[layerId] : undefined;
	return Boolean(layer && layer.pageId === page.id && layer.visible && !layer.locked);
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

	const layers = state.doc.layers;
	if (!layers || !currentPage.layerIds?.length) {
		return currentPage.shapeIds
			.map((id) => state.doc.shapes[id])
			.filter((shape): shape is ShapeRecord => shape !== undefined);
	}
	return currentPage.layerIds.flatMap((layerId) => {
		const layer = layers[layerId];
		if (!layer?.visible) return [];
		return layer.shapeIds
			.map((id) => state.doc.shapes[id])
			.filter((shape): shape is ShapeRecord => shape !== undefined);
	});
}

/** Returns visible, unlocked shapes in draw order for hit testing and selection. */
export function getInteractiveShapesOnCurrentPage(state: EditorState): ShapeRecord[] {
	const currentPage = getCurrentPage(state);
	if (!currentPage) return [];
	const layers = state.doc.layers;
	if (!layers || !currentPage.layerIds?.length) return getShapesOnCurrentPage(state);
	return currentPage.layerIds.flatMap((layerId) => {
		const layer = layers[layerId];
		if (!layer?.visible || layer.locked) return [];
		return layer.shapeIds
			.map((id) => state.doc.shapes[id])
			.filter((shape): shape is ShapeRecord => shape !== undefined);
	});
}

/** Returns the current page's layers in back-to-front order. */
export function getLayersOnCurrentPage(state: EditorState): LayerRecord[] {
	const page = getCurrentPage(state);
	if (!page || !state.doc.layers) return [];
	return (page.layerIds ?? [])
		.map((id) => state.doc.layers?.[id])
		.filter((layer): layer is LayerRecord => Boolean(layer));
}

function getInteractiveShapeIds(document: Document, page: PageRecord): string[] {
	if (!document.layers || !page.layerIds?.length) return page.shapeIds;
	return page.layerIds.flatMap((id) => {
		const layer = document.layers?.[id];
		return layer?.visible && !layer.locked ? layer.shapeIds : [];
	});
}

/**
 * Get all selected shapes
 *
 * @param state - Editor state
 * @returns Array of selected shapes (empty if no selection)
 */
export function getSelectedShapes(state: EditorState): ShapeRecord[] {
	return state.ui.selectionIds
		.map((id) => state.doc.shapes[id])
		.filter((shape): shape is ShapeRecord => shape !== undefined);
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
