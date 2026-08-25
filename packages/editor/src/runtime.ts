import {
	type Action,
	Camera,
	EditorState,
	getSelectionScopeShapes,
	hitTestPoint,
	routeAction,
	selectionTarget,
	type CommandKind,
	type PathTopologyEdit,
	type Store,
	type Tool
} from '@inkfinite/core';
import { dispatchHostRequest, type EditorHostRequests } from './host.js';
import { resolveKeyboardShortcut } from './shortcuts.js';

/** Grid settings consumed by the editor runtime. */
export type SnapSettings = {
	snapEnabled: boolean;
	gridEnabled: boolean;
	gridSize: number;
	objectSnapEnabled?: boolean;
	snapDistance?: number;
};

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
	topologyEdits?: PathTopologyEdit[];
};

/** Dependencies supplied by a UI adapter. */
export type EditorRuntimeOptions = EditorHostRequests & {
	store: Store;
	tools: Map<EditorState['ui']['toolId'], Tool>;
	selectionTool: SelectionTool;
	getSnapSettings: () => SnapSettings;
	/** Canvas viewport used for edge scrolling while a gesture is active. */
	getViewport?: () => { width: number; height: number };
	onTransactionDraft: (draft: RuntimeTransactionDraft) => void;
	/** Opens the board browser from its dedicated Cmd/Ctrl+B shortcut. */
	onBrowseRequested?: () => void;
	/** Opens the searchable keyboard shortcut panel. */
	onShortcutsRequested?: () => void;
	/** Opens the searchable command palette. */
	onCommandPaletteRequested?: () => void;
	/** Handles undo and redo before the active tool sees the key event. */
	onUndoRequested?: () => void;
	onRedoRequested?: () => void;
	/** Clipboard actions are supplied by the host because browser permissions vary. */
	onCopyRequested?: () => void;
	onCutRequested?: () => void;
	onPasteRequested?: () => void;
	/** Optional grouped host boundary; legacy callback fields remain supported. */
	host?: EditorHostRequests;
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
	private readonly hostRequests: EditorHostRequests;
	private gestureStart: EditorState | null = null;
	private pointerDown = false;
	private spaceHeld = false;
	private panning = false;
	private lastPanScreen = { x: 0, y: 0 };

	private updateHoveredShape(action: Extract<Action, { type: 'pointer-move' }>): void {
		if (this.pointerDown || this.panning || this.spaceHeld) return;
		const state = this.options.store.getState();
		const hit = hitTestPoint(state, action.world);
		const hoveredShapeId = hit ? (selectionTarget(state, hit) ?? hit) : undefined;
		if (hoveredShapeId === state.ui.hoveredShapeId) return;
		this.options.store.setState((current) => ({ ...current, ui: { ...current.ui, hoveredShapeId } }));
		this.interactionChanged();
	}

	private edgeScrollAction(
		action: Extract<Action, { type: 'pointer-move' }>
	): Extract<Action, { type: 'pointer-move' }> {
		const viewport = this.options.getViewport?.();
		if (!viewport || !this.pointerDown || this.spaceHeld) return action;
		const margin = 32;
		const maxSpeed = 18;
		const edgeDelta = (position: number, size: number) =>
			position < margin
				? -Math.min(maxSpeed, margin - position)
				: position > size - margin
					? Math.min(maxSpeed, position - (size - margin))
					: 0;
		const dx = edgeDelta(action.screen.x, viewport.width);
		const dy = edgeDelta(action.screen.y, viewport.height);
		if (dx === 0 && dy === 0) return action;
		this.options.store.setState((state) => ({ ...state, camera: Camera.pan(state.camera, { x: -dx, y: -dy }) }));
		return {
			...action,
			world: Camera.screenToWorld(this.options.store.getState().camera, action.screen, viewport)
		};
	}

	constructor(options: EditorRuntimeOptions) {
		this.options = options;
		this.hostRequests = { ...options, ...options.host };
	}

	/** Returns the local interaction state needed by cursor and overlay adapters. */
	getInteractionState() {
		return { pointerDown: this.pointerDown, spaceHeld: this.spaceHeld, panning: this.panning } as const;
	}

	/** Routes one normalized action through camera, selection, and active-tool state. */
	handleAction(action: Action): void {
		const { store, selectionTool } = this.options;

		if (action.type === 'pointer-move' && !this.panning && !this.spaceHeld) {
			this.updateHoveredShape(action);
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

		if (action.type === 'pointer-down' && action.button === 0 && !this.spaceHeld) {
			store.setState((state) =>
				state.ui.hoveredShapeId ? { ...state, ui: { ...state.ui, hoveredShapeId: undefined } } : state
			);
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

		const routedAction = snapAction(
			action.type === 'pointer-move' ? this.edgeScrollAction(action) : action,
			this.options.getSnapSettings()
		);
		if ('world' in routedAction) this.options.onSnappedWorldChanged?.(routedAction.world);

		if (routedAction.type === 'pointer-down' && routedAction.button === 0) {
			this.pointerDown = true;
			this.options.onHandleHover?.(null);
			this.gestureStart = EditorState.clone(store.getState());
			this.interactionChanged();
		}

		const before = store.getState();
		const shortcut = resolveKeyboardShortcut(before, routedAction);
		if (shortcut.request) dispatchHostRequest(shortcut.request, this.hostRequests);
		const after = shortcut.state ?? routeAction(before, routedAction, this.options.tools);

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
		const activeTool = this.options.tools.get(before.ui.toolId);
		const topologyEdits = activeTool?.getPendingTopologyEdits?.();
		this.options.onTransactionDraft({
			name: describeAction(action, commandKind(before, after)),
			kind: commandKind(before, after),
			before: EditorState.clone(before),
			after: EditorState.clone(after),
			action,
			...(topologyEdits && topologyEdits.length > 0 ? { topologyEdits } : {})
		});
		activeTool?.clearPendingTopologyEdits?.();
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
	if (
		!('world' in action) ||
		!snap.snapEnabled ||
		!snap.gridEnabled ||
		!Number.isFinite(snap.gridSize) ||
		snap.gridSize <= 0
	)
		return action;
	const { gridSize } = snap;
	return {
		...action,
		world: {
			x: Math.round(action.world.x / gridSize) * gridSize,
			y: Math.round(action.world.y / gridSize) * gridSize
		}
	};
}

function describeAction(action: Action, kind: CommandKind): string {
	if (action.type === 'key-down') {
		if (action.key.startsWith('Arrow')) return 'Nudge';
		const primary = action.modifiers.meta || action.modifiers.ctrl;
		if (primary && action.modifiers.alt && ['d', 'D'].includes(action.key)) return 'Duplicate and connect';
		if (primary && ['d', 'D'].includes(action.key)) return 'Duplicate';
		if (primary && action.key === ']') return action.modifiers.shift ? 'Bring to Front' : 'Bring Forward';
		if (primary && action.key === '[') return action.modifiers.shift ? 'Send to Back' : 'Send Backward';
		if (primary && ['g', 'G'].includes(action.key)) return action.modifiers.shift ? 'Ungroup' : 'Group';
		if (primary && action.modifiers.shift && ['l', 'L'].includes(action.key)) return 'Toggle Lock';
	}
	if (action.type === 'pointer-up') return 'Pointer up';
	return kind === 'doc' ? 'Edit' : kind === 'camera' ? 'Camera change' : 'UI change';
}

export { Action, Camera, Modifiers, PointerButtons } from '@inkfinite/core';
export type { Vec2, Viewport } from '@inkfinite/core';
