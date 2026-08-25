import { createInputAdapter, type InputAdapter } from '../input';
import { initialPersistenceStatus } from '../platform';
import type {
	DesktopDocumentRepo,
	EditorPlatformAdapter,
	EditorPlatformSession,
	LiveProposal
} from '../platform';
import { createBrushStore, createSnapStore, createStatusStore } from '../status';
import type { BrushStore, SnapStore, StatusStore } from '../status';
import { themeStore } from '../theme.svelte';
import {
	ArrowTool,
	Camera,
	DirectSelectTool,
	createToolMap,
	CursorStore,
	EllipseTool,
	FrameTool,
	getInteractiveShapesOnCurrentPage,
	hitTestPoint,
	selectionTarget,
	LineTool,
	EditorLayerRecord,
	exportInterchange,
	exportToSVG,
	importInterchange,
	MarkdownTool,
	EditorPageRecord,
	PenTool,
	RectTool,
	SelectTool,
	shapeBoundsForState,
	snapPoint,
	snapTranslation,
	SnapshotCommand,
	Store,
	TextTool,
	validateDoc
} from '@inkfinite/core';
import type {
	Box2,
	InterchangeFormat,
	InterchangeWarning,
	SvgExport,
	SvgExportOptions,
	Viewport
} from '@inkfinite/core';
import { diffDoc } from '@inkfinite/core/persistence';
import type { LoadedDoc, PersistenceSink, PersistentDocRepo } from '@inkfinite/core/persistence';
import { stencils } from '@inkfinite/core';
import { Action, EditorRuntime } from '@inkfinite/editor/runtime';
import { createImageAsset, pasteImage } from '../clipboard';
import { createRenderer, type Renderer } from '@inkfinite/editor/renderer';
import { onDestroy, onMount } from 'svelte';
import { computeCursor } from './canvas-helpers';
import { ArrowLabelEditorController } from './controllers/arrowlabel-controller.svelte';
import { CameraController } from './controllers/camera-controller';
import { DesktopFileController } from './controllers/desktop-file-controller.svelte';
import { FileBrowserController } from './controllers/filebrowser-controller.svelte';
import { HistoryController } from './controllers/history-controller';
import { MarkdownEditorController } from './controllers/markdown-controller.svelte';
import { TextEditorController } from './controllers/texteditor-controller.svelte';
import { ToolController } from './controllers/tool-controller.svelte';
import { HandleState } from './store/handle-state.svelte';
import { PointerState } from './store/pointer-state.svelte';

type Stencil = stencils.Stencil;

let editorPerformanceSequence = 0;

/** Measures synchronous projection and store commits without changing editor behavior. */
function measureEditorPerformance<T>(label: string, update: () => T): T {
	if (typeof performance === 'undefined' || typeof performance.measure !== 'function')
		return update();
	const id = ++editorPerformanceSequence;
	const startMark = `inkfinite:editor:${label}:start:${id}`;
	const endMark = `inkfinite:editor:${label}:end:${id}`;
	performance.mark(startMark);
	try {
		return update();
	} finally {
		performance.mark(endMark);
		performance.measure(`inkfinite:editor:${label}:${id}`, { start: startMark, end: endMark });
	}
}

export type CanvasControllerBindings = {
	setHistoryViewerOpen(value: boolean): void;
	setShortcutsOpen(value: boolean): void;
	setCommandPaletteOpen(value: boolean): void;
	reportError(error: unknown, title?: string): void;
	onCopyRequested?: () => void;
	onCutRequested?: () => void;
	onPasteRequested?: () => void;
};

export type CanvasController = ReturnType<typeof createCanvasController>;

