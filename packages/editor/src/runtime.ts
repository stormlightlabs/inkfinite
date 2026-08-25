import {
	type Action,
	EditorBindingRecord,
	Camera,
	duplicateAndConnectSelection,
	type CommandKind,
	createId,
	EditorState,
	getSelectionScopeShapes,
	groupShapes,
	reorderShapes,
	reorderShapesToEdge,
	routeAction,
	setShapesLocked,
	translateShapes,
	ungroupShapes,
	EditorShapeRecord,
	hitTestPoint,
	selectionTarget,
	type PathTopologyEdit,
	type Store,
	type Tool
} from '@inkfinite/core';

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
export type EditorRuntimeOptions = {
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
		const shortcut = applyKeyboardShortcut(before, routedAction, {
			onBrowseRequested: this.options.onBrowseRequested,
			onShortcutsRequested: this.options.onShortcutsRequested,
			onCommandPaletteRequested: this.options.onCommandPaletteRequested,
			onUndoRequested: this.options.onUndoRequested,
			onRedoRequested: this.options.onRedoRequested,
			onCopyRequested: this.options.onCopyRequested,
			onCutRequested: this.options.onCutRequested,
			onPasteRequested: this.options.onPasteRequested
		});
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

function applyKeyboardShortcut(
	state: EditorState,
	action: Action,
	handlers: {
		onBrowseRequested?: () => void;
		onShortcutsRequested?: () => void;
		onCommandPaletteRequested?: () => void;
		onUndoRequested?: () => void;
		onRedoRequested?: () => void;
		onCopyRequested?: () => void;
		onCutRequested?: () => void;
		onPasteRequested?: () => void;
	}
): EditorState | null {
	if (action.type !== 'key-down') return null;
	const primary = action.modifiers.meta || action.modifiers.ctrl;
	if (action.key === '?' || (action.key === '/' && action.modifiers.shift)) {
		handlers.onShortcutsRequested?.();
		return null;
	}
	if (primary && ['k', 'K'].includes(action.key)) {
		handlers.onCommandPaletteRequested?.();
		return null;
	}
	if (primary && ['z', 'Z'].includes(action.key)) {
		if (action.modifiers.shift) handlers.onRedoRequested?.();
		else handlers.onUndoRequested?.();
		return null;
	}
	if (primary && ['y', 'Y'].includes(action.key)) {
		handlers.onRedoRequested?.();
		return null;
	}
	if (primary && ['b', 'B'].includes(action.key)) {
		handlers.onBrowseRequested?.();
		return null;
	}
	if (primary && ['c', 'C'].includes(action.key)) {
		handlers.onCopyRequested?.();
		return null;
	}
	if (primary && ['x', 'X'].includes(action.key)) {
		handlers.onCutRequested?.();
		return null;
	}
	if (primary && ['v', 'V'].includes(action.key)) {
		handlers.onPasteRequested?.();
		return null;
	}
	if (primary && ['a', 'A'].includes(action.key)) {
		const selectionIds = getSelectionScopeShapes(state).map((shape) => shape.id);
		return selectionIds.length === 0 || selectionIds.every((id) => state.ui.selectionIds.includes(id))
			? null
			: { ...state, ui: { ...state.ui, selectionIds } };
	}
	if (state.ui.selectionIds.length === 0) return null;

	if (action.key.startsWith('Arrow')) {
		const step = action.modifiers.shift ? 10 : 1;
		const delta = arrowDelta(action.key, step);
		if (delta) {
			const next = translateShapes(state, state.ui.selectionIds, delta);
			return next === state ? null : next;
		}
	}
	if (primary && action.modifiers.alt && ['d', 'D'].includes(action.key)) {
		return duplicateAndConnectSelection(state);
	}
	if (primary && ['d', 'D'].includes(action.key)) return duplicateSelection(state);
	if (primary && ['g', 'G'].includes(action.key)) {
		return action.modifiers.shift
			? nullableState(ungroupShapes(state, state.ui.selectionIds), state)
			: nullableState(groupShapes(state, state.ui.selectionIds), state);
	}
	if (primary && action.modifiers.shift && ['l', 'L'].includes(action.key)) {
		const locked = state.ui.selectionIds.every((id) => state.doc.shapes[id]?.locked);
		return nullableState(setShapesLocked(state, state.ui.selectionIds, !locked), state);
	}
	if (primary && action.key === ']') {
		return action.modifiers.shift
			? nullableState(reorderShapesToEdge(state, state.ui.selectionIds, 'front'), state)
			: reorderSelection(state, 'forward');
	}
	if (primary && action.key === '[') {
		return action.modifiers.shift
			? nullableState(reorderShapesToEdge(state, state.ui.selectionIds, 'back'), state)
			: reorderSelection(state, 'backward');
	}
	return null;
}

function nullableState(next: EditorState, previous: EditorState): EditorState | null {
	return next === previous ? null : next;
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
	const selectedIds = new Set(state.ui.selectionIds);
	const roots = state.ui.selectionIds.filter((id) => !hasSelectedAncestor(state, id, selectedIds));
	if (roots.length === 0) return null;
	const included = Object.values(state.doc.shapes).filter(
		(shape) => roots.includes(shape.id) || roots.some((root) => hasAncestor(shape, root, state))
	);
	const mapping = new Map(included.map((shape) => [shape.id, createId('shape')]));
	const shapes = { ...state.doc.shapes };
	for (const source of included) {
		const copy = EditorShapeRecord.clone(source);
		const id = mapping.get(source.id)!;
		const parentId = source.groupId ? mapping.get(source.groupId) : undefined;
		const copied = {
			...copy,
			id,
			x: copy.x + 12,
			y: copy.y + 12,
			editorTransform: copy.editorTransform
				? { ...copy.editorTransform, e: copy.editorTransform.e + 12, f: copy.editorTransform.f + 12 }
				: undefined,
			...(parentId ? { groupId: parentId } : { groupId: undefined })
		};
		shapes[id] = copied;
		if (copied.type === 'text' && copied.props.textPath) {
			const pathId = mapping.get(copied.props.textPath.pathId);
			if (pathId) copied.props = { ...copied.props, textPath: { ...copied.props.textPath, pathId } };
		}
	}
	const pages = { ...state.doc.pages };
	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	const copiedIds = included.map((shape) => mapping.get(shape.id)!);
	const rootCopies = roots.map((id) => mapping.get(id)).filter((id): id is string => Boolean(id));
	for (const page of Object.values(pages)) {
		const added = copiedIds.filter((id) => shapes[id]?.pageId === page.id);
		if (added.length > 0) pages[page.id] = { ...page, shapeIds: [...page.shapeIds, ...added] };
	}
	if (layers) {
		for (const layer of Object.values(layers)) {
			const added = copiedIds.filter((id) => shapes[id]?.layerId === layer.id);
			if (added.length > 0) layers[layer.id] = { ...layer, shapeIds: [...layer.shapeIds, ...added] };
		}
	}
	const bindings = { ...state.doc.bindings };
	for (const binding of Object.values(state.doc.bindings)) {
		const fromShapeId = mapping.get(binding.fromShapeId);
		if (!fromShapeId) continue;
		const id = createId('binding');
		const toShapeId = mapping.get(binding.toShapeId) ?? binding.toShapeId;
		bindings[id] = { ...EditorBindingRecord.clone(binding), id, fromShapeId, toShapeId };
	}
	for (const source of included) {
		const id = mapping.get(source.id);
		const copy = id ? shapes[id] : undefined;
		if (!id || !copy || copy.type !== 'arrow' || source.type !== 'arrow') continue;
		const copiedBindings = Object.values(bindings).filter((binding) => binding.fromShapeId === id);
		const handleBinding = (handle: 'start' | 'end') => {
			const originalBindingId = source.props[handle].bindingId;
			const original = originalBindingId ? state.doc.bindings[originalBindingId] : undefined;
			const copied = copiedBindings.find(
				(binding) =>
					original &&
					binding.toShapeId === (mapping.get(original.toShapeId) ?? original.toShapeId) &&
					binding.handle === handle
			);
			return copied ? { kind: 'bound' as const, bindingId: copied.id } : { kind: 'free' as const };
		};
		shapes[id] = { ...copy, props: { ...copy.props, start: handleBinding('start'), end: handleBinding('end') } };
	}
	return {
		...state,
		doc: { ...state.doc, pages, shapes, bindings, ...(layers ? { layers } : {}) },
		ui: { ...state.ui, selectionIds: rootCopies }
	};
}

function reorderSelection(state: EditorState, direction: 'forward' | 'backward'): EditorState | null {
	const next = reorderShapes(state, state.ui.selectionIds, direction);
	return next === state ? null : next;
}

function hasSelectedAncestor(state: EditorState, id: string, selected: ReadonlySet<string>): boolean {
	let parentId = state.doc.shapes[id]?.groupId;
	while (parentId) {
		if (selected.has(parentId)) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}

function hasAncestor(
	shape: import('@inkfinite/core').EditorShapeRecord,
	ancestorId: string,
	state: EditorState
): boolean {
	let parentId = shape.groupId;
	while (parentId) {
		if (parentId === ancestorId) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
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
