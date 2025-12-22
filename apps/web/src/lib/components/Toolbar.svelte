<script lang="ts">
	import type { Box2, EditorState, Store, ToolId } from 'inkfinite-core';
	import {
		exportToSVG,
		exportViewportToPNG,
		getSelectedShapes,
		getShapesOnCurrentPage,
		shapeBounds
	} from 'inkfinite-core';

	type Viewport = { width: number; height: number };

	type Props = {
		currentTool: ToolId;
		onToolChange: (toolId: ToolId) => void;
		onHistoryClick?: () => void;
		store: Store;
		getViewport: () => Viewport;
		canvas?: HTMLCanvasElement;
	};

	let { currentTool, onToolChange, onHistoryClick, store, getViewport, canvas }: Props = $props();

	let editorState = $derived<EditorState>(store.getState());
	let zoomMenuOpen = $state(false);
	let zoomMenuEl = $state<HTMLDivElement | null>(null);
	let zoomButtonEl = $state<HTMLButtonElement | null>(null);
	let exportMenuOpen = $state(false);
	let exportMenuEl = $state<HTMLDivElement | null>(null);
	let exportButtonEl = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		editorState = store.getState();
		const unsubscribe = store.subscribe((state) => {
			editorState = state;
		});
		return () => unsubscribe();
	});

	$effect(() => {
		if (!zoomMenuOpen || typeof document === 'undefined') {
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}
			if (zoomMenuEl?.contains(target) || zoomButtonEl?.contains(target)) {
				return;
			}
			zoomMenuOpen = false;
		};

		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	});

	$effect(() => {
		if (!exportMenuOpen || typeof document === 'undefined') {
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}
			if (exportMenuEl?.contains(target) || exportButtonEl?.contains(target)) {
				return;
			}
			exportMenuOpen = false;
		};

		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	});

	const tools: Array<{ id: ToolId; label: string; icon: string }> = [
		{ id: 'select', label: 'Select', icon: '⌖' },
		{ id: 'rect', label: 'Rectangle', icon: '▭' },
		{ id: 'ellipse', label: 'Ellipse', icon: '○' },
		{ id: 'line', label: 'Line', icon: '╱' },
		{ id: 'arrow', label: 'Arrow', icon: '→' },
		{ id: 'text', label: 'Text', icon: 'T' }
	];

	const zoomPresets = [
		{ label: '50%', value: 50 },
		{ label: '100%', value: 100 },
		{ label: '200%', value: 200 }
	];

	function handleToolClick(toolId: ToolId) {
		onToolChange(toolId);
	}

	function getZoomPct(): number {
		const pct = editorState.camera.zoom * 100;
		if (!Number.isFinite(pct)) {
			return 100;
		}
		return Math.round(pct);
	}

	function setZoomPercent(percent: number) {
		const zoom = percent / 100;
		store.setState((state) => ({ ...state, camera: { ...state.camera, zoom } }));
		zoomMenuOpen = false;
	}

	function zoomToBounds(bounds: Box2) {
		const viewport = getViewport();
		const width = bounds.max.x - bounds.min.x || 1;
		const height = bounds.max.y - bounds.min.y || 1;
		const margin = 80;
		const scaleX = (viewport.width - margin) / width;
		const scaleY = (viewport.height - margin) / height;
		const zoom = Math.max(Math.min(scaleX, scaleY), 0.05);
		const center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
		store.setState((state) => ({ ...state, camera: { x: center.x, y: center.y, zoom } }));
		zoomMenuOpen = false;
	}

	function zoomToFit() {
		const shapes = getShapesOnCurrentPage(editorState);
		if (shapes.length === 0) {
			setZoomPercent(100);
			return;
		}
		const bounds = shapes.reduce<Box2 | null>((acc, shape) => {
			const shapeBox = shapeBounds(shape);
			if (!acc) {
				return shapeBox;
			}
			return {
				min: { x: Math.min(acc.min.x, shapeBox.min.x), y: Math.min(acc.min.y, shapeBox.min.y) },
				max: { x: Math.max(acc.max.x, shapeBox.max.x), y: Math.max(acc.max.y, shapeBox.max.y) }
			};
		}, null);

		if (bounds) {
			zoomToBounds(bounds);
		}
	}

	function zoomToSelection() {
		const shapes = getSelectedShapes(editorState);
		if (shapes.length === 0) {
			zoomToFit();
			return;
		}

		const bounds = shapes.reduce<Box2 | null>((acc, shape) => {
			const shapeBox = shapeBounds(shape);
			if (!acc) {
				return shapeBox;
			}
			return {
				min: { x: Math.min(acc.min.x, shapeBox.min.x), y: Math.min(acc.min.y, shapeBox.min.y) },
				max: { x: Math.max(acc.max.x, shapeBox.max.x), y: Math.max(acc.max.y, shapeBox.max.y) }
			};
		}, null);

		if (bounds) {
			zoomToBounds(bounds);
		}
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

	function exportSVGAll() {
		const svg = exportToSVG(editorState, { selectedOnly: false });
		downloadText(svg, 'drawing.svg');
		exportMenuOpen = false;
	}

	function exportSVGSelection() {
		const svg = exportToSVG(editorState, { selectedOnly: true });
		downloadText(svg, 'selection.svg');
		exportMenuOpen = false;
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
</script>

<div class="toolbar" role="toolbar" aria-label="Drawing tools">
	{#each tools as tool}
		<button
			class="tool-button"
			class:active={currentTool === tool.id}
			onclick={() => handleToolClick(tool.id)}
			aria-label={tool.label}
			aria-pressed={currentTool === tool.id}
			data-tool-id={tool.id}>
			<span class="tool-icon">{tool.icon}</span>
			<span class="tool-label">{tool.label}</span>
		</button>
	{/each}

	<div class="toolbar-divider"></div>

	<!-- Zoom controls -->
	<div class="toolbar-zoom">
		<button class="zoom-button" bind:this={zoomButtonEl} onclick={() => (zoomMenuOpen = !zoomMenuOpen)}>
			{getZoomPct()}%
		</button>

		{#if zoomMenuOpen}
			<div class="zoom-menu" bind:this={zoomMenuEl}>
				{#each zoomPresets as preset}
					<button onclick={() => setZoomPercent(preset.value)}>{preset.label}</button>
				{/each}
				<div class="menu-divider"></div>
				<button onclick={zoomToFit}>Zoom to fit</button>
				<button onclick={zoomToSelection}>Zoom to selection</button>
			</div>
		{/if}
	</div>

	<!-- Export controls -->
	<div class="toolbar-export">
		<button class="export-button" bind:this={exportButtonEl} onclick={() => (exportMenuOpen = !exportMenuOpen)}>
			Export
		</button>

		{#if exportMenuOpen}
			<div class="export-menu" bind:this={exportMenuEl}>
				<button onclick={exportPNGViewport}>PNG (Viewport)</button>
				<button onclick={exportSVGAll}>SVG (All)</button>
				<button onclick={exportSVGSelection}>SVG (Selection)</button>
			</div>
		{/if}
	</div>

	{#if onHistoryClick}
		<div class="toolbar-divider"></div>
		<button class="tool-button history-button" onclick={onHistoryClick} aria-label="History">
			<span class="tool-icon">⏱</span>
			<span class="tool-label">History</span>
		</button>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		padding: 12px;
		background: var(--surface-elevated);
		border-bottom: 1px solid var(--border);
		align-items: center;
	}

	.tool-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		transition: all 0.2s;
		min-width: 60px;
	}

	.tool-button:hover {
		background: var(--surface-elevated);
		border-color: var(--text-muted);
	}

	.tool-button:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.tool-button.active {
		background: var(--accent);
		color: var(--surface);
		border-color: var(--accent-hover);
	}

	.tool-icon {
		font-size: 20px;
		line-height: 1;
	}

	.tool-label {
		font-size: 11px;
		line-height: 1;
		white-space: nowrap;
	}

	.toolbar-divider {
		width: 1px;
		background-color: var(--border);
		margin: 0 8px;
		height: 40px;
	}

	.toolbar-zoom,
	.toolbar-export {
		position: relative;
	}

	.zoom-button,
	.export-button {
		border: 1px solid var(--border);
		background: var(--surface);
		padding: 8px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
		min-width: 60px;
	}

	.zoom-button:hover,
	.export-button:hover {
		background: var(--surface-elevated);
	}

	.zoom-menu,
	.export-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 10;
		min-width: 150px;
	}

	.zoom-menu button,
	.export-menu button {
		border: none;
		background: transparent;
		padding: 4px 8px;
		border-radius: 4px;
		text-align: left;
		cursor: pointer;
		font-size: 13px;
	}

	.zoom-menu button:hover,
	.export-menu button:hover {
		background: var(--surface-elevated);
	}

	.menu-divider {
		height: 1px;
		background: var(--border);
		margin: 6px 0;
	}

	.history-button {
		margin-left: auto;
	}
</style>
