<script lang="ts">
	import HistoryViewer from '$lib/components/HistoryViewer.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import FileBrowser from '$lib/filebrowser/FileBrowser.svelte';
	import { createCanvasController } from './canvas-store.svelte.ts';

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let textEditorEl = $state<HTMLTextAreaElement | null>(null);
	let historyViewerOpen = $state(false);

	const c = createCanvasController({
		setHistoryViewerOpen(value: boolean) {
			historyViewerOpen = value;
		}
	});

	let platform = $derived(c.platform());
	let textEditorCurrent = $derived(c.textEditor.current);
	let persistenceStatusStore = $derived(c.persistenceStatusStore());
	let marqueeRect = $derived(c.marqueeRect());

	$effect(() => {
		c.setCanvasRef(canvasEl);
		return () => c.setCanvasRef(null);
	});

	$effect(() => {
		c.textEditor.setRef(textEditorEl);
		return () => c.textEditor.setRef(null);
	});
</script>

<div class="editor">
	<TitleBar
		{platform}
		desktop={{
			fileName: c.desktop.fileName,
			recentBoards: c.desktop.boards,
			onOpen: c.desktop.handleOpen,
			onNew: c.desktop.handleNew,
			onSaveAs: () => c.desktop.handleSaveAs(null),
			onSelectBoard: c.desktop.handleRecentSelect
		}}
		onOpenBrowser={c.fileBrowser.handleOpen} />
	<Toolbar
		currentTool={c.tools.currentToolId}
		onToolChange={c.tools.handleChange}
		onHistoryClick={c.history.handleClick}
		store={c.store}
		getViewport={c.getViewport}
		canvas={canvasEl ?? undefined}
		brushStore={c.brushStore} />
	<div class="canvas-container">
		<canvas
			bind:this={canvasEl}
			ondblclick={c.handleCanvasDoubleClick}
			onpointerleave={c.handlePointerLeave}></canvas>
		{#if textEditorCurrent}
			{@const layout = c.textEditor.getLayout()}
			{#if layout}
				<textarea
					bind:this={textEditorEl}
					class="canvas-text-editor"
					style={`left:${layout.left}px;top:${layout.top}px;width:${layout.width}px;height:${layout.height}px;font-size:${layout.fontSize}px;`}
					value={textEditorCurrent.value}
					oninput={c.textEditor.handleInput}
					onkeydown={c.textEditor.handleKeyDown}
					onblur={c.textEditor.handleBlur}
					spellcheck="false"></textarea>
			{/if}
		{/if}
		{#if marqueeRect}
			<div
				class="canvas-marquee"
				style={`left:${marqueeRect.left}px;top:${marqueeRect.top}px;width:${marqueeRect.width}px;height:${marqueeRect.height}px;`}>
			</div>
		{/if}
	</div>
	<HistoryViewer store={c.store} bind:open={historyViewerOpen} onClose={c.history.handleClose} />
	<StatusBar
		store={c.store}
		cursor={c.cursorStore}
		persistence={persistenceStatusStore}
		snap={c.snapStore} />
	{#if c.fileBrowser.vm && c.fileBrowser.open}
		<FileBrowser
			bind:vm={c.fileBrowser.vm}
			bind:open={c.fileBrowser.open}
			onUpdate={c.fileBrowser.handleUpdate}
			fetchInspectorData={c.fileBrowser.fetchInspectorData}
			onClose={c.fileBrowser.handleClose}
			desktopRepo={c.desktop.repo} />
	{/if}
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

	.canvas-marquee {
		position: absolute;
		border: 1px solid rgba(136, 192, 208, 0.7);
		background-color: rgba(136, 192, 208, 0.2);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2) inset;
		pointer-events: none;
		z-index: 1;
	}
</style>
