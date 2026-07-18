<script lang="ts">
	import { BrushPopover, Icon } from '../../index';
	import { DEFAULT_FILL_COLOR, DEFAULT_STROKE_COLOR, TOOLS, ZOOM_PRESETS } from '../constants';
	import type { EditorPlatform } from '../platform';
	import type { BrushSettings, BrushStore } from '../status';
	import type {
		ArrowShape,
		BoardMeta,
		Box2,
		EditorState as EditorStateType,
		EllipseShape,
		LineShape,
		MarkdownShape,
		RectShape,
		ShapeRecord,
		Store,
		StrokeShape,
		TextShape,
		ToolId
	} from '@inkfinite/core';
	import {
		EditorState,
		exportToSVG,
		exportViewportToPNG,
		getSelectedShapes,
		getShapesOnCurrentPage,
		shapeBounds,
		SnapshotCommand
	} from '@inkfinite/core';
	import { fade } from 'svelte/transition';
	import ArrowPopover from './ArrowPopover.svelte';

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
		store: Store;
		getViewport: () => Viewport;
		canvas?: HTMLCanvasElement;
		brushStore: BrushStore;
		platform?: EditorPlatform;
		desktop?: DesktopControls;
		onStencilsClick?: () => void;
	};

	let {
		currentTool,
		onToolChange,
		store,
		getViewport,
		canvas,
		brushStore,
		platform = 'web',
		desktop,
		onStencilsClick
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
	let fillOpacityValue = $state(1);
	let strokeOpacityValue = $state(1);
	let fillDisabled = $state(true);
	let strokeDisabled = $state(true);
	let brush = $derived<BrushSettings>(brushStore.get());
	let hasArrowSelection = $derived(
		getSelectedShapes(editorState).some((s) => s.type === 'arrow')
	);

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
		const fillOpacityTargets = selection.filter(shapeSupportsFillOpacity);
		const strokeOpacityTargets = selection.filter(shapeSupportsStrokeOpacity);
		fillDisabled = fillable.length === 0;
		strokeDisabled = strokable.length === 0;
		if (fillable.length > 0) {
			const shared = getSharedColor(fillable, (shape) =>
				shape.type === 'text'
					? shape.props.color
					: 'fill' in shape.props
						? shape.props.fill
						: null
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
		fillOpacityValue = getSharedOpacity(fillOpacityTargets, (shape) => shape.fillOpacity) ?? 1;
		strokeOpacityValue =
			getSharedOpacity(strokeOpacityTargets, (shape) =>
				shape.type === 'stroke'
					? (shape.strokeOpacity ?? shape.props.style.opacity)
					: shape.strokeOpacity
			) ?? 1;
	});

	let showColorControls = $derived(
		toolSupportsStyles(currentTool) ||
			toolSupportsFill(currentTool) ||
			getSelectedShapes(editorState).some(
				(s) =>
					shapeSupportsFill(s) ||
					shapeSupportsStroke(s) ||
					shapeSupportsFillOpacity(s) ||
					shapeSupportsStrokeOpacity(s)
			)
	);

	let position = $state({ x: 20, y: 20 });
	let isDragging = $state(false);
	let dragOffset = $state({ x: 0, y: 0 });
	let toolbarEl = $state<HTMLElement | null>(null);

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

	function handleDragStart(event: PointerEvent) {
		isDragging = true;
		dragOffset = { x: event.clientX - position.x, y: event.clientY - position.y };

		if (typeof document !== 'undefined') document.body.style.userSelect = 'none';

		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handleDragMove(event: PointerEvent) {
		if (!isDragging) return;
		const width = toolbarEl?.offsetWidth ?? 0;
		const height = toolbarEl?.offsetHeight ?? 0;
		const maxX = Math.max(8, window.innerWidth - width - 8);
		const maxY = Math.max(8, window.innerHeight - height - 8);
		position = {
			x: Math.min(maxX, Math.max(8, event.clientX - dragOffset.x)),
			y: Math.min(maxY, Math.max(8, event.clientY - dragOffset.y))
		};
	}

	function handleDragEnd(event: PointerEvent) {
		isDragging = false;
		if (typeof document !== 'undefined') document.body.style.userSelect = '';
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
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
		const center = {
			x: (bounds.min.x + bounds.max.x) / 2,
			y: (bounds.min.y + bounds.max.y) / 2
		};
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
				min: {
					x: Math.min(acc.min.x, shapeBox.min.x),
					y: Math.min(acc.min.y, shapeBox.min.y)
				},
				max: {
					x: Math.max(acc.max.x, shapeBox.max.x),
					y: Math.max(acc.max.y, shapeBox.max.y)
				}
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
				min: {
					x: Math.min(acc.min.x, shapeBox.min.x),
					y: Math.min(acc.min.y, shapeBox.min.y)
				},
				max: {
					x: Math.max(acc.max.x, shapeBox.max.x),
					y: Math.max(acc.max.y, shapeBox.max.y)
				}
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

	function shapeSupportsFillOpacity(
		shape: ShapeRecord
	): shape is RectShape | EllipseShape | TextShape | MarkdownShape {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'text' ||
			shape.type === 'markdown'
		);
	}

	function shapeSupportsStrokeOpacity(
		shape: ShapeRecord
	): shape is RectShape | EllipseShape | LineShape | ArrowShape | StrokeShape | MarkdownShape {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'line' ||
			shape.type === 'arrow' ||
			shape.type === 'stroke' ||
			shape.type === 'markdown'
		);
	}

	function toolSupportsStyles(tool: ToolId): boolean {
		return tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow';
	}

	function toolSupportsFill(tool: ToolId): boolean {
		return tool === 'rect' || tool === 'ellipse' || tool === 'text';
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

	function getSharedOpacity<T extends ShapeRecord>(
		shapes: T[],
		extract: (shape: T) => number | undefined
	): number | null {
		if (shapes.length === 0) return null;
		const first = extract(shapes[0]) ?? 1;
		return shapes.every((shape) => (extract(shape) ?? 1) === first) ? first : null;
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
		const command = new SnapshotCommand(
			'Set fill color',
			'doc',
			before,
			EditorState.clone(after)
		);
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
					const updated: RectShape = {
						...shape,
						props: { ...shape.props, stroke: color }
					};
					newShapes[shape.id] = updated;
					break;
				}
				case 'ellipse': {
					const updated: EllipseShape = {
						...shape,
						props: { ...shape.props, stroke: color }
					};
					newShapes[shape.id] = updated;
					break;
				}
				case 'line': {
					const updated: LineShape = {
						...shape,
						props: { ...shape.props, stroke: color }
					};
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

	function applyOpacity(field: 'fillOpacity' | 'strokeOpacity', value: number) {
		const state = store.getState();
		const targets = getSelectedShapes(state).filter(
			field === 'fillOpacity' ? shapeSupportsFillOpacity : shapeSupportsStrokeOpacity
		);
		if (targets.length === 0) return;
		const opacity = Math.min(1, Math.max(0, value));
		const before = EditorState.clone(state);
		const shapes = { ...state.doc.shapes };
		for (const shape of targets) {
			shapes[shape.id] = { ...shape, [field]: opacity } as ShapeRecord;
		}
		const after = { ...state, doc: { ...state.doc, shapes } };
		store.executeCommand(
			new SnapshotCommand(
				field === 'fillOpacity' ? 'Set fill opacity' : 'Set stroke opacity',
				'doc',
				before,
				EditorState.clone(after)
			)
		);
	}

	function handleOpacityChange(event: Event, field: 'fillOpacity' | 'strokeOpacity') {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		if (!Number.isFinite(value)) return;
		if (field === 'fillOpacity') fillOpacityValue = value;
		else strokeOpacityValue = value;
		applyOpacity(field, value);
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

<div
	class="toolbar"
	role="toolbar"
	aria-label="Drawing tools"
	bind:this={toolbarEl}
	style="position: fixed; left: {position.x}px; top: {position.y}px;"
	data-dragging={isDragging}>
	<!-- Drag Handle -->
	<div
		class="toolbar__drag-handle"
		onpointerdown={handleDragStart}
		onpointermove={handleDragMove}
		onpointerup={handleDragEnd}
		aria-label="Drag toolbar"
		role="button"
		tabindex="0">
		<Icon name="grip-vertical" size={16} />
	</div>

	<div class="toolbar__brand">
		<div class="toolbar__logo" aria-hidden="true">
			<svg viewBox="0 0 24 24">
				<path
					fill="currentColor"
					d="M9.75 20.85c1.78-.7 1.39-2.63.49-3.85c-.89-1.25-2.12-2.11-3.36-2.94A9.8 9.8 0 0 1 4.54 12c-.28-.33-.85-.94-.27-1.06c.59-.12 1.61.46 2.13.68c.91.38 1.81.82 2.65 1.34l1.01-1.7C8.5 10.23 6.5 9.32 4.64 9.05c-1.06-.16-2.18.06-2.54 1.21c-.32.99.19 1.99.77 2.77c1.37 1.83 3.5 2.71 5.09 4.29c.34.33.75.72.95 1.18c.21.44.16.47-.31.47c-1.24 0-2.79-.97-3.8-1.61l-1.01 1.7c1.53.94 4.09 2.41 5.96 1.79m9.21-13.52L13.29 13H11v-2.29l5.67-5.68zm3.4-.78c-.01.3-.32.61-.64.92L19.2 10l-.87-.87l2.6-2.59l-.59-.59l-.67.67l-2.29-2.29l2.15-2.15c.24-.24.63-.24.86 0l1.43 1.43c.24.22.24.62 0 .86c-.21.21-.41.41-.41.61c-.02.2.18.42.38.59c.29.3.58.58.57.88" />
			</svg>
		</div>
		<div style="display: flex; gap: 0.125rem; flex-direction:column;">
			<div class="toolbar__name">Inkfinite</div>
			<a
				class="toolbar__tagline"
				href="https://stormlightlabs.org"
				target="_blank"
				rel="noreferrer">Stormlight Labs</a>
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
			<span class="toolbar__tool-icon"><Icon name={tool.icon} size={20} /></span>
			<span class="toolbar__tool-label">{tool.label}</span>
		</button>
		{#if tool.id === 'select' && onStencilsClick}
			<button
				class="toolbar__tool-button tool-button"
				onclick={onStencilsClick}
				aria-label="Stencils"
				title="Stencils">
				<span class="toolbar__tool-icon">
					<Icon name="grid-dots" size={18} />
				</span>
				<span class="toolbar__tool-label">Stencils</span>
			</button>
			<div class="toolbar__divider"></div>
		{/if}
	{/each}

	{#if showColorControls}
		<div
			class="toolbar__colors"
			aria-label="Color controls"
			transition:fade={{ duration: 150 }}>
			{#if toolSupportsFill(currentTool) || getSelectedShapes(editorState).some(shapeSupportsFill)}
				<label class="toolbar__color-control">
					<span>Fill</span>
					<input
						type="color"
						value={fillColorValue}
						onchange={handleFillChange}
						disabled={fillDisabled && !toolSupportsFill(currentTool)}
						aria-label="Fill color" />
				</label>
			{/if}
			{#if toolSupportsStyles(currentTool) || getSelectedShapes(editorState).some(shapeSupportsStroke)}
				<label class="toolbar__color-control">
					<span>Stroke</span>
					<input
						type="color"
						value={strokeColorValue}
						onchange={handleStrokeChange}
						disabled={strokeDisabled && !toolSupportsStyles(currentTool)}
						aria-label="Stroke color" />
				</label>
			{/if}
			{#if getSelectedShapes(editorState).some(shapeSupportsFillOpacity)}
				<label class="toolbar__opacity-control">
					<span>Fill opacity</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={fillOpacityValue}
						onchange={(event) => handleOpacityChange(event, 'fillOpacity')}
						aria-label="Fill opacity"
						aria-valuetext={`${Math.round(fillOpacityValue * 100)}%`} />
					<output>{Math.round(fillOpacityValue * 100)}%</output>
				</label>
			{/if}
			{#if getSelectedShapes(editorState).some(shapeSupportsStrokeOpacity)}
				<label class="toolbar__opacity-control">
					<span>Stroke opacity</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={strokeOpacityValue}
						onchange={(event) => handleOpacityChange(event, 'strokeOpacity')}
						aria-label="Stroke opacity"
						aria-valuetext={`${Math.round(strokeOpacityValue * 100)}%`} />
					<output>{Math.round(strokeOpacityValue * 100)}%</output>
				</label>
			{/if}
		</div>
	{/if}

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
			<div
				class="toolbar__zoom-menu"
				bind:this={zoomMenuEl}
				role="menu"
				aria-label="Zoom options">
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
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ink-space-2);
		width: max-content;
		max-width: calc(100vw - 2.5rem);
		padding: var(--ink-space-2);
		background: color-mix(in srgb, var(--ink-surface-raised) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--ink-border) 64%, transparent);
		border-radius: var(--ink-radius-panel);
		align-items: center;
		box-shadow:
			0 1px 0 color-mix(in srgb, white 9%, transparent) inset,
			0 12px 32px color-mix(in srgb, var(--ink-shadow-color) 28%, transparent),
			0 2px 6px color-mix(in srgb, var(--ink-shadow-color) 24%, transparent);
		backdrop-filter: blur(14px);
		z-index: 100;
		transition-property: transform, box-shadow;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
		touch-action: none;
	}

	.toolbar[data-dragging='true'] {
		transform: scale(0.99);
		box-shadow:
			0 10px 26px color-mix(in srgb, var(--ink-shadow-color) 34%, transparent),
			0 2px 7px color-mix(in srgb, var(--ink-shadow-color) 28%, transparent);
	}

	.toolbar__drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		min-height: 40px;
		cursor: grab;
		color: var(--text-muted);
		opacity: 0.5;
		transition: opacity 0.2s;
		touch-action: none;
	}

	.toolbar__drag-handle:hover {
		opacity: 1;
		color: var(--text);
	}

	.toolbar[data-dragging='true'] .toolbar__drag-handle {
		cursor: grabbing;
		opacity: 1;
		color: var(--accent);
	}

	.toolbar__brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-right: var(--ink-space-2);
	}

	.toolbar__logo svg {
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
		text-decoration: none;
	}

	.toolbar__tagline:hover {
		color: var(--text);
		text-decoration: underline;
		text-underline-offset: 0.16em;
	}

	.toolbar__tagline:focus-visible {
		border-radius: 2px;
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.toolbar__tool-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--ink-space-1);
		min-height: 48px;
		padding: var(--ink-space-2) var(--ink-space-3);
		border: var(--ink-line-width) solid transparent;
		border-radius: var(--ink-radius-wobbly-small);
		background: transparent;
		color: var(--text);
		cursor: pointer;
		transition-property: color, background-color, border-color, box-shadow, transform;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
		min-width: 58px;
		opacity: 0.8;
	}

	.toolbar__tool-button:hover {
		background: var(--bg-tertiary);
		color: var(--text);
		opacity: 1;
		border-color: var(--text-muted);
	}

	.toolbar__tool-button:active,
	.toolbar__zoom-button:active,
	.toolbar__export-button:active {
		transform: scale(0.96);
	}

	.toolbar__tool-button:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.toolbar__tool-button--active,
	.tool-button.active {
		background: var(--ink-accent);
		color: var(--ink-on-accent);
		border-color: var(--ink-border-strong);
		box-shadow: 2px 2px 0 var(--ink-shadow-color);
		opacity: 1;
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
		margin: 0 var(--ink-space-1);
		height: 32px;
		opacity: 0.5;
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
		transition-property: color, background-color, border-color, transform;
		transition-duration: 0.2s;
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
		box-shadow:
			0 10px 15px -3px rgba(0, 0, 0, 0.1),
			0 4px 6px -2px rgba(0, 0, 0, 0.05);
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
		width: 32px;
		height: 32px;
		color: var(--text);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.toolbar__name {
		font-weight: 600;
		color: var(--text);
	}

	.toolbar__tagline {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.toolbar__colors {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.toolbar__color-control {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 4px;
		text-align: right;
	}

	.toolbar__opacity-control {
		display: grid;
		grid-template-columns: minmax(6rem, auto) 7rem 3rem;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
	}

	.toolbar__opacity-control output {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	@media (max-width: 1320px) {
		.toolbar__tool-label,
		.toolbar__tagline {
			display: none;
		}

		.toolbar__tool-button {
			min-width: 44px;
			min-height: 44px;
			padding: var(--ink-space-2);
			justify-content: center;
		}

		.toolbar__brand {
			margin-right: 0;
		}
	}

	@media (max-width: 760px) {
		.toolbar {
			max-height: calc(100vh - 5rem);
			overflow-y: auto;
		}

		.toolbar__brand,
		.toolbar__divider {
			display: none;
		}
	}
</style>
