import {
	type Action,
	Camera,
	type CommandKind,
	createId,
	EditorState,
	reorderShapes,
	routeAction,
	ShapeRecord,
	type Store,
	type Tool
} from '@inkfinite/core';

/** Grid settings consumed by the editor runtime. */
export type SnapSettings = { snapEnabled: boolean; gridEnabled: boolean; gridSize: number };

/** Tool behavior used for resize, anchor, and Bézier handles. */
export type SelectionTool = Tool & {
	getHandleAtPoint(state: EditorState, world: { x: number; y: number }): string | null;
	getActiveHandle?(): string | null;
};

/** One durable document change produced at an interaction boundary. */
export type RuntimeTransactionDraft = {
	name: string;
	kind: CommandKind;
	before: EditorState;
	after: EditorState;
	action: Action;
};

/** Dependencies supplied by a UI adapter. */
export type EditorRuntimeOptions = {
	store: Store;
	tools: Map<EditorState['ui']['toolId'], Tool>;
	selectionTool: SelectionTool;
	getSnapSettings: () => SnapSettings;
	onTransactionDraft: (draft: RuntimeTransactionDraft) => void;
	/** Opens the board browser from its dedicated Cmd/Ctrl+B shortcut. */
	onBrowseRequested?: () => void;
	onHandleHover?: (handle: string | null) => void;
	onInteractionChanged?: () => void;
	onSnappedWorldChanged?: (world: { x: number; y: number }) => void;
};

/**
 * Framework-neutral editor interaction state machine.
 *
 * Pointer movement updates an ephemeral state preview. A pointer-up boundary,
 * text-style explicit commit, stencil insertion, or document shortcut emits
 * exactly one transaction draft through `onTransactionDraft`.
 */
export class EditorRuntime {
	private readonly options: EditorRuntimeOptions;
	private gestureStart: EditorState | null = null;
	private pointerDown = false;
	private spaceHeld = false;
	private panning = false;
	private lastPanScreen = { x: 0, y: 0 };

	constructor(options: EditorRuntimeOptions) {
		this.options = options;
	}

	/** Returns the local interaction state needed by cursor and overlay adapters. */
	getInteractionState() {
		return { pointerDown: this.pointerDown, spaceHeld: this.spaceHeld, panning: this.panning } as const;
	}

	/** Routes one normalized action through camera, selection, and active-tool state. */
	handleAction(action: Action): void {
		const { store, selectionTool } = this.options;

		if (action.type === 'pointer-move' && !this.panning && !this.spaceHeld) {
			const activeTool = this.options.tools.get(store.getState().ui.toolId);
			const handleTool = activeTool && hasHandleHitTesting(activeTool) ? activeTool : selectionTool;
			this.options.onHandleHover?.(handleTool.getHandleAtPoint(store.getState(), action.world));
		}

		if (action.type === 'key-down' && action.key === ' ' && !action.repeat) {
			this.spaceHeld = true;
			this.interactionChanged();
			return;
		}

		if (action.type === 'key-up' && action.key === ' ') {
			this.spaceHeld = false;
			this.panning = false;
			this.interactionChanged();
			return;
		}

		if (action.type === 'pointer-down' && (action.button === 1 || (action.button === 0 && this.spaceHeld))) {
			this.panning = true;
			this.lastPanScreen = action.screen;
			this.interactionChanged();
			return;
		}

		if (action.type === 'pointer-move' && this.panning) {
			const delta = { x: action.screen.x - this.lastPanScreen.x, y: action.screen.y - this.lastPanScreen.y };
			this.lastPanScreen = action.screen;
			store.setState((state) => ({ ...state, camera: Camera.pan(state.camera, delta) }));
			return;
		}

		if (action.type === 'pointer-up' && this.panning) {
			this.panning = false;
			this.interactionChanged();
			return;
		}

		if (this.panning || this.spaceHeld) return;

		const routedAction = snapAction(action, this.options.getSnapSettings());
		if ('world' in routedAction) this.options.onSnappedWorldChanged?.(routedAction.world);

		if (routedAction.type === 'pointer-down' && routedAction.button === 0) {
			this.pointerDown = true;
			this.options.onHandleHover?.(null);
			this.gestureStart = EditorState.clone(store.getState());
			this.interactionChanged();
		}

		const before = store.getState();
		const shortcut = applyKeyboardShortcut(before, routedAction, this.options.onBrowseRequested);
		const after = shortcut ?? routeAction(before, routedAction, this.options.tools);

		if (!statesEqual(before, after)) {
			const kind = commandKind(before, after);
			if (!this.gestureStart && kind === 'doc') {
				this.emitDraft(before, after, routedAction);
			} else {
				store.setState(() => after);
				this.interactionChanged();
			}
		}

		if (routedAction.type === 'pointer-up' && routedAction.button === 0) {
			this.pointerDown = false;
			const preview = store.getState();
			if (this.gestureStart && !statesEqual(this.gestureStart, preview)) {
				this.emitDraft(this.gestureStart, preview, routedAction);
			}
			this.gestureStart = null;
			this.interactionChanged();
		}
	}

	/** Emits an explicit document draft, used by DOM editors and stencil insertion. */
	commit(before: EditorState, after: EditorState, name: string, action: Action): void {
		if (statesEqual(before, after)) return;
		this.options.onTransactionDraft({
			name,
			kind: commandKind(before, after),
			before: EditorState.clone(before),
			after: EditorState.clone(after),
			action
		});
	}

	private emitDraft(before: EditorState, after: EditorState, action: Action): void {
		this.commit(before, after, describeAction(action, commandKind(before, after)), action);
	}

