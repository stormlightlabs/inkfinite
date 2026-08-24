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
	import {
		canBooleanPathSelection,
		cardChildren,
		EditorState,
		getSelectedShapes,
		SnapshotCommand
	} from '@inkfinite/core';
	import {
		Button,
		ColorPicker,
		ContextMenu,
		Dialog,
		Icon,
		type ContextMenuEntry
	} from '../../index';
	import {
		executeSelectionCommand,
		SELECTION_COMMAND_LABELS,
		type SelectionCommand
	} from '../commands';
	import { DEFAULT_FILL_COLOR, DEFAULT_STROKE_COLOR } from '../constants';
	import { EDITOR_FONT_GROUPS } from '../fonts';
	import ArrowPopover from './ArrowPopover.svelte';
	import { sampleImageColors, type SampledImageColor } from '../image-sampling';

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
	let sampledColors = $state<SampledImageColor[]>([]);
	let samplingColors = $state(false);
	let sampledColorMessage = $state<string | null>(null);
	let metadataOpen = $state(false);
	let cardOpen = $state(false);
	let sectionsViewport: HTMLDivElement | undefined = $state();
	let canScrollSectionsBack = $state(false);
	let canScrollSectionsForward = $state(false);

	function updateSectionsScrollState() {
		if (!sectionsViewport) return;
		canScrollSectionsBack = sectionsViewport.scrollLeft > 1;
		canScrollSectionsForward =
			sectionsViewport.scrollLeft + sectionsViewport.clientWidth <
			sectionsViewport.scrollWidth - 1;
	}

	function shiftSections(direction: -1 | 1) {
		if (!sectionsViewport) return;
		const sections = Array.from(
			sectionsViewport.querySelectorAll<HTMLElement>(':scope > .selection-controls__section')
		);
		const current = sectionsViewport.scrollLeft;
		const target =
			direction > 0
				? sections.find((section) => section.offsetLeft > current + 1)
				: sections.filter((section) => section.offsetLeft < current - 1).at(-1);
		sectionsViewport.scrollTo({
			left: target?.offsetLeft ?? (direction > 0 ? sectionsViewport.scrollWidth : 0),
			behavior: 'smooth'
		});
	}

	$effect(() => {
		selectionCount;
		cardOpen;
		metadataOpen;
		queueMicrotask(updateSectionsScrollState);
	});

	$effect(() => {
		if (!sectionsViewport) return;
		const observer = new ResizeObserver(updateSectionsScrollState);
		observer.observe(sectionsViewport);
		for (const child of sectionsViewport.children) observer.observe(child);
		updateSectionsScrollState();
		return () => observer.disconnect();
	});

	$effect(() => {
		const unsubscribe = store.subscribe((state) => {
			editorState = state;
		});
		return () => unsubscribe();
	});

	let selectedShapes = $derived(getSelectedShapes(editorState));
	let selectionCount = $derived(selectedShapes.length);
	let showContextControls = $derived(currentTool !== 'pen' && selectionCount > 0);
	let semanticMetadata = $derived(selectedShapes.map(metadataForShape));
	let semanticTarget = $derived(selectionCount === 1 ? semanticMetadata[0] : undefined);
	let semanticNameState = $derived(
		getTextState(semanticMetadata.map((metadata) => metadata.name ?? ''))
	);
	let semanticRoleState = $derived(
		getTextState(semanticMetadata.map((metadata) => metadata.role ?? ''))
	);
	let semanticTagsState = $derived(
		getTextState(semanticMetadata.map((metadata) => metadata.tags.join(', ')))
	);
	let semanticDescriptionState = $derived(
		getTextState(semanticMetadata.map((metadata) => metadata.description ?? ''))
	);
	let semanticSourceState = $derived(
		getTextState(semanticMetadata.map((metadata) => metadata.source ?? ''))
	);
	let semanticLinkState = $derived(
		getTextState(semanticMetadata.map((metadata) => metadata.link ?? ''))
	);
	let semanticCustomMetadataState = $derived(
		getTextState(semanticMetadata.map((metadata) => JSON.stringify(metadata.customMetadata)))
	);
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
	let typographyTargets = $derived.by(() => {
		const targets = [...textTargets];
		for (const card of cardTargets) {
			for (const child of cardChildren(card, editorState.doc)) {
				if (child.type === 'text' || child.type === 'markdown') targets.push(child);
			}
		}
		return targets;
	});
	let imageTargets = $derived(
		selectedShapes.filter(
			(shape): shape is Extract<ShapeRecord, { type: 'image' }> => shape.type === 'image'
		)
	);
	let imageTarget = $derived(imageTargets.length === 1 ? imageTargets[0] : undefined);
	let imageAsset = $derived(
		imageTarget ? editorState.doc.assets?.[imageTarget.props.assetId] : undefined
	);
	let referenceTarget = $derived(
		selectionCount === 1 && selectedShapes[0]?.type === 'reference'
			? selectedShapes[0]
			: undefined
	);
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
	let booleanPathSelection = $derived(canBooleanPathSelection(editorState));

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
		getNumericState(typographyTargets.map((shape) => shape.props.fontSize))
	);
	let fontFamilyState = $derived(
		getTextState(typographyTargets.map((shape) => shape.props.fontFamily))
	);
	let agentEditableState = $derived(
		getBooleanState(selectedShapes.map((shape) => shape.agentEditable !== false))
	);

	$effect(() => {
		if (!agentInputEl) return;
		agentInputEl.checked = agentEditableState.value;
		agentInputEl.indeterminate = agentEditableState.mixed;
	});

	$effect(() => {
		imageTarget?.id;
		sampledColors = [];
		sampledColorMessage = null;
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

	function metadataForShape(shape: ShapeRecord): ShapeMetadata {
		return (
			shape.metadata ?? {
				name: null,
				title: null,
				role: null,
				description: null,
				body: null,
				tags: [],
				source: null,
				link: null,
				customMetadata: {},
				locked: shape.locked ?? false,
				agentEditable: shape.agentEditable !== false
			}
		);
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
		const state = store.getState();
		const targetIds = new Set(typographyTargets.map((shape) => shape.id));
		if (targetIds.size === 0) return;
		const before = EditorState.clone(state);
		const shapes = { ...state.doc.shapes };
		for (const shapeId of targetIds) {
			const shape = shapes[shapeId];
			if (shape?.type !== 'text' && shape?.type !== 'markdown') continue;
			shapes[shapeId] = {
				...shape,
				props: { ...shape.props, [field]: value }
			} as ShapeRecord;
		}
		store.executeCommand(
			new SnapshotCommand(
				field === 'fontSize' ? 'Set font size' : 'Set font family',
				'doc',
				before,
				{ ...state, doc: { ...state.doc, shapes } }
			)
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

	function updateSemanticFields(label: string, fields: Partial<ShapeMetadata>) {
		updateSelectedShapes(label, (shape) => {
			const currentMetadata = metadataForShape(shape);
			return {
				...shape,
				metadata: {
					...currentMetadata,
					...fields,
					...(fields.tags ? { tags: [...fields.tags] } : {}),
					...(fields.customMetadata
						? { customMetadata: { ...fields.customMetadata } }
						: {})
				}
			} as ShapeRecord;
		});
	}

	function handleSemanticTextChange(
		event: Event,
		field: 'name' | 'role' | 'description' | 'source' | 'link'
	) {
		const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
		updateSemanticFields(`Set ${field}`, { [field]: value || null });
	}

	function handleSemanticTagsChange(event: Event) {
		const tags = (event.currentTarget as HTMLInputElement).value
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
		updateSemanticFields('Set object tags', { tags });
	}

	function handleSemanticMetadataChange(event: Event) {
		try {
			const value = JSON.parse(
				(event.currentTarget as HTMLTextAreaElement).value
			) as unknown;
			if (!value || typeof value !== 'object' || Array.isArray(value)) return;
			updateSemanticFields('Set object metadata', {
				customMetadata: value as Record<string, unknown>
			});
		} catch {
			// Keep the previous value until the JSON is valid.
		}
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

	function updateImageFields(
		label: string,
		fields: Partial<Extract<ShapeRecord, { type: 'image' }>['props']>
	) {
		updateSelectedShapes(label, (shape) =>
			shape.type === 'image' ? { ...shape, props: { ...shape.props, ...fields } } : shape
		);
	}

	async function sampleSelectedImage() {
		if (!imageAsset || samplingColors) return;
		samplingColors = true;
		sampledColorMessage = null;
		try {
			sampledColors = await sampleImageColors(imageAsset.mediaType, imageAsset.bytes);
			if (sampledColors.length === 0) sampledColorMessage = 'No colors were found.';
		} catch (error) {
			sampledColorMessage =
				error instanceof Error ? error.message : 'The image could not be sampled.';
		} finally {
			samplingColors = false;
		}
	}

	async function copySampledColor(color: string) {
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			await navigator.clipboard.writeText(color);
			sampledColorMessage = `${color} copied`;
		}
	}

	function updateReferenceFields(
		fields: Partial<Extract<ShapeRecord, { type: 'reference' }>['props']>
	) {
		updateSelectedShapes('Update reference', (shape) =>
			shape.type === 'reference' ? { ...shape, props: { ...shape.props, ...fields } } : shape
		);
	}

	function handleCardTextChange(event: Event, field: 'title' | 'body') {
		updateCardFields(`Set card ${field}`, {
			[field]: (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value
		} as Partial<ShapeMetadata>);
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
			{
				id: 'arrange-grid',
				label: SELECTION_COMMAND_LABELS['arrange-grid'],
				icon: 'grid-dots',
				disabled: selectionCount < 2
			},
			{
				id: 'tidy',
				label: SELECTION_COMMAND_LABELS.tidy,
				icon: 'grid-dots',
				disabled: selectionCount < 2
			},
			{ type: 'separator' },
			{
				id: 'graph-flow-top-to-bottom',
				label: SELECTION_COMMAND_LABELS['graph-flow-top-to-bottom'],
				icon: 'arrow-down',
				disabled: selectionCount < 2
			},
			{
				id: 'graph-flow-left-to-right',
				label: SELECTION_COMMAND_LABELS['graph-flow-left-to-right'],
				icon: 'arrow-right',
				disabled: selectionCount < 2
			},
			{
				id: 'graph-tree-top-to-bottom',
				label: SELECTION_COMMAND_LABELS['graph-tree-top-to-bottom'],
				icon: 'arrow-down',
				disabled: selectionCount < 2
			},
			{
				id: 'graph-tree-left-to-right',
				label: SELECTION_COMMAND_LABELS['graph-tree-left-to-right'],
				icon: 'arrow-right',
				disabled: selectionCount < 2
			},
			{
				id: 'graph-radial',
				label: SELECTION_COMMAND_LABELS['graph-radial'],
				icon: 'select',
				disabled: selectionCount < 2
			},
			{ type: 'separator' },
			{
				id: 'stack-horizontal',
				label: SELECTION_COMMAND_LABELS['stack-horizontal'],
				icon: 'arrow-right',
				disabled: selectionCount < 2
			},
			{
				id: 'stack-vertical',
				label: SELECTION_COMMAND_LABELS['stack-vertical'],
				icon: 'arrow-down',
				disabled: selectionCount < 2
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

		<div
			bind:this={sectionsViewport}
			class="selection-controls__sections"
			onscroll={updateSectionsScrollState}>
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

			{#if selectionCount > 0}
				<section
					class="selection-controls__section selection-controls__section--metadata"
					aria-labelledby="selection-metadata-label">
					<h2 id="selection-metadata-label">Object metadata</h2>
					<div class="selection-controls__metadata-summary">
						<span
							class="selection-controls__metadata-name"
							title={semanticNameState.mixed
								? 'Mixed names'
								: semanticNameState.value || 'Unnamed object'}>
							{semanticNameState.mixed
								? 'Mixed names'
								: semanticNameState.value || 'Unnamed object'}
						</span>
						<Button size="small" onclick={() => (metadataOpen = true)}
							>Edit metadata</Button>
					</div>
				</section>
			{/if}

			{#if metadataOpen && selectionCount > 0}
				<Dialog
					bind:open={metadataOpen}
					title="Object metadata"
					class="object-metadata-dialog">
					<div class="selection-controls__metadata-drawer">
						<header class="selection-controls__metadata-header">
							<div>
								<span>Selected object</span>
								<h2>Object metadata</h2>
							</div>
							<Button size="small" onclick={() => (metadataOpen = false)}
								>Done</Button>
						</header>
						<div class="selection-controls__metadata-fields">
							<label class="selection-controls__field">
								<span>Name</span>
								<input
									type="text"
									value={semanticNameState.mixed ? '' : semanticNameState.value}
									placeholder={semanticNameState.mixed ? 'Mixed' : 'Object name'}
									onchange={(event) => handleSemanticTextChange(event, 'name')}
									aria-label="Object name" />
							</label>
							<label class="selection-controls__field">
								<span>Role</span>
								<input
									type="text"
									value={semanticRoleState.mixed ? '' : semanticRoleState.value}
									placeholder={semanticRoleState.mixed
										? 'Mixed'
										: 'Semantic role'}
									onchange={(event) => handleSemanticTextChange(event, 'role')}
									aria-label="Object role" />
							</label>
							<label
								class="selection-controls__field selection-controls__field--wide">
								<span>Tags</span>
								<input
									type="text"
									value={semanticTagsState.mixed ? '' : semanticTagsState.value}
									placeholder={semanticTagsState.mixed
										? 'Mixed'
										: 'Comma-separated tags'}
									onchange={handleSemanticTagsChange}
									aria-label="Object tags" />
							</label>
							<label
								class="selection-controls__field selection-controls__field--wide">
								<span>Description</span>
								<textarea
									value={semanticDescriptionState.mixed
										? ''
										: semanticDescriptionState.value}
									placeholder={semanticDescriptionState.mixed
										? 'Mixed'
										: 'Description'}
									onchange={(event) =>
										handleSemanticTextChange(event, 'description')}
									aria-label="Object description"></textarea>
							</label>
							<label class="selection-controls__field">
								<span>Source</span>
								<input
									type="text"
									value={semanticSourceState.mixed
										? ''
										: semanticSourceState.value}
									placeholder={semanticSourceState.mixed
										? 'Mixed'
										: 'Citation or file'}
									onchange={(event) => handleSemanticTextChange(event, 'source')}
									aria-label="Object source" />
							</label>
							<label class="selection-controls__field">
								<span>Link</span>
								<input
									type="url"
									value={semanticLinkState.mixed ? '' : semanticLinkState.value}
									placeholder={semanticLinkState.mixed ? 'Mixed' : 'https://'}
									onchange={(event) => handleSemanticTextChange(event, 'link')}
									aria-label="Object link" />
							</label>
							<label
								class="selection-controls__field selection-controls__field--wide">
								<span>Structured metadata</span>
								<textarea
									value={semanticCustomMetadataState.mixed
										? ''
										: semanticCustomMetadataState.value}
									placeholder={semanticCustomMetadataState.mixed
										? 'Mixed'
										: '{ }'}
									onchange={handleSemanticMetadataChange}
									aria-label="Object structured metadata"></textarea>
							</label>
						</div>
						{#if semanticTarget?.provenance}
							<dl
								class="selection-controls__provenance"
								aria-label="Object provenance">
								<div>
									<dt>Actor</dt>
									<dd>{semanticTarget.provenance.actorId}</dd>
								</div>
								<div>
									<dt>Origin</dt>
									<dd>{semanticTarget.provenance.origin}</dd>
								</div>
								<div>
									<dt>Recorded</dt>
									<dd>{semanticTarget.provenance.timestamp}</dd>
								</div>
								{#if semanticTarget.provenance.source}
									<div>
										<dt>Provenance source</dt>
										<dd>{semanticTarget.provenance.source}</dd>
									</div>
								{/if}
							</dl>
						{/if}
					</div>
				</Dialog>
			{/if}

			{#if imageTarget}
				<section
					class="selection-controls__section selection-controls__section--image"
					aria-labelledby="selection-image-label">
					<h2 id="selection-image-label">Image</h2>
					<div class="selection-controls__image-fields">
						<label class="selection-controls__field selection-controls__field--wide">
							<span>Asset</span>
							<select
								value={imageTarget.props.assetId}
								onchange={(event) =>
									updateImageFields('Reuse image asset', {
										assetId: (event.currentTarget as HTMLSelectElement).value
									})}
								aria-label="Image asset">
								{#each Object.values(editorState.doc.assets ?? {}).filter( (asset) => asset.mediaType.startsWith('image/') ) as asset}
									<option value={asset.id}>{asset.name}</option>
								{/each}
							</select>
						</label>
						<label class="selection-controls__field selection-controls__field--wide">
							<span>Caption</span>
							<input
								type="text"
								value={imageTarget.props.caption ?? ''}
								onchange={(event) =>
									updateImageFields('Set image caption', {
										caption:
											(event.currentTarget as HTMLInputElement).value ||
											undefined
									})}
								aria-label="Image caption" />
						</label>
						<label class="selection-controls__field">
							<span>Mask</span>
							<select
								value={imageTarget.props.mask?.kind ?? 'rectangle'}
								onchange={(event) => {
									const kind = (event.currentTarget as HTMLSelectElement)
										.value as 'rectangle' | 'ellipse' | 'rounded';
									updateImageFields('Set image mask', {
										mask: kind === 'rectangle' ? undefined : { kind }
									});
								}}
								aria-label="Image mask">
								<option value="rectangle">Rectangle</option>
								<option value="ellipse">Ellipse</option>
								<option value="rounded">Rounded</option>
							</select>
						</label>
						{#if imageTarget.props.mask?.kind === 'rounded'}
							<label
								class="selection-controls__field selection-controls__field--small">
								<span>Radius</span>
								<input
									type="number"
									min="0"
									max={Math.min(imageTarget.props.w, imageTarget.props.h) / 2}
									value={imageTarget.props.mask.radius ?? 16}
									onchange={(event) =>
										updateImageFields('Set image mask radius', {
											mask: {
												kind: 'rounded',
												radius: Math.max(
													0,
													(event.currentTarget as HTMLInputElement)
														.valueAsNumber || 0
												)
											}
										})}
									aria-label="Image mask radius" />
							</label>
						{/if}
					</div>
					<div class="selection-controls__image-sampling">
						<button
							class="selection-controls__action"
							type="button"
							disabled={samplingColors || !imageAsset}
							onclick={() => void sampleSelectedImage()}>
							<span>{samplingColors ? 'Sampling…' : 'Sample colors'}</span>
						</button>
						{#each sampledColors as sampled}
							<button
								class="selection-controls__sample"
								type="button"
								style={`--sample-color: ${sampled.color}`}
								title={`Copy ${sampled.color}`}
								aria-label={`Copy sampled color ${sampled.color}`}
								onclick={() => void copySampledColor(sampled.color)}></button>
						{/each}
						{#if sampledColorMessage}<small>{sampledColorMessage}</small>{/if}
					</div>
				</section>
			{/if}

			{#if referenceTarget}
				<section
					class="selection-controls__section"
					aria-labelledby="selection-reference-label">
					<h2 id="selection-reference-label">Reference</h2>
					<div class="selection-controls__card-fields">
						<label class="selection-controls__field">
							<span>Type</span>
							<select
								value={referenceTarget.props.referenceType}
								onchange={(event) =>
									updateReferenceFields({
										referenceType: (event.currentTarget as HTMLSelectElement)
											.value as 'url' | 'file' | 'page'
									})}
								aria-label="Reference type">
								<option value="url">URL</option>
								<option value="file">File</option>
								<option value="page">Page</option>
							</select>
						</label>
						{#if referenceTarget.props.referenceType === 'page'}
							<label
								class="selection-controls__field selection-controls__field--wide">
								<span>Target page</span>
								<select
									value={referenceTarget.props.value}
									onchange={(event) =>
										updateReferenceFields({
											value: (event.currentTarget as HTMLSelectElement).value
										})}
									aria-label="Reference target">
									{#each Object.values(editorState.doc.pages) as page}
										<option value={page.id}>{page.name}</option>
									{/each}
								</select>
							</label>
						{:else}
							<label
								class="selection-controls__field selection-controls__field--wide">
								<span>Target</span>
								<input
									type="text"
									value={referenceTarget.props.value}
									onchange={(event) =>
										updateReferenceFields({
											value: (event.currentTarget as HTMLInputElement).value
										})}
									aria-label="Reference target" />
							</label>
						{/if}
						<label class="selection-controls__field selection-controls__field--wide">
							<span>Label</span>
							<input
								type="text"
								value={referenceTarget.props.label ?? ''}
								onchange={(event) =>
									updateReferenceFields({
										label:
											(event.currentTarget as HTMLInputElement).value ||
											undefined
									})}
								aria-label="Reference label" />
						</label>
					</div>
				</section>
			{/if}

			{#if cardTarget && cardMetadata}
				<section
					class="selection-controls__section selection-controls__section--card"
					aria-labelledby="selection-card-label">
					<h2 id="selection-card-label">Card</h2>
					<div class="selection-controls__card-summary">
						<span title={cardMetadata.title ?? 'Untitled card'}
							>{cardMetadata.title ?? 'Untitled card'}</span>
						<Button size="small" onclick={() => (cardOpen = true)}>Edit card</Button>
					</div>
				</section>
			{/if}

			{#if cardOpen && cardTarget && cardMetadata}
				<Dialog bind:open={cardOpen} title="Card details" class="card-details-dialog">
					<div class="selection-controls__card-dialog">
						<header class="selection-controls__metadata-header">
							<div>
								<span>Selected object</span>
								<h2>Card details</h2>
							</div>
							<Button size="small" onclick={() => (cardOpen = false)}>Done</Button>
						</header>
						<div class="selection-controls__card-fields">
							<label
								class="selection-controls__field selection-controls__field--wide">
								<span>Title</span>
								<input
									type="text"
									value={cardMetadata.title ?? ''}
									onchange={(event) => handleCardTextChange(event, 'title')}
									aria-label="Card title" />
							</label>
							<label
								class="selection-controls__field selection-controls__field--wide">
								<span>Body</span>
								<textarea
									value={cardMetadata.body ?? ''}
									onchange={(event) => handleCardTextChange(event, 'body')}
									aria-label="Card body"></textarea>
							</label>
						</div>
					</div>
				</Dialog>
			{/if}

			{#if typographyTargets.length > 0}
				<section
					class="selection-controls__section"
					aria-labelledby="selection-type-label">
					<h2 id="selection-type-label">Typography</h2>
					<div class="selection-controls__controls selection-controls__typography">
						<label class="selection-controls__field">
							<span>Font</span>
							<select
								value={fontFamilyState.mixed ? '' : fontFamilyState.value}
								onchange={handleFontFamilyChange}
								aria-label="Font family">
								{#if fontFamilyState.mixed}
									<option value="" disabled>Mixed</option>
								{:else if !EDITOR_FONT_GROUPS.some( (group) => group.fonts.some((font) => font.family === fontFamilyState.value) )}
									<option value={fontFamilyState.value}
										>{fontFamilyState.value}</option>
								{/if}
								{#each EDITOR_FONT_GROUPS as group}
									<optgroup label={group.label}>
										{#each group.fonts as font}
											<option
												value={font.family}
												style:font-family={font.family}>
												{font.label}
											</option>
										{/each}
									</optgroup>
								{/each}
							</select>
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

			{#if booleanPathSelection}
				<section
					class="selection-controls__section"
					aria-labelledby="selection-boolean-label">
					<h2 id="selection-boolean-label">Boolean paths</h2>
					<div class="selection-controls__actions">
						<button
							class="selection-controls__action"
							type="button"
							onclick={() => executeSelectionCommand(store, 'boolean-union')}
							>Union</button>
						<button
							class="selection-controls__action"
							type="button"
							onclick={() => executeSelectionCommand(store, 'boolean-intersection')}
							>Intersect</button>
						<button
							class="selection-controls__action"
							type="button"
							onclick={() => executeSelectionCommand(store, 'boolean-difference')}
							>Subtract</button>
						<button
							class="selection-controls__action"
							type="button"
							onclick={() => executeSelectionCommand(store, 'boolean-exclusion')}
							>Exclude</button>
					</div>
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

		<div class="selection-controls__scroll-actions" aria-label="Browse contextual controls">
			<button
				aria-label="Show previous contextual controls"
				disabled={!canScrollSectionsBack}
				onclick={() => shiftSections(-1)}><Icon name="chevron-left" size={16} /></button>
			<button
				aria-label="Show more contextual controls"
				disabled={!canScrollSectionsForward}
				onclick={() => shiftSections(1)}><Icon name="chevron-right" size={16} /></button>
		</div>
	</div>

	<ContextMenu
		items={getLayoutMenuItems(layoutMenuMode)}
		compact={layoutMenuMode === 'arrange'}
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
		display: flex;
		align-items: center;
		gap: var(--ink-space-3);
		width: min(81rem, calc(100vw - 9rem));
		max-width: calc(100vw - 9rem);
		padding: var(--ink-space-2) var(--ink-space-3);
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
		flex: 0 0 auto;
		min-width: max-content;
		align-items: center;
	}

	.selection-controls__header strong {
		white-space: nowrap;
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
		flex: 1 1 auto;
		min-width: 0;
		align-items: stretch;
		flex-wrap: nowrap;
		gap: var(--ink-space-3);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.selection-controls__sections::-webkit-scrollbar {
		display: none;
	}

	.selection-controls__scroll-actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: var(--ink-space-1);
	}

	.selection-controls__scroll-actions button {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--ink-radius-control-small);
		background: transparent;
		color: var(--ink-text-muted);
		cursor: pointer;
	}

	.selection-controls__scroll-actions button:hover:not(:disabled) {
		background: var(--ink-surface-hover);
		color: var(--ink-text);
	}
	.selection-controls__scroll-actions button:focus-visible {
		outline: 2px solid var(--ink-accent);
		outline-offset: 1px;
	}
	.selection-controls__scroll-actions button:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.selection-controls__section {
		display: grid;
		flex: 0 0 auto;
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

	.selection-controls__section--image {
		min-width: 24rem;
	}

	.selection-controls__section--card {
		min-width: 15rem;
	}

	.selection-controls__card-summary {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
	}

	.selection-controls__card-summary span {
		max-width: 12rem;
		overflow: hidden;
		color: var(--ink-text);
		font: 650 var(--ink-type-sm) / 1.2 var(--ink-font-body);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selection-controls__card-dialog {
		width: min(34rem, 92vw);
		padding: var(--ink-space-5);
	}

	:global(.dialog__content.card-details-dialog) {
		border-radius: var(--ink-radius-panel);
	}

	.selection-controls__section--metadata {
		min-width: 15rem;
	}

	.selection-controls__metadata-summary {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
	}

	.selection-controls__metadata-name {
		min-width: 0;
		max-width: 12rem;
		overflow: hidden;
		color: var(--ink-text);
		font: 650 var(--ink-type-sm) / 1.2 var(--ink-font-body);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selection-controls__metadata-drawer {
		width: min(34rem, 92vw);
		padding: var(--ink-space-5);
	}

	.selection-controls__metadata-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-4);
		margin-bottom: var(--ink-space-4);
	}

	.selection-controls__metadata-header span {
		color: var(--ink-text-muted);
		font: 650 var(--ink-type-xs) / 1 var(--ink-font-body);
	}

	.selection-controls__metadata-header h2 {
		margin: var(--ink-space-1) 0 0;
		font-size: var(--ink-type-lg);
	}

	:global(.dialog__content.object-metadata-dialog) {
		border-radius: var(--ink-radius-panel);
	}

	.selection-controls__image-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(9rem, 1fr));
		gap: var(--ink-space-2);
	}

	.selection-controls__image-fields .selection-controls__field--wide {
		grid-column: 1 / -1;
	}

	.selection-controls__image-sampling {
		display: flex;
		min-height: var(--ink-control-height);
		align-items: center;
		gap: var(--ink-space-1);
		flex-wrap: wrap;
	}

	.selection-controls__image-sampling small {
		color: var(--ink-text-muted);
		font: 600 var(--ink-type-xs) / 1 var(--ink-font-body);
	}

	.selection-controls__sample {
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid var(--ink-canvas);
		border-radius: 50%;
		background: var(--sample-color);
		box-shadow: 0 0 0 1px var(--ink-border);
		cursor: pointer;
	}

	.selection-controls__sample:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.selection-controls__card-fields,
	.selection-controls__metadata-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(9rem, 1fr));
		gap: var(--ink-space-2);
	}

	.selection-controls__card-fields .selection-controls__field--wide,
	.selection-controls__metadata-fields .selection-controls__field--wide {
		grid-column: 1 / -1;
	}

	.selection-controls__card-fields .selection-controls__field input,
	.selection-controls__metadata-fields .selection-controls__field input,
	.selection-controls__metadata-fields .selection-controls__field textarea {
		width: 100%;
	}

	.selection-controls__provenance {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--ink-space-1) var(--ink-space-3);
		margin: 0;
		padding-top: var(--ink-space-2);
		border-top: 1px solid color-mix(in srgb, var(--ink-border) 48%, transparent);
		font: 600 var(--ink-type-xs) / 1.2 var(--ink-font-body);
	}

	.selection-controls__provenance div {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}

	.selection-controls__provenance dt {
		color: var(--ink-text-muted);
	}

	.selection-controls__provenance dd {
		margin: 0;
		overflow: hidden;
		color: var(--ink-text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selection-controls__field input,
	.selection-controls__field select {
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

	.selection-controls__field select {
		padding: 0 var(--ink-space-2);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 600 var(--ink-type-xs) / 1 var(--ink-font-body);
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
	.selection-controls__field select:focus-visible,
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
			flex-wrap: nowrap;
			overflow-x: auto;
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
