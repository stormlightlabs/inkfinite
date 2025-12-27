<script lang="ts">
	import HistoryViewer from '$lib/components/HistoryViewer.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import FileBrowser from '$lib/filebrowser/FileBrowser.svelte';
	import StencilPalette from '$lib/components/StencilPalette.svelte';
	import { createCanvasController } from './canvas-store.svelte.ts';
	import { draggingStencil, endDrag } from '$lib/dnd.svelte';
	import { Camera } from 'inkfinite-core';

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let textEditorEl = $state<HTMLTextAreaElement | null>(null);
	let arrowLabelEditorEl = $state<HTMLInputElement | null>(null);
	let markdownEditorEl = $state<HTMLTextAreaElement | null>(null);
	let historyViewerOpen = $state(false);

	const c = createCanvasController({
		setHistoryViewerOpen(value: boolean) {
			historyViewerOpen = value;
		}
	});

	let platform = $derived(c.platform());
	let textEditorCurrent = $derived(c.textEditor.current);
	let arrowLabelEditorCurrent = $derived(c.arrowLabelEditor.current);
	let markdownEditorCurrent = $derived(c.markdownEditor.current);
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

	$effect(() => {
		c.arrowLabelEditor.setRef(arrowLabelEditorEl);
		return () => c.arrowLabelEditor.setRef(null);
	});

	$effect(() => {
		c.markdownEditor.setRef(markdownEditorEl);
		return () => c.markdownEditor.setRef(null);
	});

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const stencil = draggingStencil.current;
		if (!stencil || !canvasEl) return;

		const rect = canvasEl.getBoundingClientRect();
		const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		const viewport = c.getViewport();
		const world = Camera.screenToWorld(c.store.getState().camera, screen, viewport);

		c.insertStencil(stencil, world);
		endDrag();
	}

	function handleStencilsClick() {
		c.stencilPaletteOpen = !c.stencilPaletteOpen;
	}
</script>

<div class="editor">
	<Toolbar
		{platform}
		desktop={{
			fileName: c.desktop.fileName,
			recentBoards: c.desktop.boards,
			onOpen: c.desktop.handleOpen,
			onNew: c.desktop.handleNew,
			onSaveAs: () => c.desktop.handleSaveAs(null),
			onSelectBoard: c.desktop.handleRecentSelect
		}}
		onOpenBrowser={c.fileBrowser.handleOpen}
		currentTool={c.tools.currentToolId}
		onToolChange={c.tools.handleChange}
		onHistoryClick={c.history.handleClick}
		onStencilsClick={handleStencilsClick}
		store={c.store}
		getViewport={c.getViewport}
		canvas={canvasEl ?? undefined}
		brushStore={c.brushStore} />
	<div
		class="canvas-container"
		ondragover={(e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		}}
		ondrop={handleDrop}
		role="application">
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
					style={[
						`left:${layout.left}px`,
						`top:${layout.top}px`,
						`width:${layout.width}px`,
						`height:${layout.height}px`,
						`font-size:${layout.fontSize}px`,
						''
					].join('; ')}
					value={textEditorCurrent.value}
					oninput={c.textEditor.handleInput}
					onkeydown={c.textEditor.handleKeyDown}
					onblur={c.textEditor.handleBlur}
					spellcheck="false"></textarea>
			{/if}
		{/if}
		{#if arrowLabelEditorCurrent}
			{@const layout = c.arrowLabelEditor.getLayout()}
			{#if layout}
				<input
					bind:this={arrowLabelEditorEl}
					class="canvas-arrow-label-editor"
					style={[
						`left:${layout.left}px`,
						`top:${layout.top}px`,
						`width:${layout.width}px`,
						`font-size:${layout.fontSize}px`,
						''
					].join('; ')}
					type="text"
					value={arrowLabelEditorCurrent.value}
					oninput={c.arrowLabelEditor.handleInput}
					onkeydown={c.arrowLabelEditor.handleKeyDown}
					onblur={c.arrowLabelEditor.handleBlur}
					spellcheck="false"
					placeholder="Enter arrow label..." />
			{/if}
		{/if}
		{#if markdownEditorCurrent}
			{@const layout = c.markdownEditor.getLayout()}
			{#if layout}
				<textarea
					bind:this={markdownEditorEl}
					class="canvas-markdown-editor"
					style={[
						`left:${layout.left}px`,
						`top:${layout.top}px`,
						`width:${layout.width}px`,
						`height:${layout.height}px`,
						`font-size:${layout.fontSize}px`,
						''
					].join('; ')}
					value={markdownEditorCurrent.value}
					oninput={c.markdownEditor.handleInput}
					onkeydown={c.markdownEditor.handleKeyDown}
					onblur={c.markdownEditor.handleBlur}
					spellcheck="false"></textarea>
			{/if}
		{/if}
		{#if marqueeRect}
			<div
				class="canvas-marquee"
				style={[
					`left:${marqueeRect.left}px`,
					`top:${marqueeRect.top}px`,
					`width:${marqueeRect.width}px`,
					`height:${marqueeRect.height}px`,
					''
				].join('; ')}>
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
			onClose={c.fileBrowser.handleClose}
			desktopRepo={c.desktop.repo} />
	{/if}
	<StencilPalette
		bind:open={c.stencilPaletteOpen}
		onClose={() => (c.stencilPaletteOpen = false)} />
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
		padding: 0.25rem;
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

	.canvas-arrow-label-editor {
		position: absolute;
		border: 1px solid var(--accent);
		background: var(--surface);
		color: var(--text);
		padding: 6px 8px;
		transform-origin: center;
		outline: none;
		font-family: sans-serif;
		text-align: center;
		z-index: 2;
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.05),
			0 8px 20px rgba(0, 0, 0, 0.15);
		border-radius: 0.25rem;
	}

	.canvas-markdown-editor {
		position: absolute;
		border: 1px solid var(--accent);
		background: var(--surface);
		color: var(--text);
		padding: 8px;
		transform-origin: top left;
		resize: none;
		outline: none;
		line-height: 1.4;
		font-family: monospace;
		z-index: 2;
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.05),
			0 8px 20px rgba(0, 0, 0, 0.15);
		white-space: pre-wrap;
		overflow: auto;
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
