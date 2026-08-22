<script lang="ts">
	import type {
		ArrowShape,
		EditorState as EditorStateType,
		MarkdownShape,
		ShapeMetadata,
		ShapeRecord,
		Store,
		TextShape,
		ToolId
	} from '@inkfinite/core';
	import { EditorState, getSelectedShapes, SnapshotCommand } from '@inkfinite/core';
	import { ColorPicker, ContextMenu, Icon, type ContextMenuEntry } from '../../index';
	import {
		executeSelectionCommand,
		SELECTION_COMMAND_LABELS,
		type SelectionCommand
	} from '../commands';
	import { DEFAULT_FILL_COLOR, DEFAULT_STROKE_COLOR } from '../constants';
	import ArrowPopover from './ArrowPopover.svelte';

	type Props = {
		currentTool: ToolId;
		store: Store;
		orientation: 'vertical' | 'horizontal';
		/** Whether to expose the desktop-only agent editability control. */
		showAgentControl?: boolean;
		onEnterFrame?: (frameId: string) => void;
		onFitSelection?: () => void;
	};

	type LayoutMenuMode = 'align' | 'arrange';
	type TypographyField = 'fontSize' | 'fontFamily';

	let {
		currentTool,
		store,
		orientation,
		showAgentControl = false,
		onEnterFrame,
		onFitSelection
	}: Props = $props();

	let editorState = $derived<EditorStateType>(store.getState());
	let layoutMenuOpen = $state(false);
	let layoutMenuMode = $state<LayoutMenuMode>('arrange');
	let layoutMenuPoint = $state({ x: 0, y: 0 });
	let layoutMenuReturnFocus = $state<HTMLButtonElement | null>(null);
	let agentInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		const unsubscribe = store.subscribe((state) => {
			editorState = state;
		});
		return () => unsubscribe();
	});

	let selectedShapes = $derived(getSelectedShapes(editorState));
	let selectionCount = $derived(selectedShapes.length);
	let showContextControls = $derived(currentTool !== 'pen' && selectionCount > 0);
	let fillTargets = $derived(selectedShapes.filter(shapeSupportsFill));
	let strokeTargets = $derived(selectedShapes.filter(shapeSupportsStroke));
	let fillOpacityTargets = $derived(selectedShapes.filter(shapeSupportsFillOpacity));
	let strokeOpacityTargets = $derived(selectedShapes.filter(shapeSupportsStrokeOpacity));
	let textTargets = $derived(
		selectedShapes.filter(
			(shape): shape is TextShape | MarkdownShape =>
				shape.type === 'text' || shape.type === 'markdown'
		)
	);
	let cardTargets = $derived(
		selectedShapes.filter(
			(shape): shape is Extract<ShapeRecord, { type: 'container' }> =>
				shape.type === 'container' &&
				shape.metadata?.title !== null &&
				shape.metadata?.title !== undefined
		)
	);
	let cardTarget = $derived(cardTargets.length === 1 ? cardTargets[0] : undefined);
	let cardMetadata = $derived(cardTarget?.metadata);
	let frameTarget = $derived(
		selectionCount === 1 && selectedShapes[0]?.type === 'container'
			? selectedShapes[0]
			: undefined
	);
	let arrowTargets = $derived(
		selectedShapes.filter((shape): shape is ArrowShape => shape.type === 'arrow')
	);
	let hasGroupedSelection = $derived(
		selectedShapes.some((shape) => Boolean(shape.groupId) || shape.type === 'container')
	);
	let allSelectedLocked = $derived(
		selectionCount > 0 && selectedShapes.every((shape) => shape.locked)
	);

	let fillColorState = $derived.by(() => {
		const shared = getSharedValue(fillTargets.map(getFillColor));
		return {
			value: shared ?? DEFAULT_FILL_COLOR,
			mixed: fillTargets.length > 1 && shared === null
		};
	});
	let strokeColorState = $derived.by(() => {
		const shared = getSharedValue(strokeTargets.map(getStrokeColor));
		return {
			value: shared ?? DEFAULT_STROKE_COLOR,
			mixed: strokeTargets.length > 1 && shared === null
		};
	});
	let opacityState = $derived(
		getNumericState(selectedShapes.map((shape) => shape.opacity ?? 1))
	);
	let fillOpacityState = $derived(
		getNumericState(fillOpacityTargets.map((shape) => shape.fillOpacity ?? 1))
	);
	let strokeOpacityState = $derived(
		getNumericState(strokeOpacityTargets.map((shape) => shape.strokeOpacity ?? 1))
	);
	let fontSizeState = $derived(
		getNumericState(textTargets.map((shape) => shape.props.fontSize))
	);
	let fontFamilyState = $derived(
		getTextState(textTargets.map((shape) => shape.props.fontFamily))
	);
	let agentEditableState = $derived(
		getBooleanState(selectedShapes.map((shape) => shape.agentEditable !== false))
	);

	$effect(() => {
		if (!agentInputEl) return;
		agentInputEl.checked = agentEditableState.value;
		agentInputEl.indeterminate = agentEditableState.mixed;
	});

	function getSharedValue<T>(values: T[]): T | null {
		if (values.length === 0) return null;
		const first = values[0];
		return values.every((value) => Object.is(value, first)) ? first : null;
	}

	function getNumericState(values: number[]) {
		const shared = getSharedValue(values);
		return { value: shared ?? 1, mixed: values.length > 1 && shared === null };
	}

	function getTextState(values: string[]) {
		const shared = getSharedValue(values);
		return { value: shared ?? '', mixed: values.length > 1 && shared === null };
	}

	function getBooleanState(values: boolean[]) {
		const shared = getSharedValue(values);
		return { value: shared ?? true, mixed: values.length > 1 && shared === null };
	}

	function shapeSupportsFill(shape: ShapeRecord): boolean {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'text' ||
			shape.type === 'path' ||
			shape.type === 'markdown' ||
			shape.type === 'container'
		);
	}

	function shapeSupportsStroke(shape: ShapeRecord): boolean {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'line' ||
			shape.type === 'arrow' ||
			shape.type === 'stroke' ||
			shape.type === 'path' ||
			shape.type === 'markdown' ||
			shape.type === 'container'
		);
	}

	function shapeSupportsFillOpacity(shape: ShapeRecord): boolean {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'text' ||
			shape.type === 'markdown' ||
			shape.type === 'path' ||
			shape.type === 'image' ||
			shape.type === 'container'
		);
	}

	function shapeSupportsStrokeOpacity(shape: ShapeRecord): boolean {
		return (
			shape.type === 'rect' ||
			shape.type === 'ellipse' ||
			shape.type === 'line' ||
			shape.type === 'arrow' ||
			shape.type === 'stroke' ||
			shape.type === 'markdown' ||
			shape.type === 'path' ||
			shape.type === 'container'
		);
	}

	function getFillColor(shape: ShapeRecord): string | null {
		switch (shape.type) {
			case 'text':
				return shape.props.color;
			case 'rect':
			case 'ellipse':
			case 'path':
			case 'container':
				return shape.props.fill ?? null;
			case 'markdown':
				return shape.props.bg ?? null;
			default:
				return null;
		}
	}

	function getStrokeColor(shape: ShapeRecord): string | null {
		switch (shape.type) {
			case 'arrow':
				return shape.props.style.stroke;
			case 'stroke':
				return shape.props.style.color;
			case 'rect':
			case 'ellipse':
			case 'line':
			case 'path':
			case 'container':
				return shape.props.stroke ?? null;
			case 'markdown':
				return shape.props.border ?? null;
			default:
				return null;
		}
	}

	function updateSelectedShapes(label: string, update: (shape: ShapeRecord) => ShapeRecord) {
		const state = store.getState();
		if (state.ui.selectionIds.length === 0) return;
		const before = EditorState.clone(state);
		const shapes = { ...state.doc.shapes };
		let changed = false;
		for (const shapeId of state.ui.selectionIds) {
			const shape = state.doc.shapes[shapeId];
			if (!shape) continue;
			const updated = update(shape);
			if (updated !== shape) {
				shapes[shape.id] = updated;
				changed = true;
			}
		}
		if (!changed) return;
		store.executeCommand(
			new SnapshotCommand(label, 'doc', before, { ...state, doc: { ...state.doc, shapes } })
		);
	}

	function applyFillColor(color: string) {
		updateSelectedShapes('Set fill color', (shape) => {
			switch (shape.type) {
				case 'text':
					return { ...shape, props: { ...shape.props, color } } as ShapeRecord;
				case 'rect':
				case 'ellipse':
				case 'path':
				case 'container':
					return { ...shape, props: { ...shape.props, fill: color } } as ShapeRecord;
				case 'markdown':
					return { ...shape, props: { ...shape.props, bg: color } } as ShapeRecord;
				default:
					return shape;
			}
		});
	}

	function applyStrokeColor(color: string) {
		updateSelectedShapes('Set stroke color', (shape) => {
			switch (shape.type) {
				case 'arrow':
					return {
						...shape,
						props: { ...shape.props, style: { ...shape.props.style, stroke: color } }
					} as ShapeRecord;
				case 'stroke':
					return {
						...shape,
						props: { ...shape.props, style: { ...shape.props.style, color } }
					} as ShapeRecord;
				case 'rect':
				case 'ellipse':
				case 'line':
				case 'path':
				case 'container':
					return { ...shape, props: { ...shape.props, stroke: color } } as ShapeRecord;
				case 'markdown':
					return { ...shape, props: { ...shape.props, border: color } } as ShapeRecord;
				default:
					return shape;
			}
		});
	}

	function applyNumericField(
		field: 'opacity' | 'fillOpacity' | 'strokeOpacity',
		value: number,
		label: string
	) {
		const next = Math.min(1, Math.max(0, value));
		updateSelectedShapes(label, (shape) => ({ ...shape, [field]: next }));
	}

	function handleOpacityChange(
		event: Event,
		field: 'opacity' | 'fillOpacity' | 'strokeOpacity'
	) {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		if (!Number.isFinite(value)) return;
		applyNumericField(field, value, field === 'opacity' ? 'Set opacity' : `Set ${field}`);
	}

	function applyTypography(field: TypographyField, value: number | string) {
		updateSelectedShapes(
			field === 'fontSize' ? 'Set font size' : 'Set font family',
			(shape) => {
				if (shape.type !== 'text' && shape.type !== 'markdown') return shape;
				return { ...shape, props: { ...shape.props, [field]: value } } as ShapeRecord;
			}
		);
	}

	function handleFontSizeChange(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		if (Number.isFinite(value) && value > 0) applyTypography('fontSize', value);
	}

	function handleFontFamilyChange(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value.trim();
		if (value) applyTypography('fontFamily', value);
	}

	function updateCardFields(label: string, fields: Partial<ShapeMetadata>) {
		if (!cardTarget) return;
		const state = store.getState();
		const before = EditorState.clone(state);
		const currentMetadata = cardTarget.metadata;
		if (!currentMetadata) return;
		const nextMetadata: ShapeMetadata = {
			...currentMetadata,
			...fields,
			...(fields.title !== undefined
				? { name: fields.title || null, title: fields.title }
				: {}),
			...(fields.body !== undefined
				? { description: fields.body || null, body: fields.body }
				: {})
		};
		const shapes = {
			...state.doc.shapes,
			[cardTarget.id]: { ...cardTarget, metadata: nextMetadata } as ShapeRecord
		};
		for (const shape of Object.values(state.doc.shapes)) {
			if (shape.groupId !== cardTarget.id) continue;
			if (fields.title !== undefined && shape.type === 'text') {
				shapes[shape.id] = {
					...shape,
					props: { ...shape.props, text: fields.title ?? '' }
				};
			}
			if (fields.body !== undefined && shape.type === 'markdown') {
				shapes[shape.id] = { ...shape, props: { ...shape.props, md: fields.body ?? '' } };
			}
		}
		store.executeCommand(
			new SnapshotCommand(label, 'doc', before, { ...state, doc: { ...state.doc, shapes } })
		);
	}

	function handleCardTextChange(
		event: Event,
		field: 'title' | 'body' | 'role' | 'source' | 'link'
	) {
		updateCardFields(`Set card ${field}`, {
			[field]: (event.currentTarget as HTMLInputElement).value
		} as Partial<ShapeMetadata>);
	}

	function handleCardTagsChange(event: Event) {
		const tags = (event.currentTarget as HTMLInputElement).value
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
		updateCardFields('Set card tags', { tags });
	}

	function handleCardMetadataChange(event: Event) {
		try {
			const value = JSON.parse((event.currentTarget as HTMLInputElement).value) as unknown;
			if (!value || typeof value !== 'object' || Array.isArray(value)) return;
			updateCardFields('Set card metadata', {
				customMetadata: value as Record<string, unknown>
			});
		} catch {
			// Keep the previous value until the JSON is valid.
		}
	}

	function handleAgentEditableChange(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).checked;
		updateSelectedShapes(value ? 'Allow Agent Edits' : 'Prevent Agent Edits', (shape) => ({
			...shape,
			agentEditable: value
		}));
	}

	function toggleLayoutMenu(mode: LayoutMenuMode, button: HTMLButtonElement) {
		if (layoutMenuOpen && layoutMenuMode === mode) {
			layoutMenuOpen = false;
			return;
		}
		const bounds = button.getBoundingClientRect();
		layoutMenuMode = mode;
		layoutMenuReturnFocus = button;
		layoutMenuPoint = { x: bounds.left, y: bounds.bottom + 8 };
		layoutMenuOpen = true;
	}

	function getLayoutMenuItems(mode: LayoutMenuMode): ContextMenuEntry[] {
		if (mode === 'align') {
			return (
				[
					'align-left',
					'align-center',
					'align-right',
					'align-top',
					'align-middle',
					'align-bottom'
				] as SelectionCommand[]
			).map((id) => ({ id, label: SELECTION_COMMAND_LABELS[id], icon: 'select' as const }));
		}

		return [
			{
				id: 'distribute-horizontal',
				label: SELECTION_COMMAND_LABELS['distribute-horizontal'],
				icon: 'arrow-right',
				disabled: selectionCount < 3
			},
			{
				id: 'distribute-vertical',
				label: SELECTION_COMMAND_LABELS['distribute-vertical'],
				icon: 'arrow-down',
				disabled: selectionCount < 3
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
				id: 'convert-to-rect',
				label: SELECTION_COMMAND_LABELS['convert-to-rect'],
				icon: 'rectangle',
				disabled: selectionCount === 0
			},
			{
				id: 'convert-to-ellipse',
				label: SELECTION_COMMAND_LABELS['convert-to-ellipse'],
				icon: 'ellipse',
				disabled: selectionCount === 0
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
			}
		];
	}

	function handleLayoutMenuAction(id: string) {
		if (id in SELECTION_COMMAND_LABELS) {
			executeSelectionCommand(store, id as SelectionCommand);
		}
	}
