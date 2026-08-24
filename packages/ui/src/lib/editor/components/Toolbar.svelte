<script lang="ts">
	import type {
		EditorState as EditorStateType,
		InterchangeFormat,
		Store,
		ToolId
	} from '@inkfinite/core';
	import { exportToSVG, exportViewportToPNG } from '@inkfinite/core';
	import { fade } from 'svelte/transition';
	import { BrushPopover, ContextMenu, Icon, type ContextMenuEntry } from '../../index';
	import { TOOLS } from '../constants';
	import type { BrushSettings, BrushStore } from '../status';
	import SelectionControls from './SelectionControls.svelte';

	type Props = {
		currentTool: ToolId;
		onToolChange: (toolId: ToolId) => void;
		store: Store;
		canvas?: HTMLCanvasElement;
		brushStore: BrushStore;
		onStencilsClick?: () => void;
		/** Whether to expose the desktop-only agent editability control. */
		showAgentControl?: boolean;
		onEnterFrame?: (frameId: string) => void;
		onFitSelection?: () => void;
		onImportEditable?: () => void;
		onImportSvg?: () => void;
		onCreateFromSvg?: () => void;
		onImportSvgMarkup?: () => void;
		onExportSvg?: (selectedOnly: boolean) => Promise<void>;
		onExportEditable?: (format: InterchangeFormat) => void;
		interchangeBusy?: boolean;
	};

	let {
		currentTool,
		onToolChange,
		store,
		canvas,
		brushStore,
		onStencilsClick,
		showAgentControl = false,
		onEnterFrame,
		onFitSelection,
		onImportEditable,
		onImportSvg,
		onCreateFromSvg,
		onImportSvgMarkup,
		onExportSvg,
		onExportEditable,
		interchangeBusy = false
	}: Props = $props();

	let editorState = $derived<EditorStateType>(store.getState());
	let exportMenuOpen = $state(false);
	let exportMenuPoint = $state({ x: 0, y: 0 });
	let exportButtonEl = $state<HTMLButtonElement | null>(null);
	let importMenuOpen = $state(false);
	let importMenuPoint = $state({ x: 0, y: 0 });
	let importButtonEl = $state<HTMLButtonElement | null>(null);
	let shapesMenuOpen = $state(false);
	let shapesMenuPoint = $state({ x: 0, y: 0 });
	let shapesButtonEl = $state<HTMLButtonElement | null>(null);
	let brush = $derived<BrushSettings>(brushStore.get());
	const shapeToolIds = new Set<ToolId>(['rect', 'ellipse', 'frame', 'line', 'arrow']);
	let primaryTools = $derived(TOOLS.filter((tool) => !shapeToolIds.has(tool.id)));
	let shapeTools = $derived(TOOLS.filter((tool) => shapeToolIds.has(tool.id)));

	$effect(() => {
		editorState = store.getState();
		const unsubscribe = store.subscribe((state) => {
			editorState = state;
		});
		return () => unsubscribe();
	});

	$effect(() => {
		const unsubscribeBrush = brushStore.subscribe((b) => {
			brush = b;
		});
		return () => unsubscribeBrush();
	});

	let position = $state({ x: 12, y: 88 });
	let orientation = $state<'vertical' | 'horizontal'>('vertical');
	let orientationInitialized = $state(false);
	let isDragging = $state(false);
	let dragMoved = $state(false);
	let dragOffset = $state({ x: 0, y: 0 });
	let toolbarEl = $state<HTMLElement | null>(null);

	$effect(() => {
		if (orientationInitialized || typeof window === 'undefined') return;
		orientationInitialized = true;
		if (window.matchMedia('(max-width: 760px), (pointer: coarse)').matches) {
			orientation = 'horizontal';
		}
	});

	function handleDragStart(event: PointerEvent) {
		if (event.button !== 0) return;
		isDragging = true;
		dragMoved = false;
		dragOffset = { x: event.clientX - position.x, y: event.clientY - position.y };

		if (typeof document !== 'undefined') document.body.style.userSelect = 'none';

		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handleDragMove(event: PointerEvent) {
		if (!isDragging) return;
		if (Math.abs(event.movementX) > 1 || Math.abs(event.movementY) > 1) dragMoved = true;
		moveToolbar(event.clientX - dragOffset.x, event.clientY - dragOffset.y);
	}

	function moveToolbar(x: number, y: number) {
		const width = toolbarEl?.offsetWidth ?? 0;
		const height = toolbarEl?.offsetHeight ?? 0;
		const maxX = Math.max(8, window.innerWidth - width - 8);
		const maxY = Math.max(8, window.innerHeight - height - 8);
		position = { x: Math.min(maxX, Math.max(8, x)), y: Math.min(maxY, Math.max(8, y)) };
	}

	function handleDragEnd(event: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		if (typeof document !== 'undefined') document.body.style.userSelect = '';
		const handle = event.currentTarget as HTMLElement;
		if (handle.hasPointerCapture(event.pointerId))
			handle.releasePointerCapture(event.pointerId);
		if (!dragMoved) rotateToolbar();
	}

	function rotateToolbar() {
		orientation = orientation === 'vertical' ? 'horizontal' : 'vertical';
	}

	function handleToolbarKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			rotateToolbar();
			return;
		}
		handleDragKeyDown(event);
	}

	function handleDragKeyDown(event: KeyboardEvent) {
		const distance = event.shiftKey ? 10 : 1;
		if (event.key === 'Home') {
			position = { x: 12, y: 88 };
		} else if (event.key === 'ArrowLeft') {
			moveToolbar(position.x - distance, position.y);
		} else if (event.key === 'ArrowRight') {
			moveToolbar(position.x + distance, position.y);
		} else if (event.key === 'ArrowUp') {
			moveToolbar(position.x, position.y - distance);
		} else if (event.key === 'ArrowDown') {
			moveToolbar(position.x, position.y + distance);
		} else {
			return;
		}
		event.preventDefault();
	}

	function handleToolClick(toolId: ToolId) {
		onToolChange(toolId);
	}

	function toggleShapesMenu() {
		if (!shapesButtonEl) return;
		if (shapesMenuOpen) {
			shapesMenuOpen = false;
			return;
		}
		const bounds = shapesButtonEl.getBoundingClientRect();
		shapesMenuPoint = { x: bounds.left, y: bounds.bottom + 8 };
		shapesMenuOpen = true;
	}

	function handleShapeMenuAction(id: string) {
		onToolChange(id as ToolId);
	}

	async function exportPNGViewport() {
		if (!canvas) {
			console.error('Canvas not available for export');
			return;
		}
		try {
			const blob = await exportViewportToPNG(canvas);
			downloadBlob(blob, 'drawing.png');
			exportMenuOpen = false;
		} catch (error) {
			console.error('Failed to export PNG:', error);
		}
	}

	async function exportSVGAll() {
		if (onExportSvg) {
			await onExportSvg(false);
		} else {
			const svg = exportToSVG(editorState, { selectedOnly: false });
			downloadText(svg, 'drawing.svg');
		}
		exportMenuOpen = false;
	}

	async function exportSVGSelection() {
		if (onExportSvg) {
			await onExportSvg(true);
		} else {
			const svg = exportToSVG(editorState, { selectedOnly: true });
			downloadText(svg, 'selection.svg');
		}
		exportMenuOpen = false;
	}

	function exportEditable(format: InterchangeFormat) {
		exportMenuOpen = false;
		onExportEditable?.(format);
	}

	function toggleExportMenu() {
		if (interchangeBusy || !exportButtonEl) return;
		if (exportMenuOpen) {
			exportMenuOpen = false;
			return;
		}
		const bounds = exportButtonEl.getBoundingClientRect();
		exportMenuPoint = { x: bounds.right, y: bounds.bottom + 8 };
		exportMenuOpen = true;
	}

	function getExportMenuItems(): ContextMenuEntry[] {
		return [
			{
				id: 'excalidraw',
				label: 'Excalidraw',
				accessibleLabel: 'Export as Excalidraw editable document'
			},
			{
				id: 'json-canvas',
				label: 'Obsidian Canvas',
				accessibleLabel: 'Export as Obsidian Canvas editable document'
			},
			{ type: 'separator' },
			{ id: 'png', label: 'PNG (Viewport)', accessibleLabel: 'Export current view as PNG' },
			{ id: 'svg-all', label: 'SVG (All)', accessibleLabel: 'Export all shapes as SVG' },
			{
				id: 'svg-selection',
				label: 'SVG (Selection)',
				accessibleLabel: 'Export selected shapes as SVG'
			}
		];
	}

	function handleExportMenuAction(id: string) {
		switch (id) {
			case 'excalidraw':
			case 'json-canvas':
				exportEditable(id);
				break;
			case 'png':
				void exportPNGViewport();
				break;
			case 'svg-all':
				void exportSVGAll();
				break;
			case 'svg-selection':
				void exportSVGSelection();
				break;
		}
	}

	function toggleImportMenu() {
		if (interchangeBusy || !importButtonEl) return;
		if (importMenuOpen) {
			importMenuOpen = false;
			return;
		}
		const bounds = importButtonEl.getBoundingClientRect();
		importMenuPoint = { x: bounds.left, y: bounds.bottom + 8 };
		importMenuOpen = true;
	}

	function getImportMenuItems(): ContextMenuEntry[] {
		const items: ContextMenuEntry[] = [];
		if (onImportEditable) {
			items.push({ id: 'import-document', label: 'Editable document', icon: 'layers' });
		}
		if (onImportSvg || onCreateFromSvg || onImportSvgMarkup) {
			if (items.length > 0) items.push({ type: 'separator' });
		}
		if (onImportSvg) {
			items.push({
				id: 'import-svg-file',
				label: 'Add SVG to current document',
				icon: 'folder'
			});
		}
		if (onCreateFromSvg) {
			items.push({ id: 'create-from-svg', label: 'New document from SVG', icon: 'svg' });
		}
		if (onImportSvgMarkup) {
			items.push({ id: 'import-svg-markup', label: 'Add SVG code / markup', icon: 'svg' });
		}
		return items;
	}

	function handleImportMenuAction(id: string) {
		switch (id) {
			case 'import-document':
				onImportEditable?.();
				break;
			case 'import-svg-file':
				onImportSvg?.();
				break;
			case 'create-from-svg':
				onCreateFromSvg?.();
				break;
			case 'import-svg-markup':
				onImportSvgMarkup?.();
				break;
		}
	}

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	function downloadText(text: string, filename: string) {
		const blob = new Blob([text], { type: 'text/plain' });
		downloadBlob(blob, filename);
	}

	function handleBrushChange(newBrush: BrushSettings) {
		brushStore.set(newBrush);
	}
