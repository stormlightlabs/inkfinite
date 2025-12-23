<script lang="ts">
	import HistoryViewer from '$lib/components/HistoryViewer.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { createInputAdapter, type InputAdapter } from '$lib/input';
	import type { DesktopDocRepo } from '$lib/persistence/desktop';
	import { createPlatformRepo, detectPlatform } from '$lib/platform';
	import {
		createPersistenceManager,
		createSnapStore,
		createStatusStore,
		type SnapStore,
		type StatusStore
	} from '$lib/status';
	import {
		ArrowTool,
		Camera,
		CursorStore,
		EditorState,
		EllipseTool,
		LineTool,
		RectTool,
		SelectTool,
		ShapeRecord,
		SnapshotCommand,
		Store,
		TextTool,
		createToolMap,
		diffDoc,
		getShapesOnCurrentPage,
		routeAction,
		shapeBounds,
		switchTool,
		type Action,
		type BoardMeta,
		type CommandKind,
		type DocRepo,
		type LoadedDoc,
		type PersistenceSink,
		type ToolId,
		type Viewport
	} from 'inkfinite-core';
	import { createRenderer, type Renderer } from 'inkfinite-renderer';
	import { onDestroy, onMount } from 'svelte';

	let repo: DocRepo | null = null;
	let sink: PersistenceSink | null = null;
	let persistenceManager: ReturnType<typeof createPersistenceManager> | null = null;
	const platform = detectPlatform();
	const fallbackStatusStore = createStatusStore({
		backend: platform === 'desktop' ? 'filesystem' : 'indexeddb',
		state: 'saved',
		pendingWrites: 0
	});
	let persistenceStatusStore = $state<StatusStore>(fallbackStatusStore);
	let activeBoardId: string | null = null;
	let desktopRepo: DesktopDocRepo | null = null;
	let desktopBoards = $state<BoardMeta[]>([]);
	let desktopFileName = $state<string | null>(null);
	let removeBeforeUnload: (() => void) | null = null;

	const store = new Store(undefined, {
		onHistoryEvent: (event) => {
			if (!activeBoardId || event.kind !== 'doc' || !sink) {
				return;
			}
			const patch = diffDoc(event.beforeState.doc, event.afterState.doc);
			sink.enqueueDocPatch(activeBoardId, patch);
		}
	});
	const cursorStore = new CursorStore();
	const snapStore: SnapStore = createSnapStore();
	const pointerState = $state({
		isPointerDown: false,
		snappedWorld: null as { x: number; y: number } | null
	});
	const handleState = $state<{ hover: string | null; active: string | null }>({
		hover: null,
		active: null
	});
	let textEditor = $state<{ shapeId: string; value: string } | null>(null);
	let textEditorEl = $state<HTMLTextAreaElement | null>(null);
	const panState = $state({ isPanning: false, spaceHeld: false, lastScreen: { x: 0, y: 0 } });
	const snapProvider = { get: () => snapStore.get() };
	const cursorProvider = { get: () => cursorStore.getState() };
	const pointerStateProvider = { get: () => pointerState };
	const handleProvider = { get: () => ({ ...handleState }) };
	let pendingCommandStart: EditorState | null = null;

	function applyLoadedDoc(doc: LoadedDoc) {
		const firstPageId = doc.order.pageIds[0] ?? Object.keys(doc.pages)[0] ?? null;
		store.setState((state) => ({
			...state,
			doc: { pages: doc.pages, shapes: doc.shapes, bindings: doc.bindings },
			ui: { ...state.ui, currentPageId: firstPageId, selectionIds: [] }
		}));
		initializeSelection(firstPageId, doc);
	}

	function initializeSelection(pageId: string | null, doc: LoadedDoc) {
		if (!pageId) {
			return;
		}
		const page = doc.pages[pageId];
		const firstShapeId = page?.shapeIds[0];
		if (!firstShapeId) {
			return;
		}
		const state = editorSnapshot;
		if (state.ui.selectionIds.length === 1 && state.ui.selectionIds[0] === firstShapeId) {
			return;
		}
		const before = EditorState.clone(state);
		const after = { ...state, ui: { ...state.ui, selectionIds: [firstShapeId] } };
		const command = new SnapshotCommand(
			'Initialize Selection',
			'ui',
			before,
			EditorState.clone(after)
		);
		store.executeCommand(command);
		syncHandleState();
	}

	function setActiveBoardId(boardId: string) {
		activeBoardId = boardId;
		persistenceManager?.setActiveBoard(boardId);
	}

	function updateDesktopFileState() {
		if (!desktopRepo) {
			desktopFileName = null;
			return;
		}
		const handle = desktopRepo.getCurrentFile();
		desktopFileName = handle?.name ?? null;
	}

	async function refreshDesktopBoards(): Promise<BoardMeta[]> {
		if (!desktopRepo) {
			desktopBoards = [];
			return [];
		}
		try {
			const boards = await desktopRepo.listBoards();
			desktopBoards = boards;
			return boards;
		} catch (error) {
			console.error('Failed to list boards', error);
			desktopBoards = [];
			return [];
		}
	}

	function isUserCancelled(error: unknown) {
		return error instanceof Error && /cancel/i.test(error.message);
	}

	const handleCursorMap: Record<string, string> = {
		n: 'ns-resize',
		s: 'ns-resize',
		e: 'ew-resize',
		w: 'ew-resize',
		ne: 'nesw-resize',
		sw: 'nesw-resize',
		nw: 'nwse-resize',
		se: 'nwse-resize',
		rotate: 'alias',
		'line-start': 'crosshair',
		'line-end': 'crosshair'
	};

	function refreshCursor() {
		if (!canvas) {
			return;
		}
		let cursor = 'default';
		if (textEditor) {
			cursor = 'text';
		} else if (panState.isPanning) {
			cursor = 'grabbing';
		} else if (panState.spaceHeld) {
			cursor = 'grab';
		} else {
			const activeHandle = handleState.active;
			const hoverHandle = handleState.hover;
			const targetHandle = activeHandle ?? hoverHandle;
			if (targetHandle) {
				cursor = handleCursorMap[targetHandle] ?? 'default';
			} else if (pointerState.isPointerDown) {
				cursor = 'grabbing';
			}
		}
		canvas.style.cursor = cursor;
	}

	function setHandleHover(handle: string | null) {
		if (handleState.hover === handle) {
			return;
		}
		handleState.hover = handle;
		refreshCursor();
	}

	function syncHandleState() {
		handleState.active = selectTool.getActiveHandle ? selectTool.getActiveHandle() : null;
		refreshCursor();
	}

	function getTextEditorLayout() {
		if (!textEditor) {
			return null;
		}
		const state = store.getState();
		const shape = state.doc.shapes[textEditor.shapeId];
		if (!shape || shape.type !== 'text') {
			return null;
		}
		const viewport = getViewport();
		const screenPos = Camera.worldToScreen(state.camera, { x: shape.x, y: shape.y }, viewport);
		const widthWorld = shape.props.w ?? 240;
		const zoom = state.camera.zoom;
		return {
			left: screenPos.x,
			top: screenPos.y,
			width: widthWorld * zoom,
			height: shape.props.fontSize * 1.4 * zoom,
			fontSize: shape.props.fontSize * zoom
		};
	}

	function startTextEditing(shapeId: string) {
		const state = store.getState();
		const shape = state.doc.shapes[shapeId];
		if (!shape || shape.type !== 'text') {
			return;
		}
		textEditor = { shapeId, value: shape.props.text };
		refreshCursor();
		queueMicrotask(() => {
			textEditorEl?.focus();
			textEditorEl?.select();
		});
	}

	function commitTextEditing() {
		if (!textEditor) {
			return;
		}
		const { shapeId, value } = textEditor;
		const currentState = store.getState();
		const shape = currentState.doc.shapes[shapeId];
		textEditor = null;
		refreshCursor();
		if (!shape || shape.type !== 'text' || shape.props.text === value) {
			return;
		}
		const before = EditorState.clone(currentState);
		const updatedShape = { ...shape, props: { ...shape.props, text: value } };
		const newShapes = { ...currentState.doc.shapes, [shapeId]: updatedShape };
		const after = { ...currentState, doc: { ...currentState.doc, shapes: newShapes } };
		const command = new SnapshotCommand('Edit text', 'doc', before, EditorState.clone(after));
		store.executeCommand(command);
	}

	function cancelTextEditing() {
		textEditor = null;
		refreshCursor();
	}

	function handleCanvasDoubleClick(event: MouseEvent) {
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		const world = Camera.screenToWorld(store.getState().camera, screen, getViewport());
		const shapeId = findTextShapeAt(world);
		if (shapeId) {
			startTextEditing(shapeId);
		}
	}

	function findTextShapeAt(point: { x: number; y: number }): string | null {
		const shapes = getShapesOnCurrentPage(store.getState());
		for (let index = shapes.length - 1; index >= 0; index--) {
			const shape = shapes[index];
			if (!shape || shape.type !== 'text') {
				continue;
			}
			const bounds = shapeBounds(shape);
			if (
				point.x >= bounds.min.x &&
				point.x <= bounds.max.x &&
				point.y >= bounds.min.y &&
				point.y <= bounds.max.y
			) {
				return shape.id;
			}
		}
		return null;
	}

	function handleTextEditorInput(event: Event) {
		if (!textEditor) {
			return;
		}
		const target = event.currentTarget as HTMLTextAreaElement;
		textEditor = { ...textEditor, value: target.value };
	}

	function handleTextEditorKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelTextEditing();
			return;
		}
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			commitTextEditing();
		}
	}

	function handleTextEditorBlur() {
		commitTextEditing();
	}

	function handlePointerLeave() {
		setHandleHover(null);
	}

	const selectTool = new SelectTool();
	const rectTool = new RectTool();
	const ellipseTool = new EllipseTool();
	const lineTool = new LineTool();
	const arrowTool = new ArrowTool();
	const textTool = new TextTool();
	const tools = createToolMap([selectTool, rectTool, ellipseTool, lineTool, arrowTool, textTool]);

	let currentToolId = $state<ToolId>('select');
	let editorSnapshot = $state(store.getState());
	let historyViewerOpen = $state(false);

	store.subscribe((state) => {
		currentToolId = state.ui.toolId;
		editorSnapshot = state;
	});

	function handleToolChange(toolId: ToolId) {
		store.setState((state) => switchTool(state, toolId, tools));
	}

	function handleHistoryClick() {
		historyViewerOpen = true;
	}

	function handleHistoryClose() {
		historyViewerOpen = false;
	}

	function handleBringForward() {
		const currentState = store.getState();
		const selectedIds = currentState.ui.selectionIds;
		const currentPageId = currentState.ui.currentPageId;

		if (selectedIds.length === 0 || !currentPageId) {
			return;
		}

		const before = EditorState.clone(currentState);
		const page = currentState.doc.pages[currentPageId];
		if (!page) return;

		const newShapeIds = [...page.shapeIds];

		for (const shapeId of selectedIds) {
			const currentIndex = newShapeIds.indexOf(shapeId);
			if (currentIndex !== -1 && currentIndex < newShapeIds.length - 1) {
				[newShapeIds[currentIndex], newShapeIds[currentIndex + 1]] = [
					newShapeIds[currentIndex + 1],
					newShapeIds[currentIndex]
				];
			}
		}

		const after = {
			...currentState,
			doc: {
				...currentState.doc,
				pages: { ...currentState.doc.pages, [currentPageId]: { ...page, shapeIds: newShapeIds } }
			}
		};

		const command = new SnapshotCommand('Bring Forward', 'doc', before, EditorState.clone(after));
		store.executeCommand(command);
		syncHandleState();
	}

	function handleSendBackward() {
		const currentState = store.getState();
		const selectedIds = currentState.ui.selectionIds;
		const currentPageId = currentState.ui.currentPageId;

		if (selectedIds.length === 0 || !currentPageId) {
			return;
		}

		const before = EditorState.clone(currentState);
		const page = currentState.doc.pages[currentPageId];
		if (!page) return;

		const newShapeIds = [...page.shapeIds];

		for (let i = selectedIds.length - 1; i >= 0; i--) {
			const shapeId = selectedIds[i];
			const currentIndex = newShapeIds.indexOf(shapeId);
			if (currentIndex > 0) {
				[newShapeIds[currentIndex], newShapeIds[currentIndex - 1]] = [
					newShapeIds[currentIndex - 1],
					newShapeIds[currentIndex]
				];
			}
		}

		const after = {
			...currentState,
			doc: {
				...currentState.doc,
				pages: { ...currentState.doc.pages, [currentPageId]: { ...page, shapeIds: newShapeIds } }
			}
		};

		const command = new SnapshotCommand('Send Backward', 'doc', before, EditorState.clone(after));
		store.executeCommand(command);
		syncHandleState();
	}

	function handleDuplicate() {
		const currentState = store.getState();
		const selectedIds = currentState.ui.selectionIds;

		if (selectedIds.length === 0) {
			return;
		}

		const before = EditorState.clone(currentState);
		const newShapes = { ...currentState.doc.shapes };
		const newPages = { ...currentState.doc.pages };
		const duplicatedIds: string[] = [];

		const DUPLICATE_OFFSET = 20;

		for (const shapeId of selectedIds) {
			const shape = currentState.doc.shapes[shapeId];
			if (!shape) continue;

			const cloned = ShapeRecord.clone(shape);
			const newId = `shape:${crypto.randomUUID()}`;
			const duplicated = {
				...cloned,
				id: newId,
				x: shape.x + DUPLICATE_OFFSET,
				y: shape.y + DUPLICATE_OFFSET
			};

			newShapes[newId] = duplicated;
			duplicatedIds.push(newId);

			const currentPageId = currentState.ui.currentPageId;
			if (currentPageId) {
				const page = newPages[currentPageId];
				if (page) {
					newPages[currentPageId] = { ...page, shapeIds: [...page.shapeIds, newId] };
				}
			}
		}

		const after = {
			...currentState,
			doc: { ...currentState.doc, shapes: newShapes, pages: newPages },
			ui: { ...currentState.ui, selectionIds: duplicatedIds }
		};

		const command = new SnapshotCommand('Duplicate', 'doc', before, EditorState.clone(after));
		store.executeCommand(command);
		syncHandleState();
	}

	function handleNudge(arrowKey: string, largeNudge: boolean) {
		const currentState = store.getState();
		const selectedIds = currentState.ui.selectionIds;

		if (selectedIds.length === 0) {
			return;
		}

		const nudgeDistance = largeNudge ? 10 : 1;
		let deltaX = 0;
		let deltaY = 0;

		switch (arrowKey) {
			case 'ArrowLeft':
				deltaX = -nudgeDistance;
				break;
			case 'ArrowRight':
				deltaX = nudgeDistance;
				break;
			case 'ArrowUp':
				deltaY = -nudgeDistance;
				break;
			case 'ArrowDown':
				deltaY = nudgeDistance;
				break;
		}

		const before = EditorState.clone(currentState);
		const newShapes = { ...currentState.doc.shapes };

		for (const shapeId of selectedIds) {
			const shape = newShapes[shapeId];
			if (shape) {
				newShapes[shapeId] = { ...shape, x: shape.x + deltaX, y: shape.y + deltaY };
			}
		}

		const after = { ...currentState, doc: { ...currentState.doc, shapes: newShapes } };
		const command = new SnapshotCommand('Nudge', 'doc', before, EditorState.clone(after));
		store.executeCommand(command);
		syncHandleState();
	}

	function applyActionWithHistory(action: Action) {
		const before = store.getState();
		const nextState = routeAction(before, action, tools);
		if (statesEqual(before, nextState)) {
			syncHandleState();
			return;
		}

		const kind = getCommandKind(before, nextState);
		const commandName = describeAction(action, kind);
		const command = new SnapshotCommand(
			commandName,
			kind,
			EditorState.clone(before),
			EditorState.clone(nextState)
		);
		store.executeCommand(command);
		syncHandleState();
	}

	function handleAction(action: Action) {
		if (textEditor && (action.type === 'pointer-down' || action.type === 'pointer-up')) {
			commitTextEditing();
		}

		if (
			action.type === 'pointer-move' &&
			'world' in action &&
			!panState.isPanning &&
			!panState.spaceHeld
		) {
			const hover = selectTool.getHandleAtPoint(store.getState(), action.world);
			setHandleHover(hover);
		}

		if (action.type === 'pointer-move' && (panState.isPanning || panState.spaceHeld)) {
			setHandleHover(null);
		}

		if (action.type === 'key-down' && action.key === ' ') {
			panState.spaceHeld = true;
			setHandleHover(null);
			refreshCursor();
			return;
		}

		if (action.type === 'key-up' && action.key === ' ') {
			panState.spaceHeld = false;
			panState.isPanning = false;
			refreshCursor();
			return;
		}

		if (action.type === 'pointer-down' && action.button === 0 && panState.spaceHeld) {
			panState.isPanning = true;
			panState.lastScreen = { x: action.screen.x, y: action.screen.y };
			refreshCursor();
			return;
		}

		if (action.type === 'pointer-move' && panState.isPanning) {
			const deltaX = action.screen.x - panState.lastScreen.x;
			const deltaY = action.screen.y - panState.lastScreen.y;
			const currentCamera = store.getState().camera;
			const newCamera = Camera.pan(currentCamera, { x: deltaX, y: deltaY });
			store.setState((state) => ({ ...state, camera: newCamera }));
			panState.lastScreen = { x: action.screen.x, y: action.screen.y };
			refreshCursor();
			return;
		}

		if (action.type === 'pointer-up' && action.button === 0 && panState.isPanning) {
			panState.isPanning = false;
			refreshCursor();
			return;
		}

		if (panState.isPanning || panState.spaceHeld) {
			return;
		}

		const actionWithSnap = applySnapping(action);
		if ('world' in actionWithSnap) {
			pointerState.snappedWorld = actionWithSnap.world ?? null;
		}

		if (actionWithSnap.type === 'pointer-down' && actionWithSnap.button === 0) {
			pointerState.isPointerDown = true;
			setHandleHover(null);
			refreshCursor();
			pendingCommandStart = EditorState.clone(store.getState());
			const changed = applyImmediateAction(actionWithSnap);
			if (!changed) {
				pendingCommandStart = null;
			}
			return;
		}

		if (
			actionWithSnap.type === 'pointer-move' &&
			pointerState.isPointerDown &&
			pendingCommandStart
		) {
			void applyImmediateAction(actionWithSnap);
			return;
		}

		if (actionWithSnap.type === 'pointer-up' && actionWithSnap.button === 0) {
			pointerState.isPointerDown = false;
			setHandleHover(null);
			refreshCursor();
			if (pendingCommandStart) {
				const committed = commitPendingCommand(actionWithSnap, pendingCommandStart);
				pendingCommandStart = null;
				if (committed) {
					return;
				}
			}
			pointerState.snappedWorld = null;
		}

		if (actionWithSnap.type === 'key-down') {
			const isPrimary =
				(actionWithSnap.modifiers.meta && navigator.platform.toUpperCase().includes('MAC')) ||
				(actionWithSnap.modifiers.ctrl && !navigator.platform.toUpperCase().includes('MAC'));

			if (
				isPrimary &&
				!actionWithSnap.modifiers.shift &&
				(actionWithSnap.key === 'z' || actionWithSnap.key === 'Z')
			) {
				store.undo();
				return;
			}

			if (
				isPrimary &&
				actionWithSnap.modifiers.shift &&
				(actionWithSnap.key === 'z' || actionWithSnap.key === 'Z')
			) {
				store.redo();
				return;
			}

			if (isPrimary && (actionWithSnap.key === 'd' || actionWithSnap.key === 'D')) {
				handleDuplicate();
				return;
			}

			if (isPrimary && actionWithSnap.key === ']') {
				handleBringForward();
				return;
			}

			if (isPrimary && actionWithSnap.key === '[') {
				handleSendBackward();
				return;
			}

			if (actionWithSnap.key.startsWith('Arrow')) {
				handleNudge(actionWithSnap.key, actionWithSnap.modifiers.shift);
				return;
			}
		}

		applyActionWithHistory(actionWithSnap);
	}

	function applyImmediateAction(action: Action): boolean {
		const before = store.getState();
		const nextState = routeAction(before, action, tools);
		if (statesEqual(before, nextState)) {
			syncHandleState();
			return false;
		}
		store.setState(() => nextState);
		syncHandleState();
		return true;
	}

	function commitPendingCommand(action: Action, startState: EditorState): boolean {
		const before = store.getState();
		const nextState = routeAction(before, action, tools);
		const finalState = statesEqual(before, nextState) ? before : nextState;
		if (statesEqual(startState, finalState)) {
			syncHandleState();
			return false;
		}
		const kind = getCommandKind(startState, finalState);
		const commandName = describeAction(action, kind);
		const command = new SnapshotCommand(
			commandName,
			kind,
			EditorState.clone(startState),
			EditorState.clone(finalState)
		);
		store.executeCommand(command);
		syncHandleState();
		return true;
	}

	function statesEqual(a: EditorState, b: EditorState): boolean {
		return a.doc === b.doc && a.camera === b.camera && a.ui === b.ui;
	}

	function getCommandKind(before: EditorState, after: EditorState): CommandKind {
		if (before.doc !== after.doc) {
			return 'doc';
		}
		if (before.camera !== after.camera) {
			return 'camera';
		}
		return 'ui';
	}

	function describeAction(action: Action, kind: CommandKind): string {
		switch (action.type) {
			case 'pointer-down':
				return 'Pointer down';
			case 'pointer-move':
				return 'Pointer move';
			case 'pointer-up':
				return 'Pointer up';
			case 'wheel':
				return 'Wheel';
			case 'key-down':
				return 'Key down';
			case 'key-up':
				return 'Key up';
			default:
				return kind === 'doc' ? 'Edit' : kind === 'camera' ? 'Camera change' : 'UI change';
		}
	}

	async function handleDesktopOpen() {
		if (!desktopRepo || !repo) {
			return;
		}
		try {
			const opened = await desktopRepo.openFromDialog();
			setActiveBoardId(opened.boardId);
			applyLoadedDoc(opened.doc);
			updateDesktopFileState();
			await refreshDesktopBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to open board', error);
		}
	}

	async function handleDesktopNewBoard() {
		if (!repo) {
			return;
		}
		try {
			const boardId = await repo.createBoard('Untitled');
			const loaded = await repo.loadDoc(boardId);
			setActiveBoardId(boardId);
			applyLoadedDoc(loaded);
			updateDesktopFileState();
			await refreshDesktopBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to create board', error);
		}
	}

	async function handleDesktopSaveAs() {
		if (!repo || !activeBoardId) {
			return;
		}
		try {
			const snapshot = await repo.exportBoard(activeBoardId);
			const newBoardId = await repo.importBoard(snapshot);
			const loaded = await repo.loadDoc(newBoardId);
			setActiveBoardId(newBoardId);
			applyLoadedDoc(loaded);
			updateDesktopFileState();
			await refreshDesktopBoards();
		} catch (error) {
			if (isUserCancelled(error)) {
				return;
			}
			console.error('Failed to save board', error);
		}
	}

	async function handleDesktopRecentSelect(boardId: string) {
		if (!repo) {
			return;
		}
		try {
			const loaded = await repo.loadDoc(boardId);
			setActiveBoardId(boardId);
			applyLoadedDoc(loaded);
			updateDesktopFileState();
			await refreshDesktopBoards();
		} catch (error) {
			console.error('Failed to load board', error);
		}
	}

	function applySnapping(action: Action): Action {
		const snap = snapStore.get();
		if (!snap.snapEnabled || !snap.gridEnabled) {
			return action;
		}
		if (!('world' in action)) {
			return action;
		}
		const snapCoord = (value: number) => Math.round(value / snap.gridSize) * snap.gridSize;
		const snappedWorld = { x: snapCoord(action.world.x), y: snapCoord(action.world.y) };
		return { ...action, world: snappedWorld };
	}

	let canvas = $state<HTMLCanvasElement>();
	let renderer: Renderer | null = null;
	let inputAdapter: InputAdapter | null = null;

	function getViewport(): Viewport {
		if (canvas) {
			const rect = canvas.getBoundingClientRect();
			return { width: rect.width || 1, height: rect.height || 1 };
		}
		if (typeof window !== 'undefined') {
			return { width: window.innerWidth || 1, height: window.innerHeight || 1 };
		}
		return { width: 1, height: 1 };
	}

	onMount(() => {
		let disposed = false;

		const initialize = async () => {
			const {
				repo: platformRepo,
				platform: detectedPlatform,
				db,
				desktop: desktopInstance
			} = await createPlatformRepo();
			if (disposed) {
				return;
			}
			repo = platformRepo;
			if (detectedPlatform === 'desktop' && desktopInstance) {
				desktopRepo = desktopInstance;
			} else {
				desktopRepo = null;
				desktopBoards = [];
				desktopFileName = null;
			}

			if (detectedPlatform === 'web' && db) {
				persistenceManager = createPersistenceManager(db, repo, { sink: { debounceMs: 200 } });
				sink = persistenceManager.sink;
				persistenceStatusStore = persistenceManager.status;
			} else {
				const { createPersistenceSink } = await import('inkfinite-core');
				if (disposed) {
					return;
				}
				sink = createPersistenceSink(repo, { debounceMs: 500 });
			}

			const hydrate = async () => {
				const repoInstance = repo;
				if (!repoInstance) {
					return;
				}
				try {
					if (detectedPlatform === 'web') {
						const boards = await repoInstance.listBoards();
						const id = boards[0]?.id ?? (await repoInstance.createBoard('My board'));
						if (disposed) {
							return;
						}
						setActiveBoardId(id);
						const loaded = await repoInstance.loadDoc(id);
						if (!disposed) {
							applyLoadedDoc(loaded);
						}
					} else {
						const boards = await refreshDesktopBoards();
						let id = boards[0]?.id ?? null;
						if (!id) {
							id = await repoInstance.createBoard('Untitled');
						}
						if (disposed) {
							return;
						}
						setActiveBoardId(id);
						const loaded = await repoInstance.loadDoc(id);
						if (!disposed) {
							applyLoadedDoc(loaded);
							updateDesktopFileState();
						}
						await refreshDesktopBoards();
					}
				} catch (error) {
					console.error('Failed to load board', error);
				}
			};

			await hydrate();
			if (disposed) {
				return;
			}

			function getCamera() {
				return store.getState().camera;
			}

			const currentCanvas = canvas;
			if (!currentCanvas) {
				return;
			}

			renderer = createRenderer(currentCanvas, store, {
				snapProvider,
				cursorProvider,
				pointerStateProvider,
				handleProvider
			});
			inputAdapter = createInputAdapter({
				canvas: currentCanvas,
				getCamera,
				getViewport,
				onAction: handleAction,
				onCursorUpdate: (world, screen) => cursorStore.updateCursor(world, screen)
			});

			if (typeof window !== 'undefined') {
				function handleBeforeUnload() {
					if (sink) {
						void sink.flush();
					}
				}

				window.addEventListener('beforeunload', handleBeforeUnload);
				removeBeforeUnload = () => window.removeEventListener('beforeunload', handleBeforeUnload);
			}
		};

		void initialize();

		return () => {
			disposed = true;
		};
	});

	onDestroy(() => {
		removeBeforeUnload?.();
		removeBeforeUnload = null;
		renderer?.dispose();
		inputAdapter?.dispose();
		if (sink) {
			void sink.flush();
		}
		repo = null;
		desktopRepo = null;
		desktopBoards = [];
		desktopFileName = null;
		sink = null;
		activeBoardId = null;
		persistenceManager?.dispose();
		persistenceManager = null;
		fallbackStatusStore.update(() => ({ backend: 'indexeddb', state: 'saved', pendingWrites: 0 }));
		persistenceStatusStore = fallbackStatusStore;
	});