</script>

{#if showContextControls}
	<div
		class="selection-controls"
		class:selection-controls--horizontal={orientation === 'horizontal'}
		role="toolbar"
		aria-label="Selection controls"
		data-agent-occlusion>
		<header class="selection-controls__header">
			<strong
				>{selectionCount}
				{selectionCount === 1 ? 'object' : 'objects'} selected</strong>
		</header>

		<div class="selection-controls__sections">
			{#if fillTargets.length > 0 || strokeTargets.length > 0 || fillOpacityTargets.length > 0 || strokeOpacityTargets.length > 0}
				<section
					class="selection-controls__section"
					aria-labelledby="selection-appearance-label">
					<h2 id="selection-appearance-label">Appearance</h2>
					<div class="selection-controls__controls">
						{#if fillTargets.length > 0}
							<div class="selection-controls__color-control">
								<span>Fill</span>
								<ColorPicker
									label="Fill color"
									value={fillColorState.value}
									mixed={fillColorState.mixed}
									allowNone
									onchange={applyFillColor}
									align="end" />
							</div>
						{/if}
						{#if strokeTargets.length > 0}
							<div class="selection-controls__color-control">
								<span>Stroke</span>
								<ColorPicker
									label="Stroke color"
									value={strokeColorState.value}
									mixed={strokeColorState.mixed}
									allowNone
									onchange={applyStrokeColor}
									align="end" />
							</div>
						{/if}
						{#if fillOpacityTargets.length > 0}
							<label class="selection-controls__range-control">
								<span>Fill opacity</span>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={fillOpacityState.value}
									onchange={(event) => handleOpacityChange(event, 'fillOpacity')}
									aria-label="Fill opacity"
									aria-valuetext={fillOpacityState.mixed
										? 'Mixed values'
										: `${Math.round(fillOpacityState.value * 100)}%`} />
								<output
									>{fillOpacityState.mixed
										? 'Mixed'
										: `${Math.round(fillOpacityState.value * 100)}%`}</output>
							</label>
						{/if}
						{#if strokeOpacityTargets.length > 0}
							<label class="selection-controls__range-control">
								<span>Stroke opacity</span>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={strokeOpacityState.value}
									onchange={(event) =>
										handleOpacityChange(event, 'strokeOpacity')}
									aria-label="Stroke opacity"
									aria-valuetext={strokeOpacityState.mixed
										? 'Mixed values'
										: `${Math.round(strokeOpacityState.value * 100)}%`} />
								<output
									>{strokeOpacityState.mixed
										? 'Mixed'
										: `${Math.round(strokeOpacityState.value * 100)}%`}</output>
							</label>
						{/if}
						{#if selectionCount > 0}
							<label class="selection-controls__range-control">
								<span>Opacity</span>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={opacityState.value}
									onchange={(event) => handleOpacityChange(event, 'opacity')}
									aria-label="Opacity"
									aria-valuetext={opacityState.mixed
										? 'Mixed values'
										: `${Math.round(opacityState.value * 100)}%`} />
								<output
									>{opacityState.mixed
										? 'Mixed'
										: `${Math.round(opacityState.value * 100)}%`}</output>
							</label>
						{/if}
					</div>
				</section>
			{/if}

			{#if cardTarget && cardMetadata}
				<section
					class="selection-controls__section selection-controls__section--card"
					aria-labelledby="selection-card-label">
					<h2 id="selection-card-label">Card</h2>
					<div class="selection-controls__card-fields">
						<label class="selection-controls__field">
							<span>Title</span>
							<input
								type="text"
								value={cardMetadata.title ?? ''}
								onchange={(event) => handleCardTextChange(event, 'title')}
								aria-label="Card title" />
						</label>
						<label class="selection-controls__field">
							<span>Role</span>
							<input
								type="text"
								value={cardMetadata.role ?? ''}
								onchange={(event) => handleCardTextChange(event, 'role')}
								aria-label="Card role" />
						</label>
						<label class="selection-controls__field">
							<span>Tags</span>
							<input
								type="text"
								value={cardMetadata.tags.join(', ')}
								onchange={handleCardTagsChange}
								aria-label="Card tags" />
						</label>
						<label class="selection-controls__field">
							<span>Source</span>
							<input
								type="text"
								value={cardMetadata.source ?? ''}
								onchange={(event) => handleCardTextChange(event, 'source')}
								aria-label="Card source" />
						</label>
						<label class="selection-controls__field">
							<span>Link</span>
							<input
								type="url"
								value={cardMetadata.link ?? ''}
								onchange={(event) => handleCardTextChange(event, 'link')}
								aria-label="Card link" />
						</label>
						<label class="selection-controls__field selection-controls__field--wide">
							<span>Body</span>
							<textarea
								value={cardMetadata.body ?? ''}
								onchange={(event) => handleCardTextChange(event, 'body')}
								aria-label="Card body"></textarea>
						</label>
						<label class="selection-controls__field selection-controls__field--wide">
							<span>Metadata</span>
							<input
								type="text"
								value={JSON.stringify(cardMetadata.customMetadata)}
								onchange={handleCardMetadataChange}
								aria-label="Card custom metadata" />
						</label>
					</div>
				</section>
			{/if}

			{#if textTargets.length > 0}
				<section
					class="selection-controls__section"
					aria-labelledby="selection-type-label">
					<h2 id="selection-type-label">Typography</h2>
					<div class="selection-controls__controls selection-controls__typography">
						<label class="selection-controls__field">
							<span>Font</span>
							<input
								type="text"
								value={fontFamilyState.mixed ? '' : fontFamilyState.value}
								placeholder={fontFamilyState.mixed ? 'Mixed' : 'Font family'}
								onchange={handleFontFamilyChange}
								aria-label="Font family" />
						</label>
						<label class="selection-controls__field selection-controls__field--small">
							<span>Size</span>
							<input
								type="number"
								min="1"
								step="1"
								value={fontSizeState.mixed ? '' : fontSizeState.value}
								placeholder={fontSizeState.mixed ? 'Mixed' : undefined}
								onchange={handleFontSizeChange}
								aria-label="Font size" />
						</label>
					</div>
				</section>
			{/if}

			{#if frameTarget}
				<section
					class="selection-controls__section"
					aria-labelledby="selection-frame-label">
					<h2 id="selection-frame-label">Frame</h2>
					<div class="selection-controls__actions">
						<button
							class="selection-controls__action"
							type="button"
							onclick={() => onEnterFrame?.(frameTarget.id)}
							aria-label="Enter selected frame">
							<Icon name="layers" size={15} />
							<span>Enter</span>
						</button>
						<button
							class="selection-controls__action"
							type="button"
							onclick={() => onFitSelection?.()}
							aria-label="Fit selected frame">
							<Icon name="expand" size={15} />
							<span>Fit</span>
						</button>
					</div>
				</section>
			{/if}

			{#if arrowTargets.length > 0}
				<section
					class="selection-controls__section selection-controls__section--arrow"
					aria-labelledby="selection-arrow-label">
					<h2 id="selection-arrow-label">Arrow</h2>
					<ArrowPopover {store} />
				</section>
			{/if}

			{#if selectionCount >= 2}
				<section
					class="selection-controls__section"
					aria-labelledby="selection-layout-label">
					<h2 id="selection-layout-label">Arrange selection</h2>
					<div class="selection-controls__actions">
						<button
							class="selection-controls__action"
							type="button"
							onclick={(event) =>
								toggleLayoutMenu(
									'align',
									event.currentTarget as HTMLButtonElement
								)}
							aria-haspopup="menu"
							aria-expanded={layoutMenuOpen && layoutMenuMode === 'align'}>
							<Icon name="select" size={15} />
							<span>Align</span>
						</button>
						<button
							class="selection-controls__action"
							type="button"
							onclick={(event) =>
								toggleLayoutMenu(
									'arrange',
									event.currentTarget as HTMLButtonElement
								)}
							aria-haspopup="menu"
							aria-expanded={layoutMenuOpen && layoutMenuMode === 'arrange'}>
							<Icon name="settings" size={15} />
							<span>Arrange</span>
						</button>
					</div>
				</section>
			{/if}

			<section
				class="selection-controls__section selection-controls__section--actions"
				aria-labelledby="selection-actions-label">
				<h2 id="selection-actions-label">Selection</h2>
				<div class="selection-controls__actions">
					{#if selectionCount >= 2}
						<button
							class="selection-controls__action"
							type="button"
							onclick={() => executeSelectionCommand(store, 'group')}
							aria-label="Group selected objects">
							<Icon name="layers" size={15} />
							<span>Group</span>
						</button>
					{/if}
					<button
						class="selection-controls__action"
						type="button"
						onclick={() =>
							executeSelectionCommand(store, allSelectedLocked ? 'unlock' : 'lock')}
						aria-label={allSelectedLocked
							? 'Unlock selected objects'
							: 'Lock selected objects'}>
						<Icon name={allSelectedLocked ? 'lock-open' : 'lock'} size={15} />
						<span>{allSelectedLocked ? 'Unlock' : 'Lock'}</span>
					</button>
					{#if showAgentControl}
						<label
							class="selection-controls__agent-control"
							title="Allow agents to edit the selection">
							<input
								bind:this={agentInputEl}
								type="checkbox"
								checked={agentEditableState.value}
								onchange={handleAgentEditableChange}
								aria-label="Agent editable" />
							<span>Agents</span>
						</label>
					{/if}
				</div>
			</section>
		</div>
	</div>

	<ContextMenu
		items={getLayoutMenuItems(layoutMenuMode)}
		label={layoutMenuMode === 'align' ? 'Alignment commands' : 'Arrange commands'}
		open={layoutMenuOpen}
		returnFocus={layoutMenuReturnFocus}
		x={layoutMenuPoint.x}
		y={layoutMenuPoint.y}
		onOpenChange={(value) => (layoutMenuOpen = value)}
		onSelect={handleLayoutMenuAction} />
{/if}

<style>
	.selection-controls {
		position: fixed;
		top: 5.25rem;
		left: 50%;
		z-index: 95;
		display: grid;
		width: fit-content;
		max-width: calc(100vw - 2rem);
		border: 1px solid color-mix(in srgb, var(--ink-border) 68%, transparent);
		border-radius: var(--ink-radius-panel-small);
		color: var(--ink-text);
		background: color-mix(in srgb, var(--ink-surface-raised) 97%, transparent);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 18%, transparent),
			var(--ink-shadow-panel);
		translate: -50% 0;
		backdrop-filter: blur(14px);
	}

	.selection-controls--horizontal {
		top: 11rem;
	}

	.selection-controls__header {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-3);
		padding: var(--ink-space-2) var(--ink-space-3);
		border-bottom: 1px solid color-mix(in srgb, var(--ink-border) 58%, transparent);
	}

	.selection-controls__section h2 {
		color: var(--ink-text-muted);
		font: 700 var(--ink-type-xs) / 1.1 var(--ink-font-body);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.selection-controls__header strong {
		color: var(--ink-heading);
		font: 650 var(--ink-type-sm) / 1.2 var(--ink-font-body);
	}

	.selection-controls__sections {
		display: flex;
		min-width: 0;
		align-items: stretch;
		gap: var(--ink-space-3);
		padding: var(--ink-space-2) var(--ink-space-3);
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.selection-controls__section {
		display: grid;
		min-width: max-content;
		align-content: start;
		gap: var(--ink-space-2);
		padding-inline-end: var(--ink-space-3);
		border-inline-end: 1px solid color-mix(in srgb, var(--ink-border) 48%, transparent);
	}

	.selection-controls__section:last-child {
		padding-inline-end: 0;
		border-inline-end: 0;
	}

	.selection-controls__section h2 {
		margin: 0;
	}

	.selection-controls__controls,
	.selection-controls__actions {
		display: flex;
		min-height: 2.5rem;
		align-items: center;
		gap: var(--ink-space-2);
	}

	.selection-controls__color-control,
	.selection-controls__range-control,
	.selection-controls__field {
		display: inline-flex;
		align-items: center;
		gap: var(--ink-space-2);
		color: var(--ink-text-muted);
		font: 650 var(--ink-type-xs) / 1 var(--ink-font-body);
		white-space: nowrap;
	}

	.selection-controls__range-control {
		display: grid;
		grid-template-columns: auto 5.5rem 3.25rem;
	}

	.selection-controls__range-control input {
		width: 100%;
		accent-color: var(--ink-accent);
	}

	.selection-controls__range-control output {
		color: var(--ink-text);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.selection-controls__section--card {
		min-width: 24rem;
	}

	.selection-controls__card-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(9rem, 1fr));
		gap: var(--ink-space-2);
	}

	.selection-controls__card-fields .selection-controls__field--wide {
		grid-column: 1 / -1;
	}

	.selection-controls__card-fields .selection-controls__field input {
		width: 100%;
	}

	.selection-controls__field input {
		box-sizing: border-box;
		width: 9rem;
		height: var(--ink-control-height);
		padding: 0 var(--ink-space-2);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 600 var(--ink-type-xs) / 1 var(--ink-font-body);
	}

	.selection-controls__field--small input {
		width: 4.5rem;
	}

	.selection-controls__field input::placeholder {
		color: var(--ink-text-muted);
	}

	.selection-controls__field textarea {
		box-sizing: border-box;
		width: 14rem;
		min-height: 4rem;
		padding: var(--ink-space-2);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 600 var(--ink-type-xs) / 1.3 var(--ink-font-body);
		resize: vertical;
	}

	.selection-controls__field--wide {
		align-items: flex-start;
	}

	.selection-controls__field input:focus-visible,
	.selection-controls__field textarea:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.selection-controls__action,
	.selection-controls__agent-control {
		display: inline-flex;
		min-height: var(--ink-control-height);
		align-items: center;
		justify-content: center;
		gap: var(--ink-space-1);
		padding: 0 var(--ink-space-2);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 650 var(--ink-type-xs) / 1 var(--ink-font-body);
		white-space: nowrap;
		cursor: pointer;
		transition-property: color, background-color, border-color, transform;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.selection-controls__action:hover,
	.selection-controls__agent-control:hover {
		border-color: var(--ink-accent);
		background: var(--ink-surface-hover);
	}

	.selection-controls__action:active {
		transform: scale(0.96);
	}

	.selection-controls__action:focus-visible,
	.selection-controls__agent-control:focus-within {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.selection-controls__agent-control {
		padding-inline: var(--ink-space-2);
		color: var(--ink-text-muted);
	}

	.selection-controls__agent-control input {
		width: 0.875rem;
		height: 0.875rem;
		margin: 0;
		accent-color: var(--ink-accent);
	}

	.selection-controls__section--arrow :global(.arrow-popover) {
		display: flex;
	}

	@media (min-width: 1181px) {
		.selection-controls {
			left: auto;
			right: var(--ink-space-3);
			translate: 0 0;
		}
	}

	@media (max-width: 1180px) {
		.selection-controls {
			width: fit-content;
			max-width: calc(100vw - 12rem);
		}

		.selection-controls__sections {
			flex-wrap: wrap;
			overflow-x: visible;
		}

		.selection-controls__section {
			padding-block: var(--ink-space-1);
		}
	}

	@media (max-width: 760px) {
		.selection-controls,
		.selection-controls--horizontal {
			top: 11rem;
			left: 0.75rem;
			right: 0.75rem;
			width: auto;
			max-width: none;
			max-height: calc(100vh - 11rem);
			translate: 0 0;
		}

		.selection-controls__sections {
			align-items: stretch;
			flex-wrap: nowrap;
			overflow-x: auto;
			overflow-y: hidden;
			scrollbar-width: thin;
		}

		.selection-controls__section {
			min-width: max-content;
			padding-block: var(--ink-space-2);
			border-inline-end: 1px solid color-mix(in srgb, var(--ink-border) 48%, transparent);
		}

		.selection-controls__section:last-child {
			border-inline-end: 0;
		}

		.selection-controls__controls,
		.selection-controls__actions {
			flex-wrap: nowrap;
		}

		.selection-controls__range-control {
			grid-template-columns: auto 5.5rem 3.25rem;
			width: auto;
		}

		.selection-controls__typography {
			align-items: center;
			flex-direction: row;
		}

		.selection-controls__field input {
			width: auto;
		}

		.selection-controls__section--card {
			min-width: max-content;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.selection-controls__action,
		.selection-controls__agent-control {
			transition: none;
		}
	}
</style>