</script>

<div class="editor-chrome">
	<header class="application-chrome" aria-label="Application actions" data-agent-occlusion>
		<div class="toolbar__brand">
			<div class="toolbar__logo" aria-hidden="true">
				<svg viewBox="0 0 24 24">
					<path
						fill="currentColor"
						d="M9.75 20.85c1.78-.7 1.39-2.63.49-3.85c-.89-1.25-2.12-2.11-3.36-2.94A9.8 9.8 0 0 1 4.54 12c-.28-.33-.85-.94-.27-1.06c.59-.12 1.61.46 2.13.68c.91.38 1.81.82 2.65 1.34l1.01-1.7C8.5 10.23 6.5 9.32 4.64 9.05c-1.06-.16-2.18.06-2.54 1.21c-.32.99.19 1.99.77 2.77c1.37 1.83 3.5 2.71 5.09 4.29c.34.33.75.72.95 1.18c.21.44.16.47-.31.47c-1.24 0-2.79-.97-3.8-1.61l-1.01 1.7c1.53.94 4.09 2.41 5.96 1.79m9.21-13.52L13.29 13H11v-2.29l5.67-5.68zm3.4-.78c-.01.3-.32.61-.64.92L19.2 10l-.87-.87l2.6-2.59l-.59-.59l-.67.67l-2.29-2.29l2.15-2.15c.24-.24.63-.24.86 0l1.43 1.43c.24.22.24.62 0 .86c-.21.21-.41.41-.41.61c-.02.2.18.42.38.59c.29.3.58.58.57.88" />
				</svg>
			</div>
			<div class="toolbar__brand-copy">
				<div class="toolbar__name">Inkfinite</div>
				<a
					class="toolbar__byline"
					href="https://stormlightlabs.org"
					target="_blank"
					rel="noreferrer">by Stormlight Labs</a>
			</div>
		</div>

		<div class="application-chrome__actions">
			<a
				class="application-chrome__button"
				href="https://ink.stormlightlabs.org/docs/"
				target="_blank"
				rel="noreferrer"
				aria-label="Open documentation">
				<Icon name="book-open" size={17} />
				<span class="application-chrome__label">Docs</span>
			</a>
			{#if onStencilsClick}
				<button
					class="application-chrome__button"
					type="button"
					onclick={onStencilsClick}
					aria-label="Open stencils library"
					title="Insert from library">
					<Icon name="insert" size={17} />
					<span class="application-chrome__label">Insert</span>
				</button>
			{/if}
			<button
				class="application-chrome__button toolbar__import-button"
				bind:this={importButtonEl}
				type="button"
				disabled={interchangeBusy}
				onpointerdown={(event) => event.stopPropagation()}
				onclick={toggleImportMenu}
				aria-label="Import"
				aria-haspopup="menu"
				aria-expanded={importMenuOpen}>
				<Icon name="folder" size={17} />
				<span class="application-chrome__label"
					>{interchangeBusy ? 'Working…' : 'Import'}</span>
			</button>
			<ContextMenu
				items={getImportMenuItems()}
				label="Import options"
				open={importMenuOpen}
				returnFocus={importButtonEl}
				x={importMenuPoint.x}
				y={importMenuPoint.y}
				onOpenChange={(value) => (importMenuOpen = value)}
				onSelect={handleImportMenuAction} />

			<button
				class="application-chrome__button toolbar__export-button"
				bind:this={exportButtonEl}
				type="button"
				onclick={toggleExportMenu}
				aria-label="Export drawing"
				aria-haspopup="menu"
				aria-expanded={exportMenuOpen}
				disabled={interchangeBusy}>
				<Icon name="save" size={17} />
				<span class="application-chrome__label">Export</span>
			</button>
			<ContextMenu
				items={getExportMenuItems()}
				label="Export options"
				open={exportMenuOpen}
				align="end"
				returnFocus={exportButtonEl}
				x={exportMenuPoint.x}
				y={exportMenuPoint.y}
				onOpenChange={(value) => (exportMenuOpen = value)}
				onSelect={handleExportMenuAction} />
		</div>
	</header>

	<div
		class="toolbar"
		class:toolbar--horizontal={orientation === 'horizontal'}
		role="toolbar"
		aria-label="Drawing tools"
		data-agent-occlusion
		bind:this={toolbarEl}
		style="position: fixed; left: {position.x}px; top: {position.y}px;"
		data-dragging={isDragging}>
		<div
			class="toolbar__drag-handle"
			onpointerdown={handleDragStart}
			onpointermove={handleDragMove}
			onpointerup={handleDragEnd}
			onpointercancel={handleDragEnd}
			onkeydown={handleToolbarKeyDown}
			aria-label="Drag toolbar"
			title="Drag toolbar; click or press Enter to rotate (arrow keys move it)"
			role="button"
			tabindex="0">
			<Icon name="grip-vertical" size={16} class="toolbar__drag-icon" />
		</div>

		<div class="toolbar__tools">
			{#each primaryTools as tool (`${tool.id}:${tool.label}`)}
				<div class="toolbar__tool-slot">
					<button
						class="toolbar__tool-button tool-button"
						class:toolbar__tool-button--active={currentTool === tool.id}
						class:active={currentTool === tool.id}
						onclick={() => handleToolClick(tool.id)}
						aria-label={tool.label}
						title={tool.label}
						aria-pressed={currentTool === tool.id}
						data-tool-id={tool.id}>
						<span class="toolbar__tool-icon"><Icon name={tool.icon} size={20} /></span>
						<span class="toolbar__tool-label">{tool.label}</span>
					</button>
					{#if tool.id === 'pen' && currentTool === 'pen'}
						<div class="toolbar__pen-context" transition:fade={{ duration: 150 }}>
							<BrushPopover {brush} align="end" onBrushChange={handleBrushChange} />
						</div>
					{/if}
				</div>
				{#if tool.id === 'direct-select'}
					<div class="toolbar__tool-slot">
						<button
							bind:this={shapesButtonEl}
							class="toolbar__tool-button tool-button"
							class:toolbar__tool-button--active={shapeToolIds.has(currentTool)}
							type="button"
							onclick={toggleShapesMenu}
							aria-label="Shapes"
							aria-haspopup="menu"
							aria-expanded={shapesMenuOpen}
							aria-pressed={shapeToolIds.has(currentTool)}>
							<span class="toolbar__tool-icon"
								><Icon name="shapes" size={20} /></span>
							<span class="toolbar__tool-label">Shapes</span>
						</button>
					</div>
				{/if}
			{/each}
		</div>
	</div>
	<ContextMenu
		items={shapeTools.map((tool) => ({ id: tool.id, label: tool.label, icon: tool.icon }))}
		label="Shape tools"
		open={shapesMenuOpen}
		returnFocus={shapesButtonEl}
		x={shapesMenuPoint.x}
		y={shapesMenuPoint.y}
		onOpenChange={(value) => (shapesMenuOpen = value)}
		onSelect={handleShapeMenuAction} />

	<SelectionControls
		{currentTool}
		{store}
		{orientation}
		{showAgentControl}
		{onEnterFrame}
		{onFitSelection} />
</div>

<style>
	.editor-chrome {
		position: relative;
		z-index: 90;
	}

	.application-chrome {
		position: fixed;
		top: var(--ink-space-3);
		left: var(--ink-space-3);
		right: var(--ink-space-3);
		display: flex;
		min-height: 3.25rem;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-4);
		padding: var(--ink-space-2) var(--ink-space-3);
		border: 1px solid color-mix(in srgb, var(--ink-border) 68%, transparent);
		border-radius: var(--ink-radius-panel);
		background: color-mix(in srgb, var(--ink-surface-raised) 96%, transparent);
		box-shadow: var(--ink-shadow-toolbar);
		backdrop-filter: blur(16px);
	}

	.toolbar__brand {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: var(--ink-space-3);
		padding-inline: var(--ink-space-1);
	}

	.toolbar__logo {
		display: flex;
		width: 2rem;
		height: 2rem;
		align-items: center;
		justify-content: center;
		color: var(--ink-text);
	}

	.toolbar__logo svg {
		width: 2rem;
		height: 2rem;
	}

	.toolbar__brand-copy {
		display: grid;
		gap: 0.15rem;
	}

	.toolbar__name {
		color: var(--ink-heading);
		font: 650 var(--ink-type-lg) / 1 var(--ink-font-display);
		letter-spacing: -0.025em;
	}

	.toolbar__byline {
		color: var(--ink-text-muted);
		font: 550 var(--ink-type-xs) / 1 var(--ink-font-body);
		text-decoration: none;
	}

	.toolbar__byline:hover {
		color: var(--ink-text);
		text-decoration: underline;
		text-underline-offset: 0.15rem;
	}

	.application-chrome__actions {
		display: flex;
		align-items: center;
		gap: var(--ink-space-1);
	}

	.application-chrome__button {
		display: inline-flex;
		min-height: var(--ink-control-height);
		align-items: center;
		justify-content: center;
		gap: var(--ink-space-2);
		padding: 0 var(--ink-space-3);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 650 var(--ink-type-sm) / 1 var(--ink-font-body);
		text-decoration: none;
		cursor: pointer;
		transition-property: color, background-color, border-color, transform;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.application-chrome__button:hover {
		border-color: var(--ink-accent);
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.application-chrome__button:active {
		transform: scale(0.96);
	}

	.application-chrome__button:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.application-chrome__button:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	.toolbar {
		display: flex;
		width: max-content;
		max-width: calc(100vw - 1.5rem);
		max-height: calc(100vh - 7rem);
		align-items: stretch;
		flex-direction: column;
		gap: var(--ink-space-1);
		padding: var(--ink-space-2);
		border: 1px solid color-mix(in srgb, var(--ink-border) 68%, transparent);
		border-radius: var(--ink-radius-panel);
		background: color-mix(in srgb, var(--ink-surface-raised) 96%, transparent);
		box-shadow: var(--ink-shadow-toolbar);
		backdrop-filter: blur(14px);
		z-index: 100;
		overflow: auto;
		transition-property: transform, box-shadow;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.toolbar[data-dragging='true'] {
		transform: scale(0.99);
		box-shadow: var(--ink-shadow-popover);
	}

	.toolbar__drag-handle {
		display: flex;
		width: 100%;
		height: 1rem;
		min-height: 1rem;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text-muted);
		cursor: grab;
		opacity: 0.52;
		touch-action: none;
		transition-property: color, background-color, opacity;
		transition-duration: var(--ink-duration-fast);
	}

	.toolbar:not(.toolbar--horizontal) :global(.toolbar__drag-icon) {
		transform: rotate(90deg);
	}

	.toolbar__drag-handle:hover {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
		opacity: 1;
	}

	.toolbar__drag-handle:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 1px;
		opacity: 1;
	}

	.toolbar[data-dragging='true'] .toolbar__drag-handle {
		color: var(--ink-accent);
		cursor: grabbing;
		opacity: 1;
	}

	.toolbar__tools {
		display: flex;
		align-items: stretch;
		flex-direction: column;
		gap: var(--ink-space-1);
	}

	.toolbar--horizontal {
		align-items: center;
		flex-direction: row;
		overflow: hidden;
	}

	.toolbar--horizontal .toolbar__drag-handle {
		order: 2;
		width: 1rem;
		height: 100%;
		min-height: 3rem;
		flex: 0 0 1rem;
		background: var(--ink-surface-raised);
	}

	.toolbar--horizontal .toolbar__tools {
		min-width: 0;
		flex: 1 1 auto;
		flex-direction: row;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.toolbar--horizontal .toolbar__tools::-webkit-scrollbar {
		display: none;
	}

	.toolbar__tool-slot {
		position: relative;
		display: flex;
	}

	.toolbar__tool-button {
		display: flex;
		width: 5.25rem;
		min-height: 3rem;
		align-items: center;
		justify-content: center;
		gap: var(--ink-space-1);
		flex-direction: column;
		padding: var(--ink-space-2) var(--ink-space-1);
		border: var(--ink-line-width) solid transparent;
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: transparent;
		font: inherit;
		cursor: pointer;
		opacity: 0.82;
		transition-property: color, background-color, border-color, box-shadow, transform;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.toolbar__tool-button:hover {
		border-color: var(--ink-border);
		color: var(--ink-text);
		background: var(--ink-surface-hover);
		opacity: 1;
	}

	.toolbar__tool-button:active,
	.application-chrome__button:active {
		transform: scale(0.96);
	}

	.toolbar__tool-button:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.toolbar__tool-button--active,
	.tool-button.active {
		border-color: var(--ink-border-strong);
		color: var(--ink-on-accent);
		background: var(--ink-accent);
		box-shadow: var(--ink-shadow-accent);
		opacity: 1;
	}

	.toolbar__tool-icon {
		font-size: 1.25rem;
		line-height: 1;
	}

	.toolbar__tool-label {
		max-width: 100%;
		overflow: hidden;
		font-size: var(--ink-type-xs);
		font-weight: 600;
		line-height: 1;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toolbar__pen-context {
		position: absolute;
		top: calc(100% + var(--ink-space-2));
		right: 0;
		z-index: 20;
		padding: var(--ink-space-1);
		border: 1px solid color-mix(in srgb, var(--ink-border) 64%, transparent);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-surface-raised) 96%, transparent);
		box-shadow: var(--ink-shadow-popover);
		backdrop-filter: blur(14px);
	}

	@media (max-width: 1180px) {
		.application-chrome {
			right: auto;
			width: min(30rem, calc(100vw - 1.5rem));
		}
	}

	@media (max-width: 760px) {
		.application-chrome {
			left: 0.75rem;
			right: 0.75rem;
			width: auto;
			min-height: 3rem;
			padding: var(--ink-space-1) var(--ink-space-2);
		}

		.toolbar {
			width: calc(100vw - 1.5rem);
			max-width: none;
			max-height: none;
			align-items: stretch;
			overflow-x: auto;
			overflow-y: hidden;
			scrollbar-width: none;
			touch-action: pan-x;
		}

		.toolbar::-webkit-scrollbar {
			display: none;
		}

		.toolbar__drag-handle {
			width: 100%;
		}

		.toolbar__tools {
			display: flex;
			flex: 0 0 auto;
		}

		.toolbar__tool-button {
			width: 3rem;
			min-height: 2.75rem;
			padding: var(--ink-space-1);
		}

		.toolbar__tool-label {
			display: none;
		}

		.toolbar__pen-context {
			position: fixed;
			top: 11rem;
			left: 0.75rem;
			right: 0.75rem;
			width: auto;
		}
	}

	@media (max-width: 480px) {
		.toolbar__brand-copy {
			display: none;
		}

		.application-chrome__button {
			width: 2.5rem;
			min-height: 2.5rem;
			padding: 0;
		}

		.application-chrome__label {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.application-chrome__button,
		.toolbar,
		.toolbar__drag-handle,
		.toolbar__tool-button {
			transition: none;
		}
	}
</style>