</script>

<div class="editor">
	<TitleBar
		{platform}
		desktop={{
			fileName: desktopFileName,
			recentBoards: desktopBoards,
			onOpen: handleDesktopOpen,
			onNew: handleDesktopNewBoard,
			onSaveAs: handleDesktopSaveAs,
			onSelectBoard: handleDesktopRecentSelect
		}} />
	<Toolbar
		currentTool={currentToolId}
		onToolChange={handleToolChange}
		onHistoryClick={handleHistoryClick}
		{store}
		{getViewport}
		{canvas} />
	<div class="canvas-container">
		<canvas
			bind:this={canvas}
			ondblclick={handleCanvasDoubleClick}
			onpointerleave={handlePointerLeave}></canvas>
		{#if textEditor}
			{@const layout = getTextEditorLayout()}
			{#if layout}
				<textarea
					bind:this={textEditorEl}
					class="canvas-text-editor"
					style={`left:${layout.left}px;top:${layout.top}px;width:${layout.width}px;height:${layout.height}px;font-size:${layout.fontSize}px;`}
					value={textEditor.value}
					oninput={handleTextEditorInput}
					onkeydown={handleTextEditorKeyDown}
					onblur={handleTextEditorBlur}
					spellcheck="false"></textarea>
			{/if}
		{/if}
	</div>
	<HistoryViewer {store} bind:open={historyViewerOpen} onClose={handleHistoryClose} />
	<StatusBar {store} cursor={cursorStore} persistence={persistenceStatusStore} snap={snapStore} />
</div>

<style>
	.editor {
		width: 100%;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.canvas-container {
		flex: 1;
		min-height: 0;
		position: relative;
	}

	.canvas-container canvas {
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
		cursor: default;
	}

	.canvas-text-editor {
		position: absolute;
		border: 1px solid var(--accent);
		background: var(--surface);
		color: var(--text);
		padding: 4px;
		transform-origin: top left;
		resize: none;
		outline: none;
		line-height: 1.2;
		font-family: inherit;
		z-index: 2;
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.05),
			0 8px 20px rgba(0, 0, 0, 0.15);
	}
</style>
