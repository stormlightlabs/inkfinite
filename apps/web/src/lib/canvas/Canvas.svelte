<script lang="ts">
	import {
		ArrowTool,
		EllipseTool,
		LineTool,
		PageRecord,
		RectTool,
		SelectTool,
		ShapeRecord,
		Store,
		TextTool,
		createToolMap,
		routeAction,
		switchTool,
		type Action,
		type ToolId,
		type Viewport
	} from 'inkfinite-core';
	import { createRenderer, type Renderer } from 'inkfinite-renderer';
	import { onDestroy, onMount } from 'svelte';
	import HistoryViewer from '../components/HistoryViewer.svelte';
	import Toolbar from '../components/Toolbar.svelte';
	import { createInputAdapter, type InputAdapter } from '../input';

	const store = new Store();

	store.setState((state) => {
		const page = PageRecord.create('Page 1');
		const rect1 = ShapeRecord.createRect(page.id, -200, -100, {
			w: 150,
			h: 100,
			fill: '#ff6b6b',
			stroke: '#c92a2a',
			radius: 8
		});
		const rect2 = ShapeRecord.createRect(page.id, 50, -50, {
			w: 120,
			h: 80,
			fill: '#4dabf7',
			stroke: '#1971c2',
			radius: 8
		});
		const ellipse = ShapeRecord.createEllipse(page.id, -100, 100, {
			w: 100,
			h: 100,
			fill: '#51cf66',
			stroke: '#2f9e44'
		});

		page.shapeIds.push(rect1.id, rect2.id, ellipse.id);

		return {
			...state,
			doc: {
				...state.doc,
				pages: { [page.id]: page },
				shapes: { [rect1.id]: rect1, [rect2.id]: rect2, [ellipse.id]: ellipse }
			},
			ui: { ...state.ui, currentPageId: page.id }
		};
	});

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
		renderer = createRenderer(canvas, store);

		function getViewport(): Viewport {
			const rect = canvas.getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		}

		function getCamera() {
			return store.getState().camera;
		}

		inputAdapter = createInputAdapter({ canvas, getCamera, getViewport, onAction: handleAction });
	});

	onDestroy(() => {
		renderer?.dispose();
		inputAdapter?.dispose();
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
