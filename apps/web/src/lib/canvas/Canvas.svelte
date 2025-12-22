<script lang="ts">
	import HistoryViewer from '$lib/components/HistoryViewer.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { createInputAdapter, type InputAdapter } from '$lib/input';
	import {
		ArrowTool,
		EllipseTool,
		InkfiniteDB,
		LineTool,
		RectTool,
		SelectTool,
		Store,
		TextTool,
		createPersistenceSink,
		createToolMap,
		createWebDocRepo,
		diffDoc,
		routeAction,
		switchTool,
		type Action,
		type LoadedDoc,
		type ToolId,
		type Viewport
	} from 'inkfinite-core';
	import { createRenderer, type Renderer } from 'inkfinite-renderer';
	import { onDestroy, onMount } from 'svelte';

	let repo: ReturnType<typeof createWebDocRepo> | null = null;
	let sink: ReturnType<typeof createPersistenceSink> | null = null;
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

		store.setState((state) => routeAction(state, action, tools));
	}

	let canvas: HTMLCanvasElement;
	let renderer: Renderer | null = null;
	let inputAdapter: InputAdapter | null = null;

	onMount(() => {
		const db = new InkfiniteDB();
		repo = createWebDocRepo(db);
		sink = createPersistenceSink(repo, { debounceMs: 200 });
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
		inputAdapter = createInputAdapter({ canvas, getCamera, getViewport, onAction: handleAction });

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
