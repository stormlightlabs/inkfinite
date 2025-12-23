<script lang="ts">
	import HistoryViewer from '$lib/components/HistoryViewer.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { createCanvasController } from './canvas-store.svelte.ts';

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let textEditorEl = $state<HTMLTextAreaElement | null>(null);
	let historyViewerOpen = $state(false);

	const controller = createCanvasController({
		setHistoryViewerOpen(value: boolean) {
			historyViewerOpen = value;
		}
	});

	const {
		platform: readPlatform,
		desktopBoards: readDesktopBoards,
		desktopFileName: readDesktopFileName,
		handleDesktopOpen,
		handleDesktopNewBoard,
		handleDesktopSaveAs,
		handleDesktopRecentSelect,
		currentToolId: readCurrentToolId,
		handleToolChange,
		handleHistoryClick,
		handleHistoryClose,
		store,
		getViewport,
		handleCanvasDoubleClick,
		handlePointerLeave,
		textEditor: readTextEditor,
		getTextEditorLayout,
		handleTextEditorInput,
		handleTextEditorKeyDown,
		handleTextEditorBlur,
		cursorStore,
		persistenceStatusStore: readPersistenceStatusStore,
		snapStore,
		setCanvasRef,
		setTextEditorElRef
	} = controller;

	let platform = $derived(readPlatform());
	let desktopBoards = $derived(readDesktopBoards());
	let desktopFileName = $derived(readDesktopFileName());
	let currentToolId = $derived(readCurrentToolId());
	let textEditor = $derived(readTextEditor());
	let persistenceStatusStore = $derived(readPersistenceStatusStore());

	$effect(() => {
		setCanvasRef(canvasEl);
		return () => setCanvasRef(null);
	});

	$effect(() => {
		setTextEditorElRef(textEditorEl);
		return () => setTextEditorElRef(null);
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
		canvas={canvasEl ?? undefined} />
	<div class="canvas-container">
		<canvas
			bind:this={canvasEl}
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
