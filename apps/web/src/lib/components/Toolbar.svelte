<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import {
		DEFAULT_FILL_COLOR,
		DEFAULT_STROKE_COLOR,
		HELP_LINKS,
		KEYBOARD_TIPS,
		TOOLS,
		ZOOM_PRESETS
	} from '$lib/constants';
	import type { Platform } from '$lib/platform';
	import type { BrushSettings, BrushStore } from '$lib/status';
    import { themeStore } from '$lib/theme.svelte';
	import type {
		ArrowShape,
		BoardMeta,
		Box2,
		EditorState as EditorStateType,
		EllipseShape,
		LineShape,
		RectShape,
		ShapeRecord,
		Store,
		TextShape,
		ToolId
	} from 'inkfinite-core';
	import {
		EditorState,
		exportToSVG,
		exportViewportToPNG,
		getSelectedShapes,
		getShapesOnCurrentPage,
		shapeBounds,
		SnapshotCommand
	} from 'inkfinite-core';
	import icon from '../assets/favicon.svg';
	import ArrowPopover from './ArrowPopover.svelte';
	import BrushPopover from './BrushPopover.svelte';
	import Dialog from './Dialog.svelte';

	type Viewport = { width: number; height: number };

	type DesktopControls = {
		fileName: string | null;
		recentBoards: BoardMeta[];
		onOpen?: () => void | Promise<void>;
		onNew?: () => void | Promise<void>;
		onSaveAs?: () => void | Promise<void>;
		onSelectBoard?: (boardId: string) => void | Promise<void>;
	};

	type Props = {
		currentTool: ToolId;
		onToolChange: (toolId: ToolId) => void;
		onHistoryClick?: () => void;
		store: Store;
		getViewport: () => Viewport;
		canvas?: HTMLCanvasElement;
		brushStore: BrushStore;
		platform?: Platform;
		desktop?: DesktopControls;
		onOpenBrowser?: () => void;
	};

	let {
		currentTool,
		onToolChange,
		onHistoryClick,
		store,
		getViewport,
		canvas,
		brushStore,
		platform = 'web',
		desktop,
		onOpenBrowser
	}: Props = $props();

	let editorState = $derived<EditorStateType>(store.getState());
	let zoomMenuOpen = $state(false);
	let zoomMenuEl = $state<HTMLDivElement | null>(null);
	let zoomButtonEl = $state<HTMLButtonElement | null>(null);
	let exportMenuOpen = $state(false);
	let exportMenuEl = $state<HTMLDivElement | null>(null);
	let exportButtonEl = $state<HTMLButtonElement | null>(null);
	let fillColorValue = $state(DEFAULT_FILL_COLOR);
	let strokeColorValue = $state(DEFAULT_STROKE_COLOR);
	let fillDisabled = $state(true);
	let strokeDisabled = $state(true);
	let brush = $derived<BrushSettings>(brushStore.get());
	let hasArrowSelection = $derived(getSelectedShapes(editorState).some((s) => s.type === 'arrow'));
	let infoOpen = $state(false);

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

	$effect(() => {
		const selection = getSelectedShapes(editorState);
		const fillable = selection.filter(shapeSupportsFill);
		const strokable = selection.filter(shapeSupportsStroke);
		fillDisabled = fillable.length === 0;
		strokeDisabled = strokable.length === 0;
		if (fillable.length > 0) {
			const shared = getSharedColor(fillable, (shape) =>
				shape.type === 'text' ? shape.props.color : 'fill' in shape.props ? shape.props.fill : null
			);
			if (shared) {
				fillColorValue = shared;
			}
		}
		if (strokable.length > 0) {
			const shared = getSharedColor(strokable, (shape) =>
				shape.type === 'arrow' ? shape.props.style.stroke : (shape.props.stroke ?? null)
			);
			if (shared) {
				strokeColorValue = shared;
			}
		}
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

	function openInfo() {
		infoOpen = true;
	}

	function closeInfo() {
		infoOpen = false;
	}

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

	function shapeSupportsFill(shape: ShapeRecord): shape is RectShape | EllipseShape | TextShape {
		return shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'text';
	}

	function shapeSupportsStroke(
		shape: ShapeRecord
	): shape is RectShape | EllipseShape | LineShape | ArrowShape {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'line' ||
			shape.type === 'arrow'
		);
	}

	function getSharedColor<T extends ShapeRecord>(
		shapes: T[],
		extract: (shape: T) => string | null | undefined
	): string | null {
		if (shapes.length === 0) {
			return null;
		}
		const first = extract(shapes[0]);
		if (!first) {
			return null;
		}
		for (let index = 1; index < shapes.length; index++) {
			if (extract(shapes[index]) !== first) {
				return null;
			}
		}
		return first;
	}

	function applyFillColor(color: string) {
		const state = store.getState();
		const targets = getSelectedShapes(state).filter(shapeSupportsFill);
		if (targets.length === 0) {
			return;
		}
		const before = EditorState.clone(state);
		const newShapes = { ...state.doc.shapes };
		for (const shape of targets) {
			if (shape.type === 'text') {
				const updated: TextShape = { ...shape, props: { ...shape.props, color } };
				newShapes[shape.id] = updated;
			} else if (shape.type === 'rect') {
				const updated: RectShape = { ...shape, props: { ...shape.props, fill: color } };
				newShapes[shape.id] = updated;
			} else if (shape.type === 'ellipse') {
				const updated: EllipseShape = { ...shape, props: { ...shape.props, fill: color } };
				newShapes[shape.id] = updated;
			}
		}
		const after = { ...state, doc: { ...state.doc, shapes: newShapes } };
		const command = new SnapshotCommand('Set fill color', 'doc', before, EditorState.clone(after));
		store.executeCommand(command);
	}

	function applyStrokeColor(color: string) {
		const state = store.getState();
		const targets = getSelectedShapes(state).filter(shapeSupportsStroke);
		if (targets.length === 0) {
			return;
		}
		const before = EditorState.clone(state);
		const newShapes = { ...state.doc.shapes };
		for (const shape of targets) {
			switch (shape.type) {
				case 'rect': {
					const updated: RectShape = { ...shape, props: { ...shape.props, stroke: color } };
					newShapes[shape.id] = updated;
					break;
				}
				case 'ellipse': {
					const updated: EllipseShape = { ...shape, props: { ...shape.props, stroke: color } };
					newShapes[shape.id] = updated;
					break;
				}
				case 'line': {
					const updated: LineShape = { ...shape, props: { ...shape.props, stroke: color } };
					newShapes[shape.id] = updated;
					break;
				}
				case 'arrow': {
					const updated: ArrowShape = {
						...shape,
						props: { ...shape.props, style: { ...shape.props.style, stroke: color } }
					};
					newShapes[shape.id] = updated;
					break;
				}
			}
		}
		const after = { ...state, doc: { ...state.doc, shapes: newShapes } };
		const command = new SnapshotCommand(
			'Set stroke color',
			'doc',
			before,
			EditorState.clone(after)
		);
		store.executeCommand(command);
	}

	function handleFillChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		fillColorValue = input.value;
		applyFillColor(input.value);
	}

	function handleStrokeChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		strokeColorValue = input.value;
		applyStrokeColor(input.value);
	}

	function handleBrushChange(newBrush: BrushSettings) {
		brushStore.set(newBrush);
	}

	function invokeDesktopAction(action?: () => void | Promise<void>) {
		if (action) {
			void action();
		}
	}

	function handleRecentSelect(event: Event) {
		if (!desktop?.onSelectBoard) {
			return;
		}
		const select = event.currentTarget as HTMLSelectElement;
		const boardId = select.value;
		if (boardId) {
			void desktop.onSelectBoard(boardId);
		}
		select.value = '';
	}

	function desktopFileLabel() {
		return desktop?.fileName ?? 'Unsaved board';
	}
