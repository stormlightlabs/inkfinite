<script lang="ts">
	import {
		Action,
		Camera,
		exportToSVG,
		getSelectedShapes,
		hitTestPoint,
		selectionTarget,
		stencils
	} from '@inkfinite/core';
	import { Button, ContextMenu, Dialog, type ContextMenuEntry } from '../../index';
	import {
		copySelection,
		pasteClipboard,
		pasteImage,
		pasteText,
		readClipboardContent
	} from '../clipboard';
	import type { SelectionCommand } from '../commands';
	import {
		executeSelectionCommand,
		getCommandPaletteEntries,
		SELECTION_COMMAND_LABELS
	} from '../commands';
	import HistoryViewer from '../components/HistoryViewer.svelte';
	import KeyboardShortcuts from '../components/KeyboardShortcuts.svelte';
	import CommandPalette from '../components/CommandPalette.svelte';
	import LayerPanel from '../components/LayerPanel.svelte';
	import ProposalGhostLayer from '../components/ProposalGhostLayer.svelte';
	import ProposalReview from '../components/ProposalReview.svelte';
	import StatusBar from '../components/StatusBar.svelte';
	import StencilPalette from '../components/StencilPalette.svelte';
	import Toolbar from '../components/Toolbar.svelte';
	import { draggingStencil, endDrag } from '../dnd.svelte';
	import FileBrowser from '../filebrowser/FileBrowser.svelte';
	import type { EditorPlatformAdapter } from '../platform';
	import { createCanvasController } from './canvas-store.svelte';
	import NavigationControls from './NavigationControls.svelte';

	let { platform: platformAdapter }: { platform: EditorPlatformAdapter } = $props();

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let replaceImageInput = $state<HTMLInputElement | null>(null);
	let textEditorEl = $state<HTMLTextAreaElement | null>(null);
	let arrowLabelEditorEl = $state<HTMLInputElement | null>(null);
	let markdownEditorEl = $state<HTMLTextAreaElement | null>(null);
	let historyViewerOpen = $state(false);
	let shortcutsOpen = $state(false);
	let commandPaletteOpen = $state(false);
	let contextMenuOpen = $state(false);
	let contextMenuPoint = $state({ x: 0, y: 0 });
	let contextMenuItems = $state<ContextMenuEntry[]>([]);
	let svgDragActive = $state(false);
	let svgMarkupDialogOpen = $state(false);
	let svgMarkup = $state('');
	let svgMarkupError = $state<string | null>(null);
	let svgMarkupSubmitting = $state(false);
	let editorError = $state<string | null>(null);
	let editorErrorTitle = $state('Editor error');

	function reportEditorError(error: unknown, title = 'Editor error') {
		editorErrorTitle = title;
		editorError = error instanceof Error ? error.message : String(error);
	}

	async function copyCurrentSelection() {
		try {
			await copySelection(c.store.getState());
		} catch (error) {
			reportEditorError(error, 'Clipboard error');
		}
	}

	async function cutCurrentSelection() {
		try {
			await copySelection(c.store.getState());
			c.handleAction(
				Action.keyDown('Delete', 'Delete', {
					ctrl: false,
					shift: false,
					alt: false,
					meta: false
				})
			);
		} catch (error) {
			reportEditorError(error, 'Clipboard error');
		}
	}

	async function pasteFromClipboard(options: { inPlace?: boolean; atCursor?: boolean } = {}) {
		try {
			const content = await readClipboardContent();
			if (!content)
				throw new Error('The clipboard is empty or contains unsupported content.');
			const position = options.atCursor ? c.cursorStore.getState().cursorWorld : undefined;
			if (content.type === 'native') {
				c.commitLayerState(
					options.inPlace ? 'Paste in place' : 'Paste',
					pasteClipboard(c.store.getState(), content.payload, {
						inPlace: options.inPlace,
						position: options.inPlace ? undefined : position
					})
				);
			} else if (content.type === 'text') {
				c.commitLayerState(
					'Paste text',
					pasteText(c.store.getState(), content.text, content.markdown, position)
				);
			} else if (content.type === 'image') {
				c.commitLayerState(
					'Paste image',
					await pasteImage(c.store.getState(), content, position)
				);
			} else {
				await c.importSvgMarkup(content.contents);
			}
		} catch (error) {
			reportEditorError(error, 'Clipboard error');
		}
	}

	async function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		try {
			const content = await readClipboardContent(event.clipboardData ?? undefined);
			if (!content)
				throw new Error('The clipboard is empty or contains unsupported content.');
			const position = c.cursorStore.getState().cursorWorld;
			if (content.type === 'native') {
				c.commitLayerState(
					'Paste',
					pasteClipboard(c.store.getState(), content.payload, { position })
				);
			} else if (content.type === 'text') {
				c.commitLayerState(
					'Paste text',
					pasteText(c.store.getState(), content.text, content.markdown, position)
				);
			} else if (content.type === 'image') {
				c.commitLayerState(
					'Paste image',
					await pasteImage(c.store.getState(), content, position)
				);
			} else {
				await c.importSvgMarkup(content.contents);
			}
		} catch (error) {
			reportEditorError(error, 'Clipboard error');
		}
	}

	async function copySelectionAsSvg() {
		try {
			const svg = exportToSVG(c.store.getState(), { selectedOnly: true });
			if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
				await navigator.clipboard?.writeText(svg);
				return;
			}
			await navigator.clipboard.write([
				new ClipboardItem({
					'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }),
					'text/plain': new Blob([svg], { type: 'text/plain' })
				})
			]);
		} catch (error) {
			reportEditorError(error, 'Clipboard error');
		}
	}

	async function copySelectionAsPng() {
		try {
			const svg = exportToSVG(c.store.getState(), { selectedOnly: true });
			const image = new Image();
			const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
			await new Promise<void>((resolve, reject) => {
				image.onload = () => resolve();
				image.onerror = () => reject(new Error('Could not render the selection as PNG.'));
				image.src = url;
			});
			URL.revokeObjectURL(url);
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, image.naturalWidth);
			canvas.height = Math.max(1, image.naturalHeight);
			canvas.getContext('2d')?.drawImage(image, 0, 0);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/png')
			);
			if (!blob) throw new Error('Could not encode the selection as PNG.');
			if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
				throw new Error('PNG clipboard access is not available in this browser.');
			}
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		} catch (error) {
			reportEditorError(error, 'Clipboard error');
		}
	}

	// The composition root fixes the platform adapter for this component's lifetime.
	// svelte-ignore state_referenced_locally
	const c = createCanvasController(platformAdapter, {
		setHistoryViewerOpen(value: boolean) {
			historyViewerOpen = value;
		},
		setShortcutsOpen(value: boolean) {
			shortcutsOpen = value;
		},
		setCommandPaletteOpen(value: boolean) {
			commandPaletteOpen = value;
		},
		reportError,
		onCopyRequested: () => void copyCurrentSelection(),
		onCutRequested: () => void cutCurrentSelection(),
		onPasteRequested: () => void pasteFromClipboard()
	});

	function enterFrame(frameId: string) {
		c.store.setState((state) => ({
			...state,
			ui: {
				...state.ui,
				containerPath: [...(state.ui.containerPath ?? []), frameId],
				selectionIds: []
			}
		}));
	}

	let platformKind = $derived(c.platform());
	let activeBoardId = $derived(c.activeBoardId());
	let editorState = $state(c.store.getState());
	$effect(() => {
		const unsubscribe = c.store.subscribe((state) => (editorState = state));
		return unsubscribe;
	});
	let commandPaletteCommands = $derived(getCommandPaletteEntries(editorState, platformKind));
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
		e.preventDefault();
		svgDragActive = false;

		const droppedFile = e.dataTransfer?.files?.[0];
		if (!draggingStencil.current && droppedFile) {
			const rect = canvasEl?.getBoundingClientRect();
			const screen = rect
				? { x: e.clientX - rect.left, y: e.clientY - rect.top }
				: { x: 0, y: 0 };
			const world = Camera.screenToWorld(c.store.getState().camera, screen, c.getViewport());
			const name = droppedFile.name.toLowerCase();
			if (name.endsWith('.svg') || droppedFile.type === 'image/svg+xml') {
				void c.importSvgFile(droppedFile);
				return;
			}
			if (
				droppedFile.type.startsWith('image/') ||
				/\.(?:png|jpe?g|gif|webp|bmp|avif)$/i.test(name)
			) {
				void c.importImageFile(droppedFile, world);
				return;
			}
			if (
				name.endsWith('.excalidraw') ||
				name.endsWith('.canvas') ||
				name.endsWith('.inkfinite')
			) {
				void c.importDroppedFile(droppedFile);
				return;
			}
		}

		let stencil = draggingStencil.current;

		if (!stencil && e.dataTransfer) {
			const stencilId = e.dataTransfer.getData('application/x-inkfinite-stencil');
			if (stencilId) {
				stencil = stencils.registry.get(stencilId) ?? null;
			}
		}

		if (!stencil || !canvasEl) {
			return;
		}

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

	function requestImageReplacement() {
		replaceImageInput?.click();
	}

	function cropSelectedImage(square: boolean) {
		const state = c.store.getState();
		const selected =
			state.ui.selectionIds.length === 1
				? state.doc.shapes[state.ui.selectionIds[0]]
				: undefined;
		if (!selected || selected.type !== 'image') return;
		const ratio = selected.props.w / Math.max(selected.props.h, 1);
		const crop = square
			? ratio > 1
				? { top: 0, right: (1 - 1 / ratio) / 2, bottom: 0, left: (1 - 1 / ratio) / 2 }
				: { top: (1 - ratio) / 2, right: 0, bottom: (1 - ratio) / 2, left: 0 }
			: undefined;
		c.commitLayerState(square ? 'Crop image' : 'Reset image crop', {
			...state,
			doc: {
				...state.doc,
				shapes: {
					...state.doc.shapes,
					[selected.id]: { ...selected, props: { ...selected.props, crop } }
				}
			}
		});
	}

	async function handleImageReplacement(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) await c.replaceImageFile(file);
	}

	function openSvgMarkupDialog() {
		svgMarkupError = null;
		svgMarkupDialogOpen = true;
	}

	function closeSvgMarkupDialog() {
		if (svgMarkupSubmitting) return;
		svgMarkupDialogOpen = false;
		svgMarkup = '';
		svgMarkupError = null;
	}

	async function submitSvgMarkup(event: SubmitEvent) {
		event.preventDefault();
		const contents = svgMarkup.trim();
		if (!contents) {
			svgMarkupError = 'Enter SVG markup before importing.';
			return;
		}

		svgMarkupSubmitting = true;
		svgMarkupError = null;
		try {
			await c.importSvgMarkup(contents);
			svgMarkup = '';
			svgMarkupDialogOpen = false;
		} finally {
			svgMarkupSubmitting = false;
		}
	}

	// TODO: close palette on click? Users might want to add multiple.
	function handleInsertStencilAtCenter(stencil: stencils.Stencil) {
		const viewport = c.getViewport();
		const screen = { x: viewport.width / 2, y: viewport.height / 2 };
		const world = Camera.screenToWorld(c.store.getState().camera, screen, viewport);
		c.insertStencil(stencil, world);
	}

	function handleCommandPaletteAction(id: string) {
		if (id in SELECTION_COMMAND_LABELS) {
			executeSelectionCommand(c.store, id as SelectionCommand);
			return;
		}
		const primary = { ctrl: false, shift: false, alt: false, meta: true };
		switch (id) {
			case 'select-all':
				c.handleAction(Action.keyDown('a', 'KeyA', primary));
				break;
			case 'clear-selection':
				c.handleAction(
					Action.keyDown('Escape', 'Escape', {
						ctrl: false,
						shift: false,
						alt: false,
						meta: false
					})
				);
				break;
			case 'duplicate':
				c.handleAction(Action.keyDown('d', 'KeyD', primary));
				break;
			case 'duplicate-and-connect':
				c.handleAction(Action.keyDown('d', 'KeyD', { ...primary, alt: true }));
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
			case 'zoom-in':
				c.camera.zoomIn();
				break;
			case 'zoom-out':
				c.camera.zoomOut();
				break;
			case 'zoom-fit':
				c.camera.fitAll();
				break;
			case 'zoom-selection':
				c.camera.fitSelection();
				break;
			case 'reset-zoom':
				c.camera.reset();
				break;
		}
	}

	function selectionContextItems(): ContextMenuEntry[] {
		const state = c.store.getState();
		const selected = getSelectedShapes(state);
		const hasGroupedSelection = selected.some(
			(shape) => Boolean(shape.groupId) || shape.type === 'container'
		);
		const allLocked = selected.length > 0 && selected.every((shape) => shape.locked);
		const imageSelected = selected.length === 1 && selected[0]?.type === 'image';
		return [
			{
				id: 'copy',
				label: 'Copy',
				icon: 'add',
				shortcut: '⌘/Ctrl C',
				disabled: selected.length === 0
			},
			{ id: 'copy-svg', label: 'Copy as SVG', icon: 'add', disabled: selected.length === 0 },
			{ id: 'copy-png', label: 'Copy as PNG', icon: 'add', disabled: selected.length === 0 },
			{
				id: 'cut',
				label: 'Cut',
				icon: 'delete',
				shortcut: '⌘/Ctrl X',
				disabled: selected.length === 0
			},
			{ type: 'separator' },
			{ id: 'replace-image', label: 'Replace image', icon: 'add', disabled: !imageSelected },
			{ id: 'crop-image', label: 'Crop to square', icon: 'add', disabled: !imageSelected },
			{
				id: 'reset-image-crop',
				label: 'Reset image crop',
				icon: 'add',
				disabled: !imageSelected
			},
			{
				id: 'duplicate',
				label: 'Duplicate',
				icon: 'add',
				shortcut: '⌘/Ctrl D',
				disabled: selected.length === 0
			},
			{
				id: 'duplicate-and-connect',
				label: 'Duplicate and connect',
				icon: 'arrow-right',
				shortcut: '⌥⌘/Ctrl D',
				disabled: selected.length === 0
			},
			{
				id: 'convert-to-rect',
				label: SELECTION_COMMAND_LABELS['convert-to-rect'],
				icon: 'rectangle',
				disabled: selected.length === 0
			},
			{
				id: 'convert-to-ellipse',
				label: SELECTION_COMMAND_LABELS['convert-to-ellipse'],
				icon: 'ellipse',
				disabled: selected.length === 0
			},
			{
				id: 'group',
				label: SELECTION_COMMAND_LABELS.group,
				icon: 'layers',
				disabled: selected.length < 2
			},
			{
				id: 'ungroup',
				label: SELECTION_COMMAND_LABELS.ungroup,
				icon: 'layers',
				disabled: !hasGroupedSelection
			},
			{ type: 'separator' },
			{
				id: 'align-left',
				label: SELECTION_COMMAND_LABELS['align-left'],
				icon: 'arrow-left',
				disabled: selected.length < 2
			},
			{
				id: 'align-center',
				label: SELECTION_COMMAND_LABELS['align-center'],
				icon: 'select',
				disabled: selected.length < 2
			},
			{
				id: 'align-right',
				label: SELECTION_COMMAND_LABELS['align-right'],
				icon: 'arrow-right',
				disabled: selected.length < 2
			},
			{
				id: 'align-top',
				label: SELECTION_COMMAND_LABELS['align-top'],
				icon: 'arrow-up',
				disabled: selected.length < 2
			},
			{
				id: 'align-middle',
				label: SELECTION_COMMAND_LABELS['align-middle'],
				icon: 'select',
				disabled: selected.length < 2
			},
			{
				id: 'align-bottom',
				label: SELECTION_COMMAND_LABELS['align-bottom'],
				icon: 'arrow-down',
				disabled: selected.length < 2
			},
			{
				id: 'distribute-horizontal',
				label: SELECTION_COMMAND_LABELS['distribute-horizontal'],
				icon: 'arrow-right',
				disabled: selected.length < 3
			},
			{
				id: 'distribute-vertical',
				label: SELECTION_COMMAND_LABELS['distribute-vertical'],
				icon: 'arrow-down',
				disabled: selected.length < 3
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
			{
				id: allLocked ? 'unlock' : 'lock',
				label: allLocked ? SELECTION_COMMAND_LABELS.unlock : SELECTION_COMMAND_LABELS.lock,
				icon: allLocked ? 'lock-open' : 'lock',
				disabled: selected.length === 0
			},
			...(platformKind === 'desktop'
				? [
						{ type: 'separator' as const },
						{
							id: 'agent-editable',
							label: SELECTION_COMMAND_LABELS['agent-editable'],
							icon: 'terminal' as const,
							disabled: selected.length === 0
						},
						{
							id: 'agent-readonly',
							label: SELECTION_COMMAND_LABELS['agent-readonly'],
							icon: 'lock-open' as const,
							disabled: selected.length === 0
						},
						{ type: 'separator' as const }
					]
				: []),
			{
				id: 'zoom-selection',
				label: 'Zoom to selection',
				icon: 'search',
				disabled: selected.length === 0
			},
			{
				id: 'delete',
				label: 'Delete',
				icon: 'delete',
				shortcut: '⌫',
				danger: true,
				disabled: selected.length === 0
			}
		];
	}

	function handleCanvasContextMenu(event: MouseEvent) {
		event.preventDefault();
		if (!canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		const state = c.store.getState();
		const world = Camera.screenToWorld(state.camera, screen, c.getViewport());
		const hitShapeId = hitTestPoint(state, world);
		const shapeId = hitShapeId ? (selectionTarget(state, hitShapeId) ?? hitShapeId) : null;

		if (shapeId) {
			c.store.setState((current) => {
				const shape = current.doc.shapes[shapeId];
				return {
					...current,
					ui: {
						...current.ui,
						activeLayerId: shape?.layerId ?? current.ui.activeLayerId,
						selectionIds: current.ui.selectionIds.includes(shapeId)
							? current.ui.selectionIds
							: [shapeId],
						toolId: 'select'
					}
				};
			});
			contextMenuItems = selectionContextItems();
		} else {
			c.store.setState((current) => ({
				...current,
				ui: { ...current.ui, selectionIds: [] }
			}));
			contextMenuItems = [
				{ id: 'paste', label: 'Paste', icon: 'add', shortcut: '⌘/Ctrl V' },
				{ id: 'paste-at-cursor', label: 'Paste at cursor', icon: 'add' },
				{ id: 'paste-in-place', label: 'Paste in place', icon: 'add' },
				{ type: 'separator' },
				{ id: 'stencils', label: 'Insert stencil', icon: 'grid-dots' },
				{ id: 'zoom-fit', label: 'Zoom to fit', icon: 'search', shortcut: '⇧1' },
				{ id: 'reset-zoom', label: 'Reset zoom', icon: 'search', shortcut: '0' }
			];
		}

		contextMenuPoint = { x: event.clientX, y: event.clientY };
		contextMenuOpen = true;
	}

	async function handleContextMenuAction(id: string) {
		if (id in SELECTION_COMMAND_LABELS) {
			executeSelectionCommand(c.store, id as SelectionCommand);
			return;
		}
		if (id === 'copy') {
			await copyCurrentSelection();
			return;
		}
		if (id === 'copy-svg') {
			await copySelectionAsSvg();
			return;
		}
		if (id === 'copy-png') {
			await copySelectionAsPng();
			return;
		}
		if (id === 'cut') {
			await cutCurrentSelection();
			return;
		}
		if (id === 'paste') {
			await pasteFromClipboard();
			return;
		}
		if (id === 'paste-at-cursor') {
			await pasteFromClipboard({ atCursor: true });
			return;
		}
		if (id === 'paste-in-place') {
			await pasteFromClipboard({ inPlace: true });
			return;
		}
		if (id === 'zoom-selection') {
			c.camera.fitSelection();
			return;
		}
		if (id === 'zoom-fit') {
			c.camera.fitAll();
			return;
		}
		if (id === 'reset-zoom') {
			c.camera.reset();
			return;
		}
		if (id === 'replace-image') {
			requestImageReplacement();
			return;
		}
		if (id === 'crop-image') {
			cropSelectedImage(true);
			return;
		}
		if (id === 'reset-image-crop') {
			cropSelectedImage(false);
			return;
		}
		if (id === 'duplicate' || id === 'duplicate-and-connect') {
			c.handleAction(
				Action.keyDown('d', 'KeyD', {
					ctrl: false,
					shift: false,
					alt: id === 'duplicate-and-connect',
					meta: true
				})
			);
			return;
		}
		if (id === 'delete') {
			c.handleAction(
				Action.keyDown('Delete', 'Delete', {
					ctrl: false,
					shift: false,
					alt: false,
					meta: false
				})
			);
			return;
		}
		if (id === 'stencils') c.stencilPaletteOpen = true;
	}
</script>

<div class="editor">
	<Toolbar
		currentTool={c.tools.currentToolId}
		onToolChange={c.tools.handleChange}
		onStencilsClick={handleStencilsClick}
		showAgentControl={platformKind === 'desktop'}
		store={c.store}
		onEnterFrame={enterFrame}
		onFitSelection={() => c.camera.fitSelection()}
		canvas={canvasEl ?? undefined}
		brushStore={c.brushStore}
		onImportEditable={c.importEditableCanvas}
		onImportSvg={c.importSvg}
		onCreateFromSvg={platformKind === 'web' ? c.createDocumentFromSvg : undefined}
		onImportSvgMarkup={platformKind === 'web' ? openSvgMarkupDialog : undefined}
		onExportSvg={platformKind === 'web' ? c.exportSvg : undefined}
		onExportEditable={c.exportEditableCanvas}
		interchangeBusy={c.interchangeBusy()} />
	<div
		class="canvas-container"
		data-svg-drag-active={svgDragActive}
		ondragenter={(e) => {
			if (e.dataTransfer?.types.includes('Files')) svgDragActive = true;
		}}
		ondragover={(e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		}}
		ondragleave={(e) => {
			if (e.currentTarget === e.target) svgDragActive = false;
		}}
		ondrop={handleDrop}
		role="application">
		<input
			bind:this={replaceImageInput}
			type="file"
			accept="image/*"
			hidden
			onchange={handleImageReplacement} />
		<canvas
			bind:this={canvasEl}
			tabindex="0"
			aria-label="Infinite canvas"
			onpaste={handlePaste}
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
						`font-family:${layout.fontFamily}`
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
	{#if c.platform() === 'desktop'}
		<ProposalReview
			proposal={liveProposal}
			message={proposalMessage}
			onAccept={c.acceptProposal}
			onReject={c.rejectProposal} />
	{/if}
	<HistoryViewer store={c.store} bind:open={historyViewerOpen} onClose={c.history.handleClose} />
	<Dialog
		bind:open={svgMarkupDialogOpen}
		onClose={closeSvgMarkupDialog}
		title="Import SVG markup">
		<form class="svg-markup-dialog" onsubmit={submitSvgMarkup}>
			<div class="svg-markup-dialog__header">
				<h2>Import SVG markup</h2>
				<p>Paste SVG code to add its supported shapes as editable objects.</p>
			</div>
			<label class="svg-markup-dialog__field">
				<span>SVG markup</span>
				<textarea
					bind:value={svgMarkup}
					aria-label="SVG markup"
					placeholder={'<svg viewBox="0 0 100 100">…</svg>'}
					spellcheck="false"
					rows="12"></textarea>
			</label>
			{#if svgMarkupError}<p class="svg-markup-dialog__error" role="alert">
					{svgMarkupError}
				</p>{/if}
			<div class="svg-markup-dialog__actions">
				<Button
					variant="ghost"
					onclick={closeSvgMarkupDialog}
					disabled={svgMarkupSubmitting}>Cancel</Button>
				<Button variant="primary" type="submit" busy={svgMarkupSubmitting}
					>Import SVG</Button>
			</div>
		</form>
	</Dialog>
	<Dialog
		open={Boolean(editorError)}
		onClose={() => (editorError = null)}
		title={editorErrorTitle}>
		<div class="editor-error" role="alert">
			<h2>{editorErrorTitle}</h2>
			<p>{editorError}</p>
			<div class="editor-error__actions">
				<Button variant="primary" onclick={() => (editorError = null)}>Close</Button>
			</div>
		</div>
	</Dialog>
	<StatusBar
		store={c.store}
		cursor={c.cursorStore}
		persistence={persistenceStatusStore}
		snap={c.snapStore}
		viewport={c.viewport()}
		platform={platformKind}
		draft={c.desktop.isDraft}
		onOpenBrowser={c.fileBrowser.handleOpen}
		onShortcutsClick={() => (shortcutsOpen = true)}
		onHistoryClick={c.history.handleClick} />
	<KeyboardShortcuts bind:open={shortcutsOpen} />
	<CommandPalette
		bind:open={commandPaletteOpen}
		commands={commandPaletteCommands}
		onSelect={handleCommandPaletteAction} />
	{#if c.fileBrowser.vm && c.fileBrowser.open}
		<FileBrowser
			bind:vm={c.fileBrowser.vm}
			bind:open={c.fileBrowser.open}
			onUpdate={c.fileBrowser.handleUpdate}
			onClose={c.fileBrowser.handleClose}
			fetchInspectorData={platformKind === 'web'
				? c.fileBrowser.fetchInspectorData
				: undefined}
			desktopRepo={c.desktop.repo}
			{activeBoardId}
			persistence={persistenceStatusStore}
			draft={c.desktop.isDraft} />
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

	.canvas-container::after {
		content: 'Drop a document, SVG, or image to import';
		position: absolute;
		inset: var(--ink-space-5);
		display: grid;
		place-items: center;
		border: 1px dashed var(--ink-accent);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-accent) 10%, var(--ink-canvas));
		color: var(--ink-text);
		font: 600 var(--ink-type-sm) / 1.3 var(--ink-font-body);
		pointer-events: none;
		opacity: 0;
		transition: opacity var(--ink-duration-fast) var(--ink-ease-out);
		z-index: 3;
	}

	.canvas-container[data-svg-drag-active='true']::after {
		opacity: 1;
	}

	.canvas-container canvas {
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M4 2.75 22.2 16.1l-8.05 1.15 4.2 7.25-4.2 2.4-4.05-7.2-5.35 6.1z' fill='%23171928' stroke='%23a78bfa' stroke-width='2.25' stroke-linejoin='round'/%3E%3C/svg%3E")
				4 3,
			default;
	}

	.editor-error {
		width: min(32rem, calc(100vw - 2rem));
		padding: var(--ink-space-6);
	}

	.editor-error h2,
	.editor-error p {
		margin: 0;
	}

	.editor-error h2 {
		font: 700 var(--ink-type-xl) / 1.15 var(--ink-font-body);
	}

	.editor-error p {
		margin-top: var(--ink-space-3);
		color: var(--ink-text-muted);
		line-height: 1.5;
		word-break: break-word;
	}

	.editor-error__actions {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--ink-space-6);
	}

	.interchange-notice {
		width: min(32rem, calc(100vw - 3rem));
		padding: var(--ink-space-6);
	}

	.svg-markup-dialog {
		width: min(42rem, calc(100vw - 2rem));
		padding: var(--ink-space-6);
	}

	.svg-markup-dialog__header h2,
	.svg-markup-dialog__header p {
		margin: 0;
	}

	.svg-markup-dialog__header h2 {
		font: 700 var(--ink-type-xl) / 1.15 var(--ink-font-body);
	}

	.svg-markup-dialog__header p {
		margin-top: var(--ink-space-2);
		color: var(--ink-text-muted);
		line-height: 1.5;
	}

	.svg-markup-dialog__field {
		display: grid;
		gap: var(--ink-space-2);
		margin-top: var(--ink-space-5);
		font: 650 var(--ink-type-sm) / 1.2 var(--ink-font-body);
	}

	.svg-markup-dialog__field textarea {
		min-height: 16rem;
		width: 100%;
		resize: vertical;
		padding: var(--ink-space-3);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel-small);
		background: var(--ink-canvas);
		color: var(--ink-text);
		font:
			450 var(--ink-type-sm) / 1.5 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}

	.svg-markup-dialog__field textarea:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.svg-markup-dialog__error {
		margin: var(--ink-space-2) 0 0;
		color: var(--ink-danger);
		font-size: var(--ink-type-sm);
	}

	.svg-markup-dialog__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--ink-space-3);
		margin-top: var(--ink-space-6);
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
		z-index: 2;
		box-shadow: var(--ink-shadow-popover);
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
		box-shadow: var(--ink-shadow-popover);
		border-radius: var(--ink-radius-control-small);
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
		box-shadow: var(--ink-shadow-popover);
		white-space: pre-wrap;
		overflow: auto;
	}

	.canvas-text-editor:focus-visible,
	.canvas-arrow-label-editor:focus-visible,
	.canvas-markdown-editor:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.canvas-marquee {
		position: absolute;
		border: var(--ink-line-width) solid color-mix(in srgb, var(--ink-focus) 72%, transparent);
		background-color: color-mix(in srgb, var(--ink-focus) 18%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink-surface-raised) 25%, transparent);
		pointer-events: none;
		z-index: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.canvas-container::after {
			transition: none;
		}
	}
</style>
