<script lang="ts">
	import type {
		ArrowShape,
		EditorState as EditorStateType,
		EllipseShape,
		InterchangeFormat,
		ImageShape,
		LineShape,
		MarkdownShape,
		PathShape,
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
		SnapshotCommand
	} from '@inkfinite/core';
	import { fade } from 'svelte/transition';
	import {
		BrushPopover,
		ColorPicker,
		ContextMenu,
		Icon,
		type ContextMenuEntry
	} from '../../index';
	import {
		executeSelectionCommand,
		SELECTION_COMMAND_LABELS,
		type SelectionCommand
	} from '../commands';
	import { DEFAULT_FILL_COLOR, DEFAULT_STROKE_COLOR, TOOLS } from '../constants';
	import type { BrushSettings, BrushStore } from '../status';
	import ArrowPopover from './ArrowPopover.svelte';

	type Props = {
		currentTool: ToolId;
		onToolChange: (toolId: ToolId) => void;
		store: Store;
		canvas?: HTMLCanvasElement;
		brushStore: BrushStore;
		onStencilsClick?: () => void;
		/** Whether to expose the desktop-only agent editability control. */
		showAgentControl?: boolean;
		onImportEditable?: () => void;
		onImportSvg?: () => void;
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
		onImportEditable,
		onImportSvg,
		onImportSvgMarkup,
		onExportSvg,
		onExportEditable,
		interchangeBusy = false
	}: Props = $props();

	let editorState = $derived<EditorStateType>(store.getState());
	let exportMenuOpen = $state(false);
	let exportMenuEl = $state<HTMLDivElement | null>(null);
	let exportButtonEl = $state<HTMLButtonElement | null>(null);
	let importMenuOpen = $state(false);
	let importMenuPoint = $state({ x: 0, y: 0 });
	let importButtonEl = $state<HTMLButtonElement | null>(null);
	let layoutMenuOpen = $state(false);
	let layoutMenuPoint = $state({ x: 0, y: 0 });
	let layoutButtonEl = $state<HTMLButtonElement | null>(null);
	let fillColorValue = $state(DEFAULT_FILL_COLOR);
	let strokeColorValue = $state(DEFAULT_STROKE_COLOR);
	let fillOpacityValue = $state(1);
	let strokeOpacityValue = $state(1);
	let fillDisabled = $state(true);
	let strokeDisabled = $state(true);
	let agentEditableValue = $state(true);
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
		agentEditableValue = selection.every((shape) => shape.agentEditable !== false);
	});

	let showColorControls = $derived(
		getSelectedShapes(editorState).some(
			(s) =>
				shapeSupportsFill(s) ||
				shapeSupportsStroke(s) ||
				shapeSupportsFillOpacity(s) ||
				shapeSupportsStrokeOpacity(s)
		)
	);
	let selectedShapes = $derived(getSelectedShapes(editorState));
	let selectionCount = $derived(selectedShapes.length);
	let hasGroupedSelection = $derived(
		selectedShapes.some((shape) => Boolean(shape.groupId) || shape.type === 'container')
	);
	let allSelectedLocked = $derived(
		selectionCount > 0 && selectedShapes.every((shape) => shape.locked)
	);
	let showContextControls = $derived(
		currentTool !== 'pen' && (selectionCount > 0 || hasArrowSelection)
	);

	let position = $state({ x: 12, y: 12 });
	let isDragging = $state(false);
	let dragOffset = $state({ x: 0, y: 0 });
	let toolbarEl = $state<HTMLElement | null>(null);

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
		if (event.button !== 0) return;
		isDragging = true;
		dragOffset = { x: event.clientX - position.x, y: event.clientY - position.y };

		if (typeof document !== 'undefined') document.body.style.userSelect = 'none';

		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handleDragMove(event: PointerEvent) {
		if (!isDragging) return;
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
	}

	function handleDragKeyDown(event: KeyboardEvent) {
		const distance = event.shiftKey ? 10 : 1;
		if (event.key === 'Home') {
			position = { x: 12, y: 12 };
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

	function toggleLayoutMenu() {
		if (!layoutButtonEl) return;
		if (layoutMenuOpen) {
			layoutMenuOpen = false;
			return;
		}
		const bounds = layoutButtonEl.getBoundingClientRect();
		layoutMenuPoint = { x: bounds.left, y: bounds.bottom + 8 };
		layoutMenuOpen = true;
	}

	function getLayoutMenuItems(): ContextMenuEntry[] {
		const items: ContextMenuEntry[] = [];
		const enoughForAlignment = selectionCount >= 2;
		const enoughForDistribution = selectionCount >= 3;
		if (enoughForAlignment) {
			items.push(
				...(
					[
						'align-left',
						'align-center',
						'align-right',
						'align-top',
						'align-middle',
						'align-bottom'
					] as SelectionCommand[]
				).map((id) => ({
					id,
					label: SELECTION_COMMAND_LABELS[id],
					icon: 'select' as const,
					disabled: !enoughForAlignment
				}))
			);
			items.push({ type: 'separator' });
		}
		items.push(
			{
				id: 'distribute-horizontal',
				label: SELECTION_COMMAND_LABELS['distribute-horizontal'],
				icon: 'arrow-right',
				disabled: !enoughForDistribution
			},
			{
				id: 'distribute-vertical',
				label: SELECTION_COMMAND_LABELS['distribute-vertical'],
				icon: 'arrow-down',
				disabled: !enoughForDistribution
			},
			{ type: 'separator' },
			{
				id: 'group',
				label: SELECTION_COMMAND_LABELS.group,
				icon: 'layers',
				disabled: selectionCount < 2
			},
			{
				id: 'ungroup',
				label: SELECTION_COMMAND_LABELS.ungroup,
				icon: 'layers',
				disabled: !hasGroupedSelection
			},
			{ type: 'separator' },
			{
				id: 'forward',
				label: SELECTION_COMMAND_LABELS.forward,
				icon: 'arrow-up',
				shortcut: '⌘/Ctrl ]'
			},
			{
				id: 'backward',
				label: SELECTION_COMMAND_LABELS.backward,
				icon: 'arrow-down',
				shortcut: '⌘/Ctrl ['
			},
			{
				id: 'front',
				label: SELECTION_COMMAND_LABELS.front,
				icon: 'arrow-up',
				shortcut: '⇧⌘/Ctrl ]'
			},
			{
				id: 'back',
				label: SELECTION_COMMAND_LABELS.back,
				icon: 'arrow-down',
				shortcut: '⇧⌘/Ctrl ['
			},
			{ type: 'separator' },
			{
				id: allSelectedLocked ? 'unlock' : 'lock',
				label: allSelectedLocked
					? SELECTION_COMMAND_LABELS.unlock
					: SELECTION_COMMAND_LABELS.lock,
				icon: allSelectedLocked ? 'lock-open' : 'lock',
				shortcut: '⇧⌘/Ctrl L'
			},
			{ type: 'separator' },
			{
				id: 'agent-editable',
				label: SELECTION_COMMAND_LABELS['agent-editable'],
				icon: 'terminal'
			},
			{
				id: 'agent-readonly',
				label: SELECTION_COMMAND_LABELS['agent-readonly'],
				icon: 'lock-open'
			}
		);
		return items;
	}

	function handleLayoutMenuAction(id: string) {
		if (id in SELECTION_COMMAND_LABELS) {
			executeSelectionCommand(store, id as SelectionCommand);
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
		if (onImportSvg) {
			if (items.length > 0) items.push({ type: 'separator' });
			items.push({ id: 'import-svg-file', label: 'SVG file', icon: 'folder' });
		}
		if (onImportSvgMarkup) {
			items.push({ id: 'import-svg-markup', label: 'SVG code / markup', icon: 'svg' });
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

	function shapeSupportsFill(
		shape: ShapeRecord
	): shape is RectShape | EllipseShape | TextShape | PathShape {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'text' ||
			shape.type === 'path'
		);
	}

	function shapeSupportsStroke(
		shape: ShapeRecord
	): shape is RectShape | EllipseShape | LineShape | ArrowShape | PathShape {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'line' ||
			shape.type === 'arrow' ||
			shape.type === 'path'
		);
	}

	function shapeSupportsFillOpacity(
		shape: ShapeRecord
	): shape is RectShape | EllipseShape | TextShape | MarkdownShape | PathShape | ImageShape {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'text' ||
			shape.type === 'markdown' ||
			shape.type === 'path' ||
			shape.type === 'image'
		);
	}

	function shapeSupportsStrokeOpacity(
		shape: ShapeRecord
	): shape is
		| RectShape
		| EllipseShape
		| LineShape
		| ArrowShape
		| StrokeShape
		| MarkdownShape
		| PathShape {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'line' ||
			shape.type === 'arrow' ||
			shape.type === 'stroke' ||
			shape.type === 'markdown' ||
			shape.type === 'path'
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
			// FIXME: make this a switch..case
			if (shape.type === 'text') {
				const updated: TextShape = { ...shape, props: { ...shape.props, color } };
				newShapes[shape.id] = updated;
			} else if (shape.type === 'rect') {
				const updated: RectShape = { ...shape, props: { ...shape.props, fill: color } };
				newShapes[shape.id] = updated;
			} else if (shape.type === 'ellipse') {
				const updated: EllipseShape = { ...shape, props: { ...shape.props, fill: color } };
				newShapes[shape.id] = updated;
			} else if (shape.type === 'path') {
				const updated: PathShape = { ...shape, props: { ...shape.props, fill: color } };
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
				case 'path': {
					const updated: PathShape = {
						...shape,
						props: { ...shape.props, stroke: color }
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

	function handleFillChange(color: string) {
		fillColorValue = color;
		applyFillColor(color);
	}

	function handleStrokeChange(color: string) {
		strokeColorValue = color;
		applyStrokeColor(color);
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

	function handleAgentEditableChange(event: Event) {
		const state = store.getState();
		const targets = getSelectedShapes(state);
		if (targets.length === 0) return;
		const agentEditable = (event.currentTarget as HTMLInputElement).checked;
		const before = EditorState.clone(state);
		const shapes = { ...state.doc.shapes };
		for (const shape of targets) {
			shapes[shape.id] = { ...shape, agentEditable } as ShapeRecord;
		}
		const after = { ...state, doc: { ...state.doc, shapes } };
		store.executeCommand(
			new SnapshotCommand(
				agentEditable ? 'Allow Agent Edits' : 'Prevent Agent Edits',
				'doc',
				before,
				EditorState.clone(after)
			)
		);
	}
</script>

<div
	class="toolbar"
	role="toolbar"
	aria-label="Drawing tools"
	data-agent-occlusion
	bind:this={toolbarEl}
	style="position: fixed; left: {position.x}px; top: {position.y}px;"
	data-dragging={isDragging}>
	<!-- Drag Handle -->
	<div
		class="toolbar__drag-handle"
		onpointerdown={handleDragStart}
		onpointermove={handleDragMove}
		onpointerup={handleDragEnd}
		onpointercancel={handleDragEnd}
		onkeydown={handleDragKeyDown}
		aria-label="Drag toolbar"
		title="Move toolbar (arrow keys; Home resets)"
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
	<div class="toolbar__divider toolbar__brand-divider"></div>
	{#each TOOLS as tool (`${tool.id}:${tool.label}`)}
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

	{#if showContextControls}
		<div
			class="toolbar__context-panel"
			aria-label="Contextual tool controls"
			transition:fade={{ duration: 150 }}>
			{#if showColorControls}
				<div class="toolbar__colors" aria-label="Color controls">
					{#if getSelectedShapes(editorState).some(shapeSupportsFill)}
						<div class="toolbar__color-control">
							<span>Fill</span>
							<ColorPicker
								label="Fill color"
								value={fillColorValue}
								disabled={fillDisabled}
								align="end"
								onchange={handleFillChange} />
						</div>
					{/if}
					{#if getSelectedShapes(editorState).some(shapeSupportsStroke)}
						<div class="toolbar__color-control">
							<span>Stroke</span>
							<ColorPicker
								label="Stroke color"
								value={strokeColorValue}
								disabled={strokeDisabled}
								align="end"
								onchange={handleStrokeChange} />
						</div>
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
			{#if hasArrowSelection}
				<ArrowPopover {store} />
			{/if}
			{#if showAgentControl}
				<label class="toolbar__agent-control" title="Allow agents to edit the selection">
					<input
						type="checkbox"
						checked={agentEditableValue}
						onchange={handleAgentEditableChange}
						aria-label="Agent editable" />
					<span>Agents</span>
				</label>
			{/if}
		</div>
	{/if}

	{#if showContextControls}
		<button
			class="toolbar__layout-button"
			bind:this={layoutButtonEl}
			onpointerdown={(event) => event.stopPropagation()}
			onclick={toggleLayoutMenu}
			aria-label="Layout and selection commands"
			aria-haspopup="menu"
			aria-expanded={layoutMenuOpen}>
			Layout
		</button>
		<ContextMenu
			items={getLayoutMenuItems()}
			label="Layout and selection commands"
			open={layoutMenuOpen}
			returnFocus={layoutButtonEl}
			x={layoutMenuPoint.x}
			y={layoutMenuPoint.y}
			onOpenChange={(value) => (layoutMenuOpen = value)}
			onSelect={handleLayoutMenuAction} />
	{/if}

	<div class="toolbar__divider"></div>

	<button
		class="toolbar__import-button"
		bind:this={importButtonEl}
		disabled={interchangeBusy}
		onpointerdown={(event) => event.stopPropagation()}
		onclick={toggleImportMenu}
		aria-label="Import"
		aria-haspopup="menu"
		aria-expanded={importMenuOpen}>
		{interchangeBusy ? 'Working…' : 'Import'}
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

	<div class="toolbar__export">
		<button
			class="toolbar__export-button"
			bind:this={exportButtonEl}
			onclick={() => (exportMenuOpen = !exportMenuOpen)}
			aria-label="Export drawing"
			aria-haspopup="true"
			aria-expanded={exportMenuOpen}
			disabled={interchangeBusy}>
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
					aria-label="Export as Excalidraw editable document"
					onclick={() => exportEditable('excalidraw')}>
					Excalidraw
				</button>
				<button
					class="toolbar__menu-item"
					role="menuitem"
					aria-label="Export as Obsidian Canvas editable document"
					onclick={() => exportEditable('json-canvas')}>
					Obsidian Canvas
				</button>
				<div class="toolbar__menu-separator" role="separator"></div>
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
		flex-wrap: nowrap;
		gap: var(--ink-space-2);
		width: max-content;
		max-width: calc(100vw - 2.5rem);
		padding: 0.375rem;
		background: color-mix(in srgb, var(--ink-surface-raised) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--ink-border) 64%, transparent);
		border-radius: 0.75rem;
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
		width: 28px;
		min-height: 40px;
		border-radius: 0.4rem;
		cursor: grab;
		color: var(--ink-text-muted);
		opacity: 0.5;
		transition: opacity 0.2s;
		touch-action: none;
	}

	.toolbar__drag-handle:hover {
		opacity: 1;
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.toolbar__drag-handle:focus-visible {
		opacity: 1;
		outline: 2px solid var(--ink-focus);
		outline-offset: 1px;
	}

	.toolbar[data-dragging='true'] .toolbar__drag-handle {
		cursor: grabbing;
		opacity: 1;
		color: var(--ink-accent);
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
		color: var(--ink-text);
	}

	.toolbar__tagline {
		font-size: 0.75rem;
		color: var(--ink-text-muted);
		font-weight: 500;
		text-decoration: none;
	}

	.toolbar__tagline:hover {
		color: var(--ink-text);
		text-decoration: underline;
		text-underline-offset: 0.16em;
	}

	.toolbar__tagline:focus-visible {
		border-radius: 2px;
		outline: 2px solid var(--ink-accent);
		outline-offset: 2px;
	}

	.toolbar__agent-control {
		display: inline-flex;
		align-items: center;
		gap: var(--ink-space-1);
		min-height: 2rem;
		padding: 0 var(--ink-space-1);
		color: var(--ink-text-muted);
		font: 500 var(--ink-type-xs) / 1 var(--ink-font-body);
		white-space: nowrap;
		cursor: pointer;
	}

	.toolbar__agent-control:hover {
		color: var(--ink-text);
	}

	.toolbar__agent-control:focus-within {
		border-radius: var(--ink-radius-wobbly-small);
		outline: 2px solid var(--ink-accent);
		outline-offset: 1px;
	}

	.toolbar__agent-control input {
		width: 0.875rem;
		height: 0.875rem;
		margin: 0;
		accent-color: var(--ink-accent);
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
		color: var(--ink-text);
		cursor: pointer;
		transition-property: color, background-color, border-color, box-shadow, transform;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
		min-width: 58px;
		opacity: 0.8;
	}

	.toolbar__tool-slot {
		position: relative;
		display: flex;
		align-items: stretch;
	}

	.toolbar__pen-context {
		position: absolute;
		top: calc(100% + var(--ink-space-3, 0.75rem));
		right: 0;
		z-index: 20;
		padding: var(--ink-space-1);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-surface-raised) 94%, transparent);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 64%, transparent),
			0 10px 26px color-mix(in srgb, var(--ink-shadow-color) 24%, transparent),
			0 2px 6px color-mix(in srgb, var(--ink-shadow-color) 18%, transparent);
		backdrop-filter: blur(14px);
	}

	.toolbar__tool-button:hover {
		background: var(--ink-surface-hover);
		color: var(--ink-text);
		opacity: 1;
		border-color: var(--ink-text-muted);
	}

	.toolbar__tool-button:active,
	.toolbar__layout-button:active,
	.toolbar__import-button:active,
	.toolbar__export-button:active {
		transform: scale(0.96);
	}

	.toolbar__tool-button:focus-visible {
		outline: 3px solid var(--ink-focus);
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
		background-color: var(--ink-border);
		margin: 0 var(--ink-space-1);
		height: 32px;
		opacity: 0.5;
	}

	.toolbar__export {
		position: relative;
	}

	.toolbar__layout-button,
	.toolbar__import-button,
	.toolbar__export-button {
		border: 1px solid var(--ink-border);
		background: var(--ink-canvas);
		color: var(--ink-text);
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		min-width: 72px;
		transition-property: color, background-color, border-color, transform;
		transition-duration: 0.2s;
	}

	.toolbar__layout-button:hover,
	.toolbar__import-button:hover,
	.toolbar__export-button:hover {
		background: var(--ink-surface-hover);
		border-color: var(--ink-text-muted);
	}

	.toolbar__layout-button:focus-visible,
	.toolbar__import-button:focus-visible,
	.toolbar__export-button:focus-visible {
		outline: 2px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.toolbar__import-button:disabled,
	.toolbar__export-button:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	.toolbar__export-menu {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		background: var(--ink-surface-raised);
		color: var(--ink-text);
		border: 1px solid var(--ink-border);
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
		color: var(--ink-text);
		padding: 4px 8px;
		border-radius: 0.25rem;
		text-align: left;
		cursor: pointer;
		font-size: 13px;
	}

	.toolbar__menu-item:hover {
		background: var(--ink-surface-raised);
	}

	.toolbar__menu-item:focus-visible {
		outline: 2px solid var(--ink-focus);
		outline-offset: -2px;
	}

	.toolbar__menu-separator {
		height: 1px;
		margin: 0.25rem 0;
		background: var(--ink-border);
	}

	.toolbar__brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.toolbar__logo {
		width: 32px;
		height: 32px;
		color: var(--ink-text);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.toolbar__name {
		font-weight: 600;
		color: var(--ink-text);
	}

	.toolbar__tagline {
		font-size: 0.75rem;
		color: var(--ink-text-muted);
	}

	.toolbar__context-panel {
		position: absolute;
		top: calc(100% + var(--ink-space-2));
		left: 50%;
		display: flex;
		max-width: calc(100vw - 2rem);
		align-items: center;
		gap: var(--ink-space-3);
		padding: var(--ink-space-2) var(--ink-space-3);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-surface-raised) 94%, transparent);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 64%, transparent),
			0 10px 26px color-mix(in srgb, var(--ink-shadow-color) 24%, transparent),
			0 2px 6px color-mix(in srgb, var(--ink-shadow-color) 18%, transparent);
		translate: -50% 0;
		backdrop-filter: blur(14px);
	}

	.toolbar__colors {
		display: flex;
		align-items: center;
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
		.toolbar__brand,
		.toolbar__brand-divider,
		.toolbar__tool-label,
		.toolbar__tagline {
			display: none;
		}

		.toolbar__tool-button {
			min-width: 42px;
			min-height: 42px;
			padding: var(--ink-space-1);
			justify-content: center;
		}

		.toolbar__context-panel {
			left: 0;
			width: min(22rem, calc(100vw - 1rem));
			max-width: none;
			align-items: stretch;
			flex-direction: column;
			gap: var(--ink-space-2);
			padding: var(--ink-space-2);
			translate: 0 0;
		}

		.toolbar__colors {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: var(--ink-space-2);
		}

		.toolbar__color-control,
		.toolbar__opacity-control {
			display: grid;
			grid-template-columns: auto 1fr auto;
			align-items: center;
			gap: var(--ink-space-1);
			min-width: 0;
			text-align: left;
		}

		.toolbar__opacity-control input {
			min-width: 0;
			width: 100%;
		}

		.toolbar__opacity-control output {
			min-width: 2.4rem;
		}

		.toolbar__agent-control {
			min-height: 2rem;
			padding: 0;
		}

		.toolbar {
			gap: var(--ink-space-1);
		}

		.toolbar__layout-button,
		.toolbar__import-button,
		.toolbar__export-button {
			height: 42px;
			min-width: 60px;
			padding: 0 var(--ink-space-2);
		}
	}

	@media (max-width: 760px) and (pointer: coarse) {
		.toolbar {
			width: calc(100vw - 1.5rem);
			max-width: none;
			overflow-x: auto;
			overflow-y: hidden;
			overscroll-behavior-x: contain;
			scrollbar-width: none;
			touch-action: pan-x;
		}

		.toolbar::-webkit-scrollbar {
			display: none;
		}

		.toolbar__brand,
		.toolbar__divider {
			display: none;
		}

		.toolbar__context-panel,
		.toolbar__pen-context,
		.toolbar__export-menu {
			position: fixed;
			top: 4.75rem;
			left: 0.75rem;
			right: 0.75rem;
			width: auto;
			max-height: calc(100vh - 9rem);
			overflow: auto;
			translate: 0 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toolbar,
		.toolbar__tool-button,
		.toolbar__layout-button,
		.toolbar__import-button,
		.toolbar__export-button {
			transition: none;
		}
	}
</style>