</script>

<div class="toolbar" role="toolbar" aria-label="Drawing tools">
	<div class="toolbar__brand">
		<div class="toolbar__logo">
			<img src={icon} alt="Inkfinite Icon" />
		</div>
		<div style="display: flex; gap: 0.125rem; flex-direction:column;">
			<div class="toolbar__name">Inkfinite</div>
			<div class="toolbar__tagline">Stormlight Labs</div>
		</div>
	</div>
	{#if platform === 'desktop' && desktop}
		<div class="toolbar__desktop">
			<div class="toolbar__file" aria-live="polite">{desktopFileLabel()}</div>
			<div class="toolbar__desktop-actions">
				<button
					class="toolbar__desktop-button"
					type="button"
					onclick={() => invokeDesktopAction(desktop.onNew)}
					aria-label="Create new board">
					New…
				</button>
				<button
					class="toolbar__desktop-button"
					type="button"
					onclick={() => invokeDesktopAction(desktop.onOpen)}
					aria-label="Open board from disk">
					Open…
				</button>
				<button
					class="toolbar__desktop-button"
					type="button"
					onclick={() => invokeDesktopAction(desktop.onSaveAs)}
					aria-label="Save board as new file">
					Save As…
				</button>
				{#if desktop.recentBoards.length > 0}
					<label class="toolbar__recent">
						<span>Recent</span>
						<select onchange={handleRecentSelect} aria-label="Switch to recent board">
							<option value="">Select…</option>
							{#each desktop.recentBoards as board (`${board.id}:${board.name}`)}
								<option value={board.id}>{board.name}</option>
							{/each}
						</select>
					</label>
				{/if}
			</div>
		</div>
	{/if}
	<div class="toolbar__divider"></div>
	{#each TOOLS as tool (`${tool.id}:${tool.label}`)}
		<button
			class="toolbar__tool-button tool-button"
			class:toolbar__tool-button--active={currentTool === tool.id}
			class:active={currentTool === tool.id}
			onclick={() => handleToolClick(tool.id)}
			aria-label={tool.label}
			aria-pressed={currentTool === tool.id}
			data-tool-id={tool.id}>
			<span class="toolbar__tool-icon">{tool.icon}</span>
			<span class="toolbar__tool-label">{tool.label}</span>
		</button>
	{/each}

	<div class="toolbar__colors" aria-label="Color controls">
		<label class="toolbar__color-control">
			<span>Fill</span>
			<input
				type="color"
				value={fillColorValue}
				onchange={handleFillChange}
				disabled={fillDisabled}
				aria-label="Fill color" />
		</label>
		<label class="toolbar__color-control">
			<span>Stroke</span>
			<input
				type="color"
				value={strokeColorValue}
				onchange={handleStrokeChange}
				disabled={strokeDisabled}
				aria-label="Stroke color" />
		</label>
	</div>

	<div class="toolbar__divider"></div>

	<BrushPopover {brush} onBrushChange={handleBrushChange} disabled={currentTool !== 'pen'} />
	<ArrowPopover {store} disabled={!hasArrowSelection} />
	<div class="toolbar__zoom">
		<button
			class="toolbar__zoom-button"
			bind:this={zoomButtonEl}
			onclick={() => (zoomMenuOpen = !zoomMenuOpen)}
			aria-label="Zoom level"
			aria-haspopup="true"
			aria-expanded={zoomMenuOpen}>
			{getZoomPct()}%
		</button>

		{#if zoomMenuOpen}
			<div class="toolbar__zoom-menu" bind:this={zoomMenuEl} role="menu" aria-label="Zoom options">
				{#each ZOOM_PRESETS as preset (`${preset.label}:${preset.value}`)}
					<button
						class="toolbar__menu-item"
						role="menuitem"
						onclick={() => setZoomPercent(preset.value)}
						aria-label="Zoom to {preset.label}">
						{preset.label}
					</button>
				{/each}
				<div class="toolbar__menu-divider"></div>
				<button
					class="toolbar__menu-item"
					role="menuitem"
					onclick={zoomToFit}
					aria-label="Zoom to fit all shapes">
					Zoom to fit
				</button>
				<button
					class="toolbar__menu-item"
					role="menuitem"
					onclick={zoomToSelection}
					aria-label="Zoom to selected shapes">
					Zoom to selection
				</button>
			</div>
		{/if}
	</div>

	<div class="toolbar__export">
		<button
			class="toolbar__export-button"
			bind:this={exportButtonEl}
			onclick={() => (exportMenuOpen = !exportMenuOpen)}
			aria-label="Export drawing"
			aria-haspopup="true"
			aria-expanded={exportMenuOpen}>
			Export
		</button>

		{#if exportMenuOpen}
			<div
				class="toolbar__export-menu"
				bind:this={exportMenuEl}
				role="menu"
				aria-label="Export options">
				<button
					class="toolbar__menu-item"
					role="menuitem"
					onclick={exportPNGViewport}
					aria-label="Export current view as PNG">
					PNG (Viewport)
				</button>
				<button
					class="toolbar__menu-item"
					role="menuitem"
					onclick={exportSVGAll}
					aria-label="Export all shapes as SVG">
					SVG (All)
				</button>
				<button
					class="toolbar__menu-item"
					role="menuitem"
					onclick={exportSVGSelection}
					aria-label="Export selected shapes as SVG">
					SVG (Selection)
				</button>
			</div>
		{/if}
	</div>

	<div class="toolbar__info-actions">
        <button 
            class="toolbar__info" 
            onclick={() => themeStore.toggle()} 
            aria-label="Toggle Dark Mode"
            title="Toggle Dark Mode">
            <Icon name={themeStore.current === 'dark' ? 'sun' : 'moon'} size={16} />
			<span class="toolbar__info-label">{themeStore.current === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
		{#if platform === 'web' && onOpenBrowser}
			<button class="toolbar__info" onclick={onOpenBrowser} aria-label="Browse boards">
				<Icon name="folder" size={16} />
				<span class="toolbar__info-label">Boards</span>
			</button>
		{/if}
		<button class="toolbar__info" onclick={openInfo} aria-label="About Inkfinite">
			<Icon name="info-circle" size={16} />
			<span class="toolbar__info-label">Info</span>
		</button>
	</div>

	{#if onHistoryClick}
		<div class="toolbar__divider"></div>
		<button
			class="toolbar__tool-button toolbar__tool-button--history tool-button history-button"
			data-tool-id="history"
			onclick={onHistoryClick}
			aria-label="History"
			aria-pressed="false">
			<span class="toolbar__tool-icon">⏱</span>
			<span class="toolbar__tool-label">History</span>
		</button>
	{/if}
</div>

<Dialog bind:open={infoOpen} onClose={closeInfo} title="About Inkfinite">
	<section class="about">
		<h1>About Inkfinite</h1>
		<p>
			Inkfinite is an infinite canvas prototype. The goal is to build a cross-platform editor with
			a framework-agnostic core so the same engine powers both the web and desktop apps.
		</p>

		<div class="about__section">
			<h2>Quick Tips</h2>
			<ul>
				{#each KEYBOARD_TIPS as tip (tip)}
					<li>{tip}</li>
				{/each}
			</ul>
		</div>

		<div class="about__section">
			<h2>Need help?</h2>
			<ul>
				{#each HELP_LINKS as link (link.href)}
					<li>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a href={link.href} target={link.external ? '_blank' : undefined} rel="noreferrer">
							{link.label}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</section>
</Dialog>

<style>
	.toolbar {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--surface-elevated);
		border-bottom: 1px solid var(--border);
		align-items: center;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        z-index: 10;
        position: relative;
	}

    .toolbar__brand {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-right: 1.5rem;
    }

    .toolbar__logo img {
        width: 32px;
        height: 32px;
    }

    .toolbar__name {
        font-weight: 600;
        font-size: 1.125rem;
        letter-spacing: -0.025em;
        color: var(--text);
    }

    .toolbar__tagline {
        font-size: 0.75rem;
        color: var(--text-muted);
        font-weight: 500;
    }

	.toolbar__tool-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 0.875rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
		min-width: 68px;
	}

	.toolbar__tool-button:hover {
		background: var(--bg-tertiary);
		color: var(--text);
	}

	.toolbar__tool-button:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.toolbar__tool-button--active,
	.tool-button.active {
		background: var(--accent);
		color: var(--surface);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.toolbar__tool-icon {
		font-size: 1.25rem;
		line-height: 1;
	}

	.toolbar__tool-label {
		font-size: 0.75rem;
        font-weight: 500;
		line-height: 1;
		white-space: nowrap;
	}

	.toolbar__divider {
		width: 1px;
		background-color: var(--border);
		margin: 0 1rem;
		height: 48px;
	}

    .toolbar__info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        transition: color 0.2s;
        font-size: 0.875rem;
    }
    
    .toolbar__info:hover {
        background: var(--bg-tertiary);
        color: var(--text);
    }

	.toolbar__zoom,
	.toolbar__export {
		position: relative;
	}

	.toolbar__zoom-button,
	.toolbar__export-button {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
        font-weight: 500;
		min-width: 72px;
        transition: all 0.2s;
	}

	.toolbar__zoom-button:hover,
	.toolbar__export-button:hover {
		background: var(--bg-tertiary);
        border-color: var(--text-muted);
	}

	.toolbar__zoom-menu,
	.toolbar__export-menu {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		background: var(--surface-elevated);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
        min-width: 160px;
        z-index: 20;
		z-index: 10;
		min-width: 150px;
	}

	.toolbar__menu-item {
		border: none;
		background: transparent;
		color: var(--text);
		padding: 4px 8px;
		border-radius: 0.25rem;
		text-align: left;
		cursor: pointer;
		font-size: 13px;
	}

	.toolbar__menu-item:hover {
		background: var(--surface-elevated);
	}

	.toolbar__menu-item:focus {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.toolbar__menu-divider {
		height: 1px;
		background: var(--border);
		margin: 6px 0;
	}

	.toolbar__tool-button--history {
		margin-left: auto;
	}

	.toolbar__brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.toolbar__desktop {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.toolbar__file {
		font-size: 13px;
		color: var(--text-secondary);
	}

	.toolbar__desktop-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.toolbar__desktop-button {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 13px;
		cursor: pointer;
	}

	.toolbar__desktop-button:hover {
		background: var(--surface-elevated);
	}

	.toolbar__recent {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.toolbar__recent select {
		font-size: 0.75rem;
		padding: 4px 6px;
		border-radius: 0.25rem;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}

	.toolbar__logo {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: var(--accent);
		color: var(--surface);
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
	}

	.toolbar__name {
		font-weight: 600;
		color: var(--text);
	}

	.toolbar__tagline {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.toolbar__info {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		border-radius: 999px;
		padding: 4px 10px;
		cursor: pointer;
		font-size: 14px;
	}

	.toolbar__info:hover {
		background: var(--surface-elevated);
	}

	.toolbar__info-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.about {
		padding: 24px;
		max-width: 480px;
	}

	.about h1 {
		margin-top: 0;
		font-size: 22px;
	}

	.about__section {
		margin-top: 20px;
	}

	.about__section h2 {
		margin-bottom: 8px;
		font-size: 16px;
		color: var(--text-secondary);
	}

	.about__section ul {
		margin: 0;
		padding-left: 20px;
	}

	.about__section li + li {
		margin-top: 0.25rem;
	}

	.about__section a {
		color: var(--accent);
		text-decoration: none;
	}

	.about__section a:hover {
		text-decoration: underline;
	}

	.toolbar__info-actions {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
