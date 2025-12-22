<script lang="ts">
	import HistoryViewer from '$lib/components/HistoryViewer.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { createInputAdapter, type InputAdapter } from '$lib/input';
	import { createPersistenceManager } from '$lib/status';
	import {
		ArrowTool,
		CursorStore,
		EditorState,
		EllipseTool,
		InkfiniteDB,
		LineTool,
		RectTool,
		SelectTool,
		SnapshotCommand,
		Store,
		TextTool,
		createToolMap,
		createWebDocRepo,
		diffDoc,
		routeAction,
		switchTool,
		type Action,
		type CommandKind,
		type LoadedDoc,
		type PersistenceSink,
		type ToolId,
		type Viewport
	} from 'inkfinite-core';
	import { createRenderer, type Renderer } from 'inkfinite-renderer';
	import { onDestroy, onMount } from 'svelte';

	let repo: ReturnType<typeof createWebDocRepo> | null = null;
	let sink: PersistenceSink | null = null;
	let persistenceManager: ReturnType<typeof createPersistenceManager> | null = null;
	let activeBoardId: string | null = null;

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

	function applyLoadedDoc(doc: LoadedDoc) {
		const firstPageId = doc.order.pageIds[0] ?? Object.keys(doc.pages)[0] ?? null;
		store.setState((state) => ({
			...state,
			doc: { pages: doc.pages, shapes: doc.shapes, bindings: doc.bindings },
			ui: { ...state.ui, currentPageId: firstPageId }
		}));
	}

	const selectTool = new SelectTool();
	const rectTool = new RectTool();
	const ellipseTool = new EllipseTool();
	const lineTool = new LineTool();
	const arrowTool = new ArrowTool();
	const textTool = new TextTool();
	const tools = createToolMap([selectTool, rectTool, ellipseTool, lineTool, arrowTool, textTool]);

	let currentToolId = $state<ToolId>('select');
	let historyViewerOpen = $state(false);

	store.subscribe((state) => {
		currentToolId = state.ui.toolId;
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

	function applyActionWithHistory(action: Action) {
		const before = store.getState();
		const nextState = routeAction(before, action, tools);
		if (statesEqual(before, nextState)) {
			return;
		}

		const kind = getCommandKind(before, nextState);
		const commandName = describeAction(action, kind);
		const command = new SnapshotCommand(commandName, kind, EditorState.clone(before), EditorState.clone(nextState));
		store.executeCommand(command);
	}

	function handleAction(action: Action) {
		if (action.type === 'key-down') {
			const isPrimary =
				(action.modifiers.meta && navigator.platform.toUpperCase().includes('MAC')) ||
				(action.modifiers.ctrl && !navigator.platform.toUpperCase().includes('MAC'));

			if (isPrimary && !action.modifiers.shift && (action.key === 'z' || action.key === 'Z')) {
				store.undo();
				return;
			}

			if (isPrimary && action.modifiers.shift && (action.key === 'z' || action.key === 'Z')) {
				store.redo();
				return;
			}
		}

		applyActionWithHistory(action);
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

	let canvas: HTMLCanvasElement;
	let renderer: Renderer | null = null;
	let inputAdapter: InputAdapter | null = null;

	onMount(() => {
		const db = new InkfiniteDB();
		repo = createWebDocRepo(db);
		persistenceManager = createPersistenceManager(db, repo, { sink: { debounceMs: 200 } });
		sink = persistenceManager.sink;
		let disposed = false;

		const hydrate = async () => {
			const repoInstance = repo;
			if (!repoInstance) {
				return;
			}
			try {
				const boards = await repoInstance.listBoards();
				const id = boards[0]?.id ?? (await repoInstance.createBoard('My board'));
				if (disposed) {
					return;
				}
				activeBoardId = id;
				const loaded = await repoInstance.loadDoc(id);
				if (!disposed) {
					persistenceManager?.setActiveBoard(id);
					applyLoadedDoc(loaded);
				}
			} catch (error) {
				console.error('Failed to load board', error);
			}
		};

		hydrate();

		function getViewport(): Viewport {
			const rect = canvas.getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		}

		function getCamera() {
			return store.getState().camera;
		}

		renderer = createRenderer(canvas, store);
		inputAdapter = createInputAdapter({
			canvas,
			getCamera,
			getViewport,
			onAction: handleAction,
			onCursorUpdate: (world, screen) => cursorStore.updateCursor(world, screen)
		});

		function handleBeforeUnload() {
			if (sink) {
				void sink.flush();
			}
		}

		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			disposed = true;
			window.removeEventListener('beforeunload', handleBeforeUnload);
		};
	});

	onDestroy(() => {
		renderer?.dispose();
		inputAdapter?.dispose();
		if (sink) {
			void sink.flush();
		}
		repo = null;
		sink = null;
		activeBoardId = null;
		persistenceManager?.dispose();
		persistenceManager = null;
	});
</script>

<div class="editor">
	<Toolbar currentTool={currentToolId} onToolChange={handleToolChange} onHistoryClick={handleHistoryClick} />
	<canvas bind:this={canvas}></canvas>
	<HistoryViewer {store} bind:open={historyViewerOpen} onClose={handleHistoryClose} />
</div>

<style>
	.editor {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	canvas {
		flex: 1;
		display: block;
		touch-action: none;
		cursor: default;
	}
</style>