	private interactionChanged(): void {
		this.options.onInteractionChanged?.();
	}
}

/** Returns whether two editor states share the same immutable branches. */
export function statesEqual(a: EditorState, b: EditorState): boolean {
	return a.doc === b.doc && a.camera === b.camera && a.ui === b.ui;
}

/** Classifies which editor state branch changed. */
export function commandKind(before: EditorState, after: EditorState): CommandKind {
	if (before.doc !== after.doc) return 'doc';
	if (before.camera !== after.camera) return 'camera';
	return 'ui';
}

function hasHandleHitTesting(tool: Tool): tool is SelectionTool {
	return 'getHandleAtPoint' in tool && typeof tool.getHandleAtPoint === 'function';
}

function snapAction(action: Action, snap: SnapSettings): Action {
	if (!('world' in action) || !snap.snapEnabled || !snap.gridEnabled) return action;
	const { gridSize } = snap;
	return {
		...action,
		world: {
			x: Math.round(action.world.x / gridSize) * gridSize,
			y: Math.round(action.world.y / gridSize) * gridSize
		}
	};
}

function applyKeyboardShortcut(
	state: EditorState,
	action: Action,
	onBrowseRequested: (() => void) | undefined
): EditorState | null {
	if (action.type !== 'key-down') return null;
	const primary = action.modifiers.meta || action.modifiers.ctrl;
	if (primary && (action.key === 'b' || action.key === 'B')) {
		onBrowseRequested?.();
		return null;
	}
	if (state.ui.selectionIds.length === 0) return null;

	if (action.key.startsWith('Arrow')) {
		const step = action.modifiers.shift ? 10 : 1;
		const delta = arrowDelta(action.key, step);
		if (delta) {
			const shapes = { ...state.doc.shapes };
			let changed = false;
			for (const id of state.ui.selectionIds) {
				const shape = shapes[id];
				if (!shape) continue;
				shapes[id] = shape.editorTransform
					? {
							...shape,
							x: shape.x + delta.x,
							y: shape.y + delta.y,
							editorTransform: {
								...shape.editorTransform,
								e: shape.editorTransform.e + delta.x,
								f: shape.editorTransform.f + delta.y
							}
						}
					: { ...shape, x: shape.x + delta.x, y: shape.y + delta.y };
				changed = true;
			}
			if (changed) return { ...state, doc: { ...state.doc, shapes } };
		}
	}
	if (primary && ['d', 'D'].includes(action.key)) return duplicateSelection(state);
	if (primary && action.key === ']') return reorderSelection(state, 'forward');
	if (primary && action.key === '[') return reorderSelection(state, 'backward');
	if (primary && action.modifiers.shift && ['g', 'G'].includes(action.key)) return ungroupSelection(state);
	return null;
}

function arrowDelta(key: string, step: number): { x: number; y: number } | null {
	switch (key) {
		case 'ArrowLeft':
			return { x: -step, y: 0 };
		case 'ArrowRight':
			return { x: step, y: 0 };
		case 'ArrowUp':
			return { x: 0, y: -step };
		case 'ArrowDown':
			return { x: 0, y: step };
		default:
			return null;
	}
}

function duplicateSelection(state: EditorState): EditorState | null {
	const shapes = { ...state.doc.shapes };
	const pages = { ...state.doc.pages };
	const selectionIds: string[] = [];
	for (const id of state.ui.selectionIds) {
		const shape = shapes[id];
		if (!shape) continue;
		const copy = ShapeRecord.clone(shape);
		const newId = createId('shape');
		shapes[newId] = { ...copy, id: newId, x: copy.x + 12, y: copy.y + 12 };
		const page = pages[shape.pageId];
		if (!page) continue;
		pages[shape.pageId] = { ...page, shapeIds: [...page.shapeIds, newId] };
		selectionIds.push(newId);
	}
	return selectionIds.length === 0
		? null
		: { ...state, doc: { ...state.doc, shapes, pages }, ui: { ...state.ui, selectionIds } };
}

function reorderSelection(state: EditorState, direction: 'forward' | 'backward'): EditorState | null {
	const next = reorderShapes(state, state.ui.selectionIds, direction);
	return next === state ? null : next;
}

function ungroupSelection(state: EditorState): EditorState | null {
	const groups = new Set(
		state.ui.selectionIds.map((id) => state.doc.shapes[id]?.groupId).filter((id): id is string => Boolean(id))
	);
	if (groups.size === 0) return null;
	const shapes = { ...state.doc.shapes };
	let changed = false;
	for (const [id, shape] of Object.entries(shapes)) {
		if (shape.groupId && groups.has(shape.groupId)) {
			const copy = { ...shape };
			delete copy.groupId;
			shapes[id] = copy;
			changed = true;
		}
	}
	return changed ? { ...state, doc: { ...state.doc, shapes } } : null;
}

function describeAction(action: Action, kind: CommandKind): string {
	if (action.type === 'key-down') {
		if (action.key.startsWith('Arrow')) return 'Nudge';
		const primary = action.modifiers.meta || action.modifiers.ctrl;
		if (primary && ['d', 'D'].includes(action.key)) return 'Duplicate';
		if (primary && action.key === ']') return 'Bring Forward';
		if (primary && action.key === '[') return 'Send Backward';
	}
	if (action.type === 'pointer-up') return 'Pointer up';
	return kind === 'doc' ? 'Edit' : kind === 'camera' ? 'Camera change' : 'UI change';
}

export { Action, Camera, Modifiers, PointerButtons } from '@inkfinite/core';
export type { Vec2, Viewport } from '@inkfinite/core';