export function createCanvasController(
	platformAdapter: EditorPlatformAdapter,
	bindings: CanvasControllerBindings
) {
	let repo: PersistentDocRepo | null = null;
	let sink: PersistenceSink | null = null;
	let platformSession: EditorPlatformSession | null = null;
	const platform = platformAdapter.kind;
	const fallbackStatusStore = createStatusStore(initialPersistenceStatus(platform));
	let persistenceStatusStore = $state<StatusStore>(fallbackStatusStore);
	let activeBoardId: string | null = null;
	let desktopRepo: DesktopDocumentRepo | null = null;
	let proposal = $state<LiveProposal | null>(null);
	let proposalMessage = $state<string | null>(null);
	let unsubscribeProposal: (() => void) | null = null;
	let unsubscribeLiveDocument: (() => void) | null = null;
	let unsubscribeAgentUi: (() => void) | null = null;
	let unsubscribeFileMenu: (() => void) | null = null;
	let unsubscribeAgentContext: (() => void) | null = null;
	let agentContextTimer: ReturnType<typeof setTimeout> | null = null;
	let lastAgentContext = '';
	let removeBeforeUnload: (() => void) | null = null;
	let stencilPaletteOpen = $state(false);
	let interchangeBusy = $state(false);
	let interchangeNotice = $state<{
		title: string;
		message: string;
		warnings: InterchangeWarning[];
		error: boolean;
	} | null>(null);
	let overlayViewport = $state<Viewport>({ width: 1, height: 1 });
	let renderer: Renderer | null = null;
	let inputAdapter: InputAdapter | null = null;
	const initialPage = EditorPageRecord.create('Page 1');
	const initialLayer = EditorLayerRecord.create(initialPage.id, 'Default');
	const handleResize = () => {
		overlayViewport = measureViewport(canvas);
		camera.refit();
		if (marqueeBounds) {
			updateMarquee(marqueeBounds);
		}
		renderer?.markDirty();
		scheduleAgentContext();
	};
	if (typeof window !== 'undefined') {
		window.addEventListener('resize', handleResize);
	}
	let canvas = $state<HTMLCanvasElement | null>(null);

	const pointerState = new PointerState();
	const handleState = new HandleState();

	const store = new Store(
		{
			doc: {
				pages: { [initialPage.id]: { ...initialPage, layerIds: [initialLayer.id] } },
				layers: { [initialLayer.id]: initialLayer },
				shapes: {},
				bindings: {}
			},
			ui: {
				currentPageId: initialPage.id,
				activeLayerId: initialLayer.id,
				selectionIds: [],
				toolId: 'select'
			},
			camera: Camera.create()
		},
		{
			onHistoryEvent: (event) => {
				if (!activeBoardId || event.kind !== 'doc' || !sink) {
					return;
				}
				const topologyEdits = event.op === 'do' ? event.command.topologyEdits : undefined;
				if (sink.enqueueEditorChange) {
					sink.enqueueEditorChange({
						boardId: activeBoardId,
						before: event.beforeState.doc,
						after: event.afterState.doc,
						op: event.op,
						description: event.command.name,
						topologyEdits
					});
					return;
				}
				const patch = diffDoc(event.beforeState.doc, event.afterState.doc);
				sink.enqueueDocPatch(
					activeBoardId,
					topologyEdits ? { ...patch, topologyEdits } : patch
				);
			}
		}
	);

	const cursorStore = new CursorStore();
	const snapStore: SnapStore = createSnapStore();
	const brushStore: BrushStore = createBrushStore({
		color: themeStore.current === 'dark' ? '#d8e6e6' : '#1e2029'
	});
	type ScreenRect = { left: number; top: number; width: number; height: number };
	let marqueeBounds: Box2 | null = null;
	let marqueeRect = $state<ScreenRect | null>(null);

	function updateMarquee(bounds: Box2 | null, cameraOverride?: Camera) {
		marqueeBounds = bounds ? { min: { ...bounds.min }, max: { ...bounds.max } } : null;
		if (!marqueeBounds) {
			marqueeRect = null;
			return;
		}
		const viewport = getViewport();
		const cameraState = cameraOverride ?? store.getState().camera;
		const minScreen = Camera.worldToScreen(cameraState, marqueeBounds.min, viewport);
		const maxScreen = Camera.worldToScreen(cameraState, marqueeBounds.max, viewport);
		const left = Math.min(minScreen.x, maxScreen.x);
		const top = Math.min(minScreen.y, maxScreen.y);
		const width = Math.abs(maxScreen.x - minScreen.x);
		const height = Math.abs(maxScreen.y - minScreen.y);
		marqueeRect = { left, top, width, height };
	}

	function measureViewport(node: HTMLCanvasElement | null): Viewport {
		if (node) {
			const rect = node.getBoundingClientRect();
			return { width: rect.width || 1, height: rect.height || 1 };
		}
		if (typeof window !== 'undefined') {
			return { width: window.innerWidth || 1, height: window.innerHeight || 1 };
		}
		return { width: 1, height: 1 };
	}

	function getViewport(): Viewport {
		return measureViewport(canvas);
	}

	function scheduleAgentContext() {
		if (!desktopRepo || agentContextTimer) return;
		agentContextTimer = setTimeout(() => {
			agentContextTimer = null;
			if (!desktopRepo) return;
			const state = store.getState();
			const viewport = getViewport();
			const width = viewport.width / state.camera.zoom;
			const height = viewport.height / state.camera.zoom;
			const canvasRect = canvas?.getBoundingClientRect();
			const occludedRegions =
				typeof document === 'undefined' || !canvasRect
					? []
					: [...document.querySelectorAll<HTMLElement>('[data-agent-occlusion]')]
							.filter((element) => element.offsetParent !== null)
							.map((element) => {
								const rect = element.getBoundingClientRect();
								const min = Camera.screenToWorld(
									state.camera,
									{
										x: rect.left - canvasRect.left,
										y: rect.top - canvasRect.top
									},
									viewport
								);
								const max = Camera.screenToWorld(
									state.camera,
									{
										x: rect.right - canvasRect.left,
										y: rect.bottom - canvasRect.top
									},
									viewport
								);
								return {
									x: min.x,
									y: min.y,
									width: max.x - min.x,
									height: max.y - min.y
								};
							});
			const context = {
				pageId: state.ui.currentPageId,
				activeLayerId: state.ui.activeLayerId ?? null,
				selectionIds: [...state.ui.selectionIds],
				viewport: {
					x: state.camera.x - width / 2,
					y: state.camera.y - height / 2,
					width,
					height
				},
				camera: { ...state.camera },
				occludedRegions
			};
			const serialized = JSON.stringify(context);
			if (serialized === lastAgentContext) return;
			lastAgentContext = serialized;
			void desktopRepo
				.updateAgentContext(context)
				.catch((error) => console.error('Failed to publish desktop agent context', error));
		}, 100);
	}

	const camera = new CameraController(store, getViewport);

	function getOverlayViewport(): Viewport {
		return overlayViewport;
	}

	function refreshCursor() {
		if (!canvas) {
			return;
		}
		const selected =
			store.getState().ui.selectionIds.length === 1
				? store.getState().doc.shapes[store.getState().ui.selectionIds[0]]
				: undefined;
		const cursor = computeCursor(
			textEditor.isEditing || arrowLabelEditor.isEditing || markdownEditor.isEditing,
			{
				isPanning: runtime.getInteractionState().panning,
				spaceHeld: runtime.getInteractionState().spaceHeld
			},
			{ hover: handleState.hover, active: handleState.active },
			runtime.getInteractionState().pointerDown,
			selected?.rot ?? 0
		);
		canvas.style.cursor = cursor === 'default' ? '' : cursor;
	}

	function setActiveBoardId(boardId: string) {
		activeBoardId = boardId;
		platformSession?.setActiveBoard?.(boardId);
	}

	function applyLoadedDoc(doc: LoadedDoc, fitDrawing = false, syncCanonical = true) {
		const validation = validateDoc({
			pages: doc.pages,
			layers: doc.layers,
			shapes: doc.shapes,
			bindings: doc.bindings,
			...(doc.assets ? { assets: doc.assets } : {})
		});
		if (!validation.ok) {
			bindings.reportError(new Error(validation.errors.join('; ')), 'Document error');
			return;
		}
		const firstPageId = doc.order.pageIds[0] ?? Object.keys(doc.pages)[0] ?? null;
		measureEditorPerformance('projection', () =>
			store.setState((state) => ({
				...state,
				doc: {
					pages: doc.pages,
					layers: doc.layers ?? doc.order.layers,
					...(doc.assets ? { assets: doc.assets } : {}),
					shapes: doc.shapes,
					bindings: doc.bindings
				},
				ui: { ...state.ui, currentPageId: firstPageId, selectionIds: [] }
			}))
		);
		if (activeBoardId && syncCanonical) {
			const boardId = activeBoardId;
			const hydration = platformSession?.setActiveDocument?.(boardId, doc);
			if (hydration) {
				void hydration
					.then((hydrated) => {
						if (hydrated && activeBoardId === boardId)
							applyLoadedDoc(hydrated, false, false);
					})
					.catch((error) =>
						console.error('Failed to hydrate the Rust document projection', error)
					);
			}
		}
		if (fitDrawing) {
			camera.fitAll();
		}
	}

	const handleMarqueeChange = (bounds: Box2 | null) => void updateMarquee(bounds);

	const selectTool = new SelectTool(
		handleMarqueeChange,
		(point, context) => {
			const snap = snapStore.get();
			if (!context) {
				if (
					!snap.snapEnabled ||
					!snap.gridEnabled ||
					!Number.isFinite(snap.gridSize) ||
					snap.gridSize <= 0
				) {
					return point;
				}
				return {
					x: Math.round(point.x / snap.gridSize) * snap.gridSize,
					y: Math.round(point.y / snap.gridSize) * snap.gridSize
				};
			}
			return snapTranslation(
				context.state,
				context.initialShapes.values(),
				context.leadPosition,
				context.delta,
				snap
			);
		},
		(result) => {
			pointerState.snappedWorld = result?.point ?? null;
			pointerState.snapGuides = result?.guides ?? [];
			renderer?.markDirty();
		},
		(point, state, excludedIds) => snapPoint(state, point, excludedIds, snapStore.get())
	);
	const directSelectTool = new DirectSelectTool();
	const getCanvasAppearance = () => themeStore.current;
	const rectTool = new RectTool(getCanvasAppearance);
	const ellipseTool = new EllipseTool(getCanvasAppearance);
	const frameTool = new FrameTool(getCanvasAppearance);
	const lineTool = new LineTool(getCanvasAppearance);
	const arrowTool = new ArrowTool(getCanvasAppearance);
	const textTool = new TextTool(getCanvasAppearance);
	const markdownTool = new MarkdownTool(getCanvasAppearance);
	const getPenBrushConfig = () => {
		const { color: _color, ...config } = brushStore.get();
		return config;
	};
	const getPenStrokeStyle = () => {
		const brush = brushStore.get();
		return { color: brush.color, opacity: 1 };
	};
	const penTool = new PenTool(getPenBrushConfig, getPenStrokeStyle);
	const tools = createToolMap([
		selectTool,
		directSelectTool,
		rectTool,
		ellipseTool,
		frameTool,
		lineTool,
		arrowTool,
		textTool,
		markdownTool,
		penTool
	]);

	const textEditor = new TextEditorController(store, getOverlayViewport, refreshCursor);
	const arrowLabelEditor = new ArrowLabelEditorController(
		store,
		getOverlayViewport,
		refreshCursor
	);
	const markdownEditor = new MarkdownEditorController(store, getOverlayViewport, refreshCursor);
	const toolController = new ToolController(store, tools);
	const unsubscribeMarqueeCamera = store.subscribe((state) => {
		if (marqueeBounds) {
			updateMarquee(marqueeBounds, state.camera);
		}
	});
	const history = new HistoryController(bindings);
	const desktop = new DesktopFileController(
		() => repo,
		() => desktopRepo,
		(boardId, doc) => {
			setActiveBoardId(boardId);
			applyLoadedDoc(doc, true);
		},
		() => sink?.flush() ?? Promise.resolve(),
		(error, title) => bindings.reportError(error, title)
	);
	const fileBrowser = new FileBrowserController(
		() => repo,
		(boardId, doc) => {
			setActiveBoardId(boardId);
			applyLoadedDoc(doc, true);
		},
		() => platformSession?.inspectBoard,
		() => sink?.flush() ?? Promise.resolve(),
		(error, title) => bindings.reportError(error, title)
	);
	const runtime = new EditorRuntime({
		store,
		tools,
		selectionTool: selectTool,
		getSnapSettings: () => snapStore.get(),
		getViewport,
		onTransactionDraft: ({ name, kind, before, after, topologyEdits }) => {
			// Tool movement renders `after` as a local preview. We want restore the
			// committed mirror before executing the command so history and persistence
			// receive the real before/after pair exactly once.
			measureEditorPerformance('store-commit', () => {
				store.setState(() => before);
				store.executeCommand(
					new SnapshotCommand(name, kind, before, after, topologyEdits)
				);
			});
			syncHandleState();
		},
		onBrowseRequested: () => fileBrowser.handleOpen(),
		onShortcutsRequested: () => bindings.setShortcutsOpen(true),
		onCommandPaletteRequested: () => bindings.setCommandPaletteOpen(true),
		onUndoRequested: () => store.undo(),
		onRedoRequested: () => store.redo(),
		onCopyRequested: bindings.onCopyRequested,
		onCutRequested: bindings.onCutRequested,
		onPasteRequested: bindings.onPasteRequested,
		onHandleHover: setHandleHover,
		onInteractionChanged: syncHandleState,
		onSnappedWorldChanged: (world) => {
			pointerState.snappedWorld = world;
		}
	});

	function setHandleHover(handle: string | null) {
		if (handleState.hover === handle) {
			return;
		}
		handleState.hover = handle;
		refreshCursor();
	}

	function syncHandleState() {
		const activeTool =
			store.getState().ui.toolId === 'direct-select' ? directSelectTool : selectTool;
		handleState.active = activeTool.getActiveHandle ? activeTool.getActiveHandle() : null;
		refreshCursor();
	}

	function handleAction(action: import('@inkfinite/core').Action) {
		if (
			textEditor.isEditing &&
			(action.type === 'pointer-down' || action.type === 'pointer-up')
		) {
			textEditor.commit();
		}

		if (
			markdownEditor.isEditing &&
			(action.type === 'pointer-down' || action.type === 'pointer-up')
		) {
			markdownEditor.commit();
		}

		if (camera.handleAction(action)) {
			return;
		}
		if (
			action.type === 'pointer-down' &&
			(action.button === 1 ||
				(action.button === 0 && runtime.getInteractionState().spaceHeld))
		) {
			camera.cancelFit();
		}

		runtime.handleAction(action);
	}

	function commitLayerState(name: string, nextState: import('@inkfinite/core').EditorState) {
		const state = store.getState();
		runtime.commit(
			state,
			nextState,
			name,
			Action.keyDown(name, name, { ctrl: false, shift: false, alt: false, meta: false })
		);
	}

	async function importEditableCanvas() {
		if (!repo || !sink || !platformSession?.interchange) return;
		interchangeBusy = true;
		try {
			const source = await platformSession.interchange.pickImport();
			if (!source) return;
			const imported = importInterchange(source.contents, source.name);
			await sink.flush();
			const boardId = await repo.importBoard(imported.snapshot);
			const doc = await repo.loadDoc(boardId);
			setActiveBoardId(boardId);
			applyLoadedDoc(doc, true);
			await desktop.markImported();
			interchangeNotice = {
				title: 'Import complete',
				message: `${source.name} is now an Inkfinite document.`,
				warnings: imported.warnings,
				error: false
			};
		} catch (error) {
			interchangeNotice = {
				title: 'Import failed',
				message: error instanceof Error ? error.message : String(error),
				warnings: [],
				error: true
			};
		} finally {
			interchangeBusy = false;
		}
	}

	async function createBrowserDocumentFromSvg(source: {
		name: string;
		contents: string | Uint8Array;
	}) {
		if (!repo || !sink || !platformSession?.commitSvgImport) {
			throw new Error('The browser document engine is not available.');
		}
		const size =
			typeof source.contents === 'string'
				? new TextEncoder().encode(source.contents).byteLength
				: source.contents.byteLength;
		if (size > 16 * 1024 * 1024) {
			throw new Error('The SVG source is larger than the 16 MB import limit.');
		}
		const bytes =
			typeof source.contents === 'string'
				? new TextEncoder().encode(source.contents)
				: source.contents;
		await sink.flush();
		const boardName = source.name.replace(/\.[^.]+$/, '').trim() || 'Untitled Board';
		const boardId = await repo.createBoard(boardName);
		const doc = await repo.loadDoc(boardId);
		setActiveBoardId(boardId);
		applyLoadedDoc(doc, true);
		const imported = await platformSession.commitSvgImport({
			boardId,
			source: bytes,
			sourceName: source.name,
			pageId: doc.order.pageIds[0],
			layerId: doc.pages[doc.order.pageIds[0] ?? '']?.layerIds?.[0]
		});
		applyLoadedDoc(imported.doc, true);
		interchangeNotice = {
			title: 'SVG import complete',
			message: `${source.name} is now an Inkfinite document.`,
			warnings: imported.warnings,
			error: false
		};
	}

	async function importSvgIntoCurrentDocument(source: {
		name: string;
		contents: string | Uint8Array;
	}) {
		if (!activeBoardId || !sink || !platformSession?.commitSvgImport) {
			throw new Error('The browser document engine is not available.');
		}
		const bytes =
			typeof source.contents === 'string'
				? new TextEncoder().encode(source.contents)
				: source.contents;
		if (bytes.byteLength > 16 * 1024 * 1024) {
			throw new Error('The SVG source is larger than the 16 MB import limit.');
		}
		await sink.flush();
		const state = store.getState();
		const pageId = state.ui.currentPageId ?? Object.keys(state.doc.pages)[0];
		if (!pageId) throw new Error('The current document has no page for SVG import.');
		const imported = await platformSession.commitSvgImport({
			boardId: activeBoardId,
			source: bytes,
			sourceName: source.name,
			pageId,
			layerId: state.doc.pages[pageId]?.layerIds?.[0]
		});
		applyLoadedDoc(imported.doc, true);
		interchangeNotice = {
			title: 'SVG import complete',
			message: 'The SVG was added to the current document as native shapes.',
			warnings: imported.warnings,
			error: false
		};
	}

	async function importSvg() {
		if (!repo || !sink || !platformSession?.interchange) return;
		interchangeBusy = true;
		try {
			if (desktopRepo) {
				const imported = await desktopRepo.importSvg();
				if (!imported) return;
				applyLoadedDoc(imported.doc, true);
				interchangeNotice = {
					title: 'SVG import complete',
					message: 'The SVG was added to the current document as native shapes.',
					warnings: [
						...imported.warnings.map((message, index) => ({
							code: `svg-warning-${index}`,
							message,
							count: 1
						})),
						...(imported.omitted_image_count > 0
							? [
									{
										code: 'svg-images-omitted',
										message:
											'Some embedded image nodes could not be imported.',
										count: imported.omitted_image_count
									}
								]
							: [])
					],
					error: false
				};
				return;
			}
			const source = await platformSession.interchange.pickSvg?.();
			if (source)
				await importSvgIntoCurrentDocument({ name: source.name, contents: source.bytes });
		} catch (error) {
			interchangeNotice = {
				title: 'SVG import failed',
				message: error instanceof Error ? error.message : String(error),
				warnings: [],
				error: true
			};
		} finally {
			interchangeBusy = false;
		}
	}

	async function createBrowserDocumentFromSvgWithStatus(
		source:
			| { name: string; contents: string | Uint8Array }
			| Promise<{ name: string; contents: string | Uint8Array }>
	) {
		if (platform !== 'web' || !platformSession?.interchange) return;
		interchangeBusy = true;
		try {
			await createBrowserDocumentFromSvg(await source);
		} catch (error) {
			interchangeNotice = {
				title: 'SVG import failed',
				message: error instanceof Error ? error.message : String(error),
				warnings: [],
				error: true
			};
		} finally {
			interchangeBusy = false;
		}
	}

	async function importSvgMarkup(contents: string) {
		interchangeBusy = true;
		try {
			await importSvgIntoCurrentDocument({ name: 'pasted-svg.svg', contents });
		} catch (error) {
			interchangeNotice = {
				title: 'SVG import failed',
				message: error instanceof Error ? error.message : String(error),
				warnings: [],
				error: true
			};
		} finally {
			interchangeBusy = false;
		}
	}

	async function createDocumentFromSvg() {
		if (!platformSession?.interchange?.pickSvg) return;
		const source = await platformSession.interchange.pickSvg();
		if (source) {
			await createBrowserDocumentFromSvgWithStatus({
				name: source.name,
				contents: source.bytes
			});
		}
	}

	async function importSvgFile(file: File) {
		const path = (file as File & { path?: string }).path;
		if (desktopRepo && path) {
			const imported = await desktopRepo.importSvgPath(path);
			if (imported) {
				applyLoadedDoc(imported.doc, true);
				interchangeNotice = {
					title: 'SVG import complete',
					message: 'The SVG was added to the current document as native shapes.',
					warnings: imported.warnings.map((message, index) => ({
						code: `svg-warning-${index}`,
						message,
						count: 1
					})),
					error: false
				};
			}
			return;
		}
		await createBrowserDocumentFromSvgWithStatus(
			file
				.arrayBuffer()
				.then((bytes) => ({ name: file.name, contents: new Uint8Array(bytes) }))
		);
	}

	async function replaceImageFile(file: File) {
		const state = store.getState();
		const selected =
			state.ui.selectionIds.length === 1
				? state.doc.shapes[state.ui.selectionIds[0]]
				: undefined;
		if (!selected || selected.type !== 'image') return;
		try {
			if (file.size > 16 * 1024 * 1024)
				throw new Error('The image is larger than the 16 MB import limit.');
			const bytes = [...new Uint8Array(await file.arrayBuffer())];
			const asset = await createImageAsset(file.name, file.type || 'image/png', bytes);
			const next = {
				...state,
				doc: {
					...state.doc,
					assets: { ...(state.doc.assets ?? {}), [asset.id]: asset },
					shapes: {
						...state.doc.shapes,
						[selected.id]: {
							...selected,
							props: { ...selected.props, assetId: asset.id }
						}
					}
				}
			};
			commitLayerState('Replace image', next);
		} catch (error) {
			bindings.reportError(error, 'Image replace failed');
		}
	}

	async function importImageFile(file: File, position: { x: number; y: number }) {
		try {
			if (file.size > 16 * 1024 * 1024)
				throw new Error('The image is larger than the 16 MB import limit.');
			const bytes = [...new Uint8Array(await file.arrayBuffer())];
			const next = await pasteImage(
				store.getState(),
				{ name: file.name, mediaType: file.type || 'image/png', bytes },
				position
			);
			commitLayerState('Import image', next);
		} catch (error) {
			bindings.reportError(error, 'Image import failed');
		}
	}

	async function importDroppedFile(file: File) {
		try {
			if (file.size > 16 * 1024 * 1024)
				throw new Error('The dropped file is larger than the 16 MB import limit.');
			if (file.name.toLowerCase().endsWith('.inkfinite')) {
				const path = (file as File & { path?: string }).path;
				if (desktopRepo && path) {
					const opened = await desktopRepo.openPath(path);
					setActiveBoardId(opened.boardId);
					applyLoadedDoc(opened.doc, true);
					return;
				}
				if (!platformSession?.importCanonicalDocument) {
					throw new Error(
						'Opening .inkfinite files from a drop is available in the web editor.'
					);
				}
				const imported = await platformSession.importCanonicalDocument({
					name: file.name,
					source: new Uint8Array(await file.arrayBuffer())
				});
				setActiveBoardId(imported.boardId);
				applyLoadedDoc(imported.doc, true, false);
				return;
			}
			if (!repo || !sink || !platformSession?.interchange) {
				throw new Error('Document import is not available in this editor session.');
			}
			const imported = importInterchange(await file.text(), file.name);
			await sink.flush();
			const boardId = await repo.importBoard(imported.snapshot);
			const doc = await repo.loadDoc(boardId);
			setActiveBoardId(boardId);
			applyLoadedDoc(doc, true);
			interchangeNotice = {
				title: 'Import complete',
				message: `${file.name} is now an Inkfinite document.`,
				warnings: imported.warnings,
				error: false
			};
		} catch (error) {
			interchangeNotice = {
				title: 'Import failed',
				message: error instanceof Error ? error.message : String(error),
				warnings: [],
				error: true
			};
		}
	}

	/** Renders the current page through the same exporter used by SVG file export. */
	async function renderSvg(
		selectedOnly: boolean,
		options: { transparentBackground?: boolean } = {}
	): Promise<SvgExport> {
		const state = store.getState();
		const exportFunction = platformSession?.interchange?.exportSvg;
		const background = options.transparentBackground ? 'transparent' : 'white';
		if (exportFunction && activeBoardId && repo && sink) {
			await sink.flush();
			const snapshot = await repo.exportBoard(activeBoardId);
			const exportOptions: SvgExportOptions = {
				pageId: state.ui.currentPageId ?? undefined,
				selectionIds: selectedOnly ? [...state.ui.selectionIds] : [],
				selectionOnly: selectedOnly,
				background
			};
			return exportFunction(snapshot, exportOptions);
		}

		return {
			format: 'svg',
			contents: exportToSVG(state, { selectedOnly, background }),
			extension: 'svg',
			mimeType: 'image/svg+xml',
			warnings: []
		};
	}

	async function exportSvg(selectedOnly: boolean) {
		if (!activeBoardId || !repo || !sink || !platformSession?.interchange) {
			throw new Error('SVG export is not available in this editor session.');
		}
		interchangeBusy = true;
		try {
			const exported = await renderSvg(selectedOnly);
			await sink.flush();
			const snapshot = await repo.exportBoard(activeBoardId);
			const saved = await platformSession.interchange.saveExport(
				exported,
				snapshot.board.name
			);
			if (!saved) return;
			interchangeNotice = {
				title: 'Export complete',
				message: `${snapshot.board.name}.svg was saved.`,
				warnings: exported.warnings,
				error: false
			};
		} catch (error) {
			interchangeNotice = {
				title: 'Export failed',
				message: error instanceof Error ? error.message : String(error),
				warnings: [],
				error: true
			};
		} finally {
			interchangeBusy = false;
		}
	}

	async function exportEditableCanvas(format: InterchangeFormat) {
		if (!activeBoardId || !repo || !sink || !platformSession?.interchange) return;
		interchangeBusy = true;
		try {
			await sink.flush();
			const snapshot = await repo.exportBoard(activeBoardId);
			const exported = exportInterchange(
				snapshot,
				format,
				store.getState().ui.currentPageId ?? undefined
			);
			const saved = await platformSession.interchange.saveExport(
				exported,
				snapshot.board.name
			);
			if (!saved) return;
			interchangeNotice = {
				title: 'Export complete',
				message: `${snapshot.board.name}.${exported.extension} was saved.`,
				warnings: exported.warnings,
				error: false
			};
		} catch (error) {
			interchangeNotice = {
				title: 'Export failed',
				message: error instanceof Error ? error.message : String(error),
				warnings: [],
				error: true
			};
		} finally {
			interchangeBusy = false;
		}
	}

	function handleCanvasDoubleClick(event: MouseEvent) {
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		const state = store.getState();
		const world = Camera.screenToWorld(state.camera, screen, getViewport());
		const hitShapeId = hitTestPoint(state, world);
		const targetId = hitShapeId ? selectionTarget(state, hitShapeId) : null;
		const target = targetId ? state.doc.shapes[targetId] : undefined;
		if (target?.type === 'container') {
			store.setState((current) => ({
				...current,
				ui: {
					...current.ui,
					containerPath: [...(current.ui.containerPath ?? []), target.id],
					selectionIds: []
				}
			}));
			return;
		}

		const shapes = getInteractiveShapesOnCurrentPage(state);
		for (let index = shapes.length - 1; index >= 0; index--) {
			const shape = shapes[index];
			if (shape.type === 'text') {
				const bounds = shapeBoundsForState(state, shape);
				if (
					world.x >= bounds.min.x &&
					world.x <= bounds.max.x &&
					world.y >= bounds.min.y &&
					world.y <= bounds.max.y
				) {
					textEditor.start(shape.id);
					return;
				}
			}
			if (shape.type === 'arrow') {
				const bounds = shapeBoundsForState(state, shape);
				if (
					world.x >= bounds.min.x &&
					world.x <= bounds.max.x &&
					world.y >= bounds.min.y &&
					world.y <= bounds.max.y
				) {
					arrowLabelEditor.start(shape.id);
					return;
				}
			}
			if (shape.type === 'markdown') {
				const bounds = shapeBoundsForState(state, shape);
				if (
					world.x >= bounds.min.x &&
					world.x <= bounds.max.x &&
					world.y >= bounds.min.y &&
					world.y <= bounds.max.y
				) {
					markdownEditor.start(shape.id);
					return;
				}
			}
		}

		const clickedShape = shapes.some((shape) => {
			const bounds = shapeBoundsForState(state, shape);
			return (
				world.x >= bounds.min.x &&
				world.x <= bounds.max.x &&
				world.y >= bounds.min.y &&
				world.y <= bounds.max.y
			);
		});
		if (!clickedShape) {
			camera.reset();
		}
	}

	function handlePointerLeave() {
		setHandleHover(null);
		store.setState((state) =>
			state.ui.hoveredShapeId
				? { ...state, ui: { ...state.ui, hoveredShapeId: undefined } }
				: state
		);
	}

	function setCanvasRef(node: HTMLCanvasElement | null) {
		canvas = node;
		overlayViewport = measureViewport(node);
	}

	let canvasInitialized = false;

	$effect(() => {
		if (!canvas || canvasInitialized) return;

		canvasInitialized = true;

		renderer = createRenderer(canvas, store, {
			snapProvider: { get: () => snapStore.get() },
			cursorProvider: { get: () => cursorStore.getState() },
			pointerStateProvider: {
				get: () => ({
					isPointerDown: runtime.getInteractionState().pointerDown,
					snappedWorld: pointerState.snappedWorld,
					snapGuides: pointerState.snapGuides
				})
			},
			handleProvider: { get: () => handleState.getSnapshot() },
			themeProvider: { get: () => themeStore.current }
		});

		const unsubSnap = snapStore.subscribe(() => renderer?.markDirty());
		const redrawLoadedFonts = () => renderer?.markDirty();
		document.fonts.addEventListener('loadingdone', redrawLoadedFonts);
		void document.fonts.ready.then(redrawLoadedFonts);

		$effect(() => {
			if (themeStore.current) {
				renderer?.markDirty();
			}
		});

		inputAdapter = createInputAdapter({
			canvas,
			getCamera: () => store.getState().camera,
			getViewport,
			onAction: handleAction,
			onCursorUpdate: (world, screen) => cursorStore.updateCursor(world, screen)
		});

		const resizeObserver =
			typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize);
		resizeObserver?.observe(canvas);

		return () => {
			resizeObserver?.disconnect();
			unsubSnap();
			document.fonts.removeEventListener('loadingdone', redrawLoadedFonts);
			inputAdapter?.dispose();
			inputAdapter = null;
			renderer?.dispose();
			renderer = null;
			canvasInitialized = false;
		};
	});

	onMount(async () => {
		try {
			platformSession = await platformAdapter.connect();
			repo = platformSession.repo;
			sink = platformSession.sink;
			persistenceStatusStore = platformSession.status;
			desktopRepo = platformSession.desktop ?? null;
			if (desktopRepo) {
				proposal = desktopRepo.getProposal();
				unsubscribeProposal = desktopRepo.subscribeProposal((update) => {
					proposal = update.proposal;
					proposalMessage = update.message ?? null;
				});
				unsubscribeLiveDocument = desktopRepo.subscribeLiveDocument(applyLoadedDoc);
				unsubscribeAgentUi = desktopRepo.subscribeAgentUi((control) => {
					if (control.camera) camera.cancelFit();
					store.setState((state) => ({
						...state,
						camera: control.camera ?? state.camera,
						ui: {
							...state.ui,
							currentPageId: control.page_id ?? state.ui.currentPageId,
							activeLayerId: control.active_layer_id ?? state.ui.activeLayerId,
							selectionIds: control.selection_ids ?? state.ui.selectionIds
						}
					}));
					renderer?.markDirty();
				});
				unsubscribeAgentContext = store.subscribe(scheduleAgentContext);
				scheduleAgentContext();
			}
			unsubscribeFileMenu =
				platformSession.subscribeFileMenu?.((action) => {
					switch (action) {
						case 'new':
							void desktop.handleNew();
							break;
						case 'open':
							void desktop.handleOpen();
							break;
						case 'save-as':
							void desktop.handleSaveAs(() =>
								sink ? sink.flush() : Promise.resolve()
							);
							break;
						case 'import':
							void importEditableCanvas();
							break;
						case 'import-svg':
							void importSvg();
							break;
						case 'export-excalidraw':
							void exportEditableCanvas('excalidraw');
							break;
						case 'export-json-canvas':
							void exportEditableCanvas('json-canvas');
							break;
					}
				}) ?? null;

			if (platform === 'desktop') {
				if (desktopRepo) {
					await desktop.openDraft();
				}
			} else {
				const boards = await repo.listBoards();
				let boardId: string;

				if (boards.length > 0) {
					boardId = boards[0].id;
				} else {
					boardId = await repo.createBoard('Untitled Board');
				}

				const doc = await repo.loadDoc(boardId);
				setActiveBoardId(boardId);
				applyLoadedDoc(doc);

				removeBeforeUnload = () => {
					window.removeEventListener('beforeunload', handleBeforeUnload);
				};
				window.addEventListener('beforeunload', handleBeforeUnload);
			}
		} catch (error) {
			bindings.reportError(error, 'Open document failed');
		}
	});

	function handleBeforeUnload() {
		sink?.flush();
	}

	onDestroy(() => {
		renderer?.dispose();
		inputAdapter?.dispose();
		unsubscribeProposal?.();
		unsubscribeLiveDocument?.();
		unsubscribeAgentUi?.();
		unsubscribeAgentContext?.();
		if (agentContextTimer) clearTimeout(agentContextTimer);
		unsubscribeFileMenu?.();
		platformSession?.dispose?.();
		if (platform === 'desktop') {
			void sink
				?.flush()
				.then(() => desktopRepo?.closeSession())
				.catch((error: unknown) =>
					console.error('Failed to close desktop session', error)
				);
		}
		unsubscribeMarqueeCamera();
		removeBeforeUnload?.();
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', handleResize);
		}
		fallbackStatusStore.update(() => initialPersistenceStatus(platform));
		persistenceStatusStore = fallbackStatusStore;
	});

	function insertStencil(stencil: Stencil, worldPos: { x: number; y: number }) {
		const state = store.getState();
		const nextState = stencils.insertStencil(state, stencil, worldPos, snapStore.get());

		runtime.commit(
			state,
			nextState,
			'Insert Stencil',
			Action.keyDown('InsertStencil', 'InsertStencil', {
				ctrl: false,
				shift: false,
				alt: false,
				meta: false
			})
		);
	}

	return {
		platform: () => platform,
		activeBoardId: () => activeBoardId,
		desktop,
		fileBrowser,
		tools: toolController,
		history,
		camera,
		textEditor,
		arrowLabelEditor,
		markdownEditor,
		store,
		getViewport,
		handleAction,
		handleCanvasDoubleClick,
		handlePointerLeave,
		cursorStore,
		persistenceStatusStore: () => persistenceStatusStore,
		snapStore,
		brushStore,
		viewport: () => overlayViewport,
		setCanvasRef,
		marqueeRect: () => marqueeRect,
		proposal: () => proposal,
		proposalMessage: () => proposalMessage,
		acceptProposal: async (operationPositions?: number[]) => {
			if (!desktopRepo || !proposal) return Promise.reject(new Error('No proposal is open'));
			const doc = await desktopRepo.acceptProposal(proposal.id, operationPositions);
			applyLoadedDoc(doc);
		},
		rejectProposal: () => {
			if (!desktopRepo || !proposal) return Promise.reject(new Error('No proposal is open'));
			return desktopRepo.rejectProposal(proposal.id);
		},

		insertStencil,
		commitLayerState,
		importEditableCanvas,
		importSvg,
		createDocumentFromSvg,
		importSvgMarkup,
		importSvgFile,
		importImageFile,
		replaceImageFile,
		importDroppedFile,
		renderSvg,
		exportSvg,
		exportEditableCanvas,
		interchangeBusy: () => interchangeBusy,
		interchangeNotice: () => interchangeNotice,
		closeInterchangeNotice: () => (interchangeNotice = null),
		get stencilPaletteOpen() {
			return stencilPaletteOpen;
		},
		set stencilPaletteOpen(val: boolean) {
			stencilPaletteOpen = val;
		}
	};
}
