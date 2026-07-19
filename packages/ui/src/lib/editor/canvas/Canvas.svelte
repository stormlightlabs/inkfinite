<script lang="ts">
	import HistoryViewer from '../components/HistoryViewer.svelte';
	import StatusBar from '../components/StatusBar.svelte';
	import Toolbar from '../components/Toolbar.svelte';
	import FileBrowser from '../filebrowser/FileBrowser.svelte';
	import StencilPalette from '../components/StencilPalette.svelte';
	import LayerPanel from '../components/LayerPanel.svelte';
	import ProposalReview from '../components/ProposalReview.svelte';
	import { createCanvasController } from './canvas-store.svelte';
	import { draggingStencil, endDrag } from '../dnd.svelte';
	import type { EditorPlatformAdapter } from '../platform';
	import { Camera, stencils } from '@inkfinite/core';

	let { platform: platformAdapter }: { platform: EditorPlatformAdapter } = $props();

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let textEditorEl = $state<HTMLTextAreaElement | null>(null);
	let arrowLabelEditorEl = $state<HTMLInputElement | null>(null);
	let markdownEditorEl = $state<HTMLTextAreaElement | null>(null);
	let historyViewerOpen = $state(false);

	// The composition root fixes the platform adapter for this component's lifetime.
	// svelte-ignore state_referenced_locally
	const c = createCanvasController(platformAdapter, {
		setHistoryViewerOpen(value: boolean) {
			historyViewerOpen = value;
		}
	});

	let platformKind = $derived(c.platform());
	let textEditorCurrent = $derived(c.textEditor.current);
	let arrowLabelEditorCurrent = $derived(c.arrowLabelEditor.current);
	let markdownEditorCurrent = $derived(c.markdownEditor.current);
	let persistenceStatusStore = $derived(c.persistenceStatusStore());
	let marqueeRect = $derived(c.marqueeRect());
	let liveProposal = $derived(c.proposal());
	let proposalMessage = $derived(c.proposalMessage());

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
		console.log('[Canvas] Drop event detected', {
			clientX: e.clientX,
			clientY: e.clientY,
			dataTransferTypes: e.dataTransfer?.types
		});
		e.preventDefault();

		let stencil = draggingStencil.current;

		if (!stencil && e.dataTransfer) {
			const stencilId = e.dataTransfer.getData('application/x-inkfinite-stencil');
			if (stencilId) {
				console.log('[Canvas] Recovering stencil from dataTransfer:', stencilId);
				stencil = stencils.registry.get(stencilId) ?? null;
			}
		}

		console.log('[Canvas] Dragging stencil state:', stencil);

		if (!stencil || !canvasEl) {
			console.warn('[Canvas] Drop ignored - missing stencil or canvas ref');
			return;
		}

		const rect = canvasEl.getBoundingClientRect();
		const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		const viewport = c.getViewport();
		const world = Camera.screenToWorld(c.store.getState().camera, screen, viewport);

		console.log('[Canvas] Inserting stencil at:', world);
		c.insertStencil(stencil, world);
		endDrag();
	}

	function handleStencilsClick() {
		c.stencilPaletteOpen = !c.stencilPaletteOpen;
	}

	// TODO: close palette on click? Users might want to add multiple.
	function handleInsertStencilAtCenter(stencil: stencils.Stencil) {
		console.log('[Canvas] Click insert stencil:', stencil.id);
		const viewport = c.getViewport();
		const screen = { x: viewport.width / 2, y: viewport.height / 2 };
		const world = Camera.screenToWorld(c.store.getState().camera, screen, viewport);
		c.insertStencil(stencil, world);
	}
</script>

<div class="editor">
	<Toolbar
		platform={platformKind}
		desktop={{
			fileName: c.desktop.fileName,
			recentBoards: c.desktop.boards,
			onOpen: c.desktop.handleOpen,
			onNew: c.desktop.handleNew,
			onSaveAs: () => c.desktop.handleSaveAs(null),
			onSelectBoard: c.desktop.handleRecentSelect
		}}
		currentTool={c.tools.currentToolId}
		onToolChange={c.tools.handleChange}
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
		{#if liveProposal}
			<div class="proposal-ghost-layer" aria-hidden="true">
				{#each liveProposal.affected_regions as region}
					{@const viewport = c.getViewport()}
					{@const bounds = region.bounds}
					{@const topLeft = Camera.worldToScreen(
						c.store.getState().camera,
						{ x: bounds.x, y: bounds.y },
						viewport
					)}
					{@const bottomRight = Camera.worldToScreen(
						c.store.getState().camera,
						{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
						viewport
					)}
					<div
						class="proposal-ghost"
						style={`left:${Math.min(topLeft.x, bottomRight.x)}px; top:${Math.min(topLeft.y, bottomRight.y)}px; width:${Math.abs(bottomRight.x - topLeft.x)}px; height:${Math.abs(bottomRight.y - topLeft.y)}px`}>
					</div>
				{/each}
			</div>
		{/if}
		<LayerPanel store={c.store} onCommit={c.commitLayerState} />
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
	<ProposalReview
		proposal={liveProposal}
		message={proposalMessage}
		onAccept={c.acceptProposal}
		onReject={c.rejectProposal}
		onAuthorize={c.authorizeApply} />
	<HistoryViewer store={c.store} bind:open={historyViewerOpen} onClose={c.history.handleClose} />
	<StatusBar
		store={c.store}
		cursor={c.cursorStore}
		persistence={persistenceStatusStore}
		snap={c.snapStore}
		platform={platformKind}
		onOpenBrowser={c.fileBrowser.handleOpen}
		onHistoryClick={c.history.handleClick} />
	{#if c.fileBrowser.vm && c.fileBrowser.open}
		<FileBrowser
			bind:vm={c.fileBrowser.vm}
			bind:open={c.fileBrowser.open}
			onUpdate={c.fileBrowser.handleUpdate}
			onClose={c.fileBrowser.handleClose}
			fetchInspectorData={platformKind === 'web'
				? c.fileBrowser.fetchInspectorData
				: undefined}
			desktopRepo={c.desktop.repo} />
	{/if}
	<StencilPalette
		bind:open={c.stencilPaletteOpen}
		onClose={() => (c.stencilPaletteOpen = false)}
		onStencilClick={handleInsertStencilAtCenter} />
</div>

<style>
	.editor {
		width: 100%;
		height: 100%;
		min-height: 0;
		position: relative;
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

	.proposal-ghost-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 1;
	}

	.proposal-ghost {
		position: absolute;
		box-sizing: border-box;
		border: 1px dashed color-mix(in srgb, var(--ink-accent) 82%, white 18%);
		background: color-mix(in srgb, var(--ink-accent) 13%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink-accent) 18%, transparent) inset;
		animation: proposal-pulse 1.8s ease-in-out infinite;
	}

	@keyframes proposal-pulse {
		0%,
		100% {
			opacity: 0.58;
		}
		50% {
			opacity: 0.95;
		}
	}

	.canvas-text-editor {
		position: absolute;
		border: 1px solid var(--ink-accent);
		background: var(--ink-canvas);
		color: var(--ink-text);
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
		border: 1px solid var(--ink-accent);
		background: var(--ink-canvas);
		color: var(--ink-text);
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
		border: 1px solid var(--ink-accent);
		background: var(--ink-canvas);
		color: var(--ink-text);
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
