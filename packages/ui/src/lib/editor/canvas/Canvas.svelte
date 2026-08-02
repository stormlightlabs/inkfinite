<script lang="ts">
	import HistoryViewer from '../components/HistoryViewer.svelte';
	import StatusBar from '../components/StatusBar.svelte';
	import Toolbar from '../components/Toolbar.svelte';
	import FileBrowser from '../filebrowser/FileBrowser.svelte';
	import StencilPalette from '../components/StencilPalette.svelte';
	import LayerPanel from '../components/LayerPanel.svelte';
	import ProposalReview from '../components/ProposalReview.svelte';
	import ProposalGhostLayer from '../components/ProposalGhostLayer.svelte';
	import NavigationControls from './NavigationControls.svelte';
	import { Button, ContextMenu, Dialog, type ContextMenuEntry } from '../../index';
	import { createCanvasController } from './canvas-store.svelte';
	import { draggingStencil, endDrag } from '../dnd.svelte';
	import type { EditorPlatformAdapter } from '../platform';
	import { Action, Camera, hitTestPoint, stencils } from '@inkfinite/core';

	let { platform: platformAdapter }: { platform: EditorPlatformAdapter } = $props();

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let textEditorEl = $state<HTMLTextAreaElement | null>(null);
	let arrowLabelEditorEl = $state<HTMLInputElement | null>(null);
	let markdownEditorEl = $state<HTMLTextAreaElement | null>(null);
	let historyViewerOpen = $state(false);
	let contextMenuOpen = $state(false);
	let contextMenuPoint = $state({ x: 0, y: 0 });
	let contextMenuItems = $state<ContextMenuEntry[]>([]);

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
	let interchangeNotice = $derived(c.interchangeNotice());

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

	function handleCanvasContextMenu(event: MouseEvent) {
		event.preventDefault();
		if (!canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		const world = Camera.screenToWorld(c.store.getState().camera, screen, c.getViewport());
		const shapeId = hitTestPoint(c.store.getState(), world);

		if (shapeId) {
			c.store.setState((state) => {
				const shape = state.doc.shapes[shapeId];
				return {
					...state,
					ui: {
						...state.ui,
						activeLayerId: shape?.layerId ?? state.ui.activeLayerId,
						selectionIds: state.ui.selectionIds.includes(shapeId)
							? state.ui.selectionIds
							: [shapeId],
						toolId: 'select'
					}
				};
			});
			contextMenuItems = [
				{ id: 'duplicate', label: 'Duplicate', icon: 'add', shortcut: '⌘/Ctrl D' },
				{ id: 'forward', label: 'Bring forward', icon: 'arrow-up', shortcut: '⌘/Ctrl ]' },
				{
					id: 'backward',
					label: 'Send backward',
					icon: 'arrow-down',
					shortcut: '⌘/Ctrl ['
				},
				{ type: 'separator' },
				{ id: 'delete', label: 'Delete', icon: 'delete', shortcut: '⌫', danger: true }
			];
		} else {
			c.store.setState((state) => ({ ...state, ui: { ...state.ui, selectionIds: [] } }));
			contextMenuItems = [{ id: 'stencils', label: 'Insert stencil', icon: 'grid-dots' }];
		}

		contextMenuPoint = { x: event.clientX, y: event.clientY };
		contextMenuOpen = true;
	}

	function handleContextMenuAction(id: string) {
		const primary = { ctrl: false, shift: false, alt: false, meta: true };
		switch (id) {
			case 'duplicate':
				c.handleAction(Action.keyDown('d', 'KeyD', primary));
				break;
			case 'forward':
				c.handleAction(Action.keyDown(']', 'BracketRight', primary));
				break;
			case 'backward':
				c.handleAction(Action.keyDown('[', 'BracketLeft', primary));
				break;
			case 'delete':
				c.handleAction(
					Action.keyDown('Delete', 'Delete', {
						ctrl: false,
						shift: false,
						alt: false,
						meta: false
					})
				);
				break;
			case 'stencils':
				c.stencilPaletteOpen = true;
				break;
		}
	}
</script>

<div class="editor">
	<Toolbar
		currentTool={c.tools.currentToolId}
		onToolChange={c.tools.handleChange}
		onStencilsClick={handleStencilsClick}
		store={c.store}
		canvas={canvasEl ?? undefined}
		brushStore={c.brushStore}
		onImportEditable={c.importEditableCanvas}
		onExportEditable={c.exportEditableCanvas}
		interchangeBusy={c.interchangeBusy()} />
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
			oncontextmenu={handleCanvasContextMenu}
			onpointerleave={c.handlePointerLeave}></canvas>
		{#if liveProposal}
			<ProposalGhostLayer
				proposal={liveProposal}
				camera={c.store.getState().camera}
				viewport={c.getViewport()} />
		{/if}
		<NavigationControls store={c.store} camera={c.camera} />
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
	<ContextMenu
		items={contextMenuItems}
		label="Canvas actions"
		open={contextMenuOpen}
		returnFocus={canvasEl}
		x={contextMenuPoint.x}
		y={contextMenuPoint.y}
		onOpenChange={(value) => (contextMenuOpen = value)}
		onSelect={handleContextMenuAction} />
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
		draft={c.desktop.isDraft}
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
	<Dialog
		open={Boolean(interchangeNotice)}
		onClose={c.closeInterchangeNotice}
		title={interchangeNotice?.title}>
		{#if interchangeNotice}
			<div class="interchange-notice" data-error={interchangeNotice.error}>
				<h2>{interchangeNotice.title}</h2>
				<p>{interchangeNotice.message}</p>
				{#if interchangeNotice.warnings.length > 0}
					<h3>Conversion notes</h3>
					<ul>
						{#each interchangeNotice.warnings as warning (warning.code)}
							<li>
								{warning.message}{warning.count > 1 ? ` (${warning.count})` : ''}
							</li>
						{/each}
					</ul>
				{/if}
				<div class="interchange-notice__actions">
					<Button variant="primary" onclick={c.closeInterchangeNotice}>Close</Button>
				</div>
			</div>
		{/if}
	</Dialog>
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
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M4 2.75 22.2 16.1l-8.05 1.15 4.2 7.25-4.2 2.4-4.05-7.2-5.35 6.1z' fill='%23171928' stroke='%2388edc4' stroke-width='2.25' stroke-linejoin='round'/%3E%3C/svg%3E")
				4 3,
			default;
	}

	.interchange-notice {
		width: min(32rem, calc(100vw - 3rem));
		padding: var(--ink-space-6);
	}

	.interchange-notice h2,
	.interchange-notice h3 {
		margin: 0;
	}

	.interchange-notice h2 {
		font: 700 var(--ink-type-xl) / 1.15 var(--ink-font-body);
	}

	.interchange-notice h3 {
		margin-top: var(--ink-space-5);
		font: 700 var(--ink-type-sm) / 1.3 var(--ink-font-body);
	}

	.interchange-notice p,
	.interchange-notice li {
		line-height: 1.5;
	}

	.interchange-notice ul {
		margin: var(--ink-space-2) 0 0;
		padding-left: 1.25rem;
	}

	.interchange-notice__actions {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--ink-space-6);
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
