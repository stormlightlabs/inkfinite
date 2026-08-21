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
	diffDoc,
	EllipseTool,
	getInteractiveShapesOnCurrentPage,
	hitTestPoint,
	selectionTarget,
	LineTool,
	LayerRecord,
	exportInterchange,
	importInterchange,
	MarkdownTool,
	PageRecord,
	PenTool,
	RectTool,
	SelectTool,
	shapeBounds,
	SnapshotCommand,
	Store,
	TextTool
} from '@inkfinite/core';
import type {
	Box2,
	InterchangeFormat,
	InterchangeWarning,
	LoadedDoc,
	SvgExportOptions,
	PersistenceSink,
	PersistentDocRepo,
	Viewport
} from '@inkfinite/core';
import { stencils } from '@inkfinite/core';
import { Action, EditorRuntime } from '@inkfinite/runtime';
import { createRenderer, type Renderer } from '@inkfinite/renderer';
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

export type CanvasControllerBindings = { setHistoryViewerOpen(value: boolean): void };

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
	const initialPage = PageRecord.create('Page 1');
	const initialLayer = LayerRecord.create(initialPage.id, 'Default');
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
	const brushStore: BrushStore = createBrushStore();
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
		const cursor = computeCursor(
			textEditor.isEditing || arrowLabelEditor.isEditing || markdownEditor.isEditing,
			{
				isPanning: runtime.getInteractionState().panning,
				spaceHeld: runtime.getInteractionState().spaceHeld
			},
			{ hover: handleState.hover, active: handleState.active },
			runtime.getInteractionState().pointerDown
		);
		canvas.style.cursor = cursor === 'default' ? '' : cursor;
	}

	function setActiveBoardId(boardId: string) {
		activeBoardId = boardId;
		platformSession?.setActiveBoard?.(boardId);
	}

	function applyLoadedDoc(doc: LoadedDoc, fitDrawing = false, syncCanonical = true) {
		const firstPageId = doc.order.pageIds[0] ?? Object.keys(doc.pages)[0] ?? null;
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
		}));
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

	const selectTool = new SelectTool(handleMarqueeChange, (point) => {
		const snap = snapStore.get();
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
	});
	const directSelectTool = new DirectSelectTool();
	const rectTool = new RectTool();
	const ellipseTool = new EllipseTool();
	const lineTool = new LineTool();
	const arrowTool = new ArrowTool();
	const textTool = new TextTool();
	const markdownTool = new MarkdownTool();
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
		() => sink?.flush() ?? Promise.resolve()
	);
	const fileBrowser = new FileBrowserController(
		() => repo,
		(boardId, doc) => {
			setActiveBoardId(boardId);
			applyLoadedDoc(doc, true);
		},
		() => platformSession?.inspectBoard,
		() => sink?.flush() ?? Promise.resolve()
	);
	const runtime = new EditorRuntime({
		store,
		tools,
		selectionTool: selectTool,
		getSnapSettings: () => snapStore.get(),
		onTransactionDraft: ({ name, kind, before, after, topologyEdits }) => {
			// Tool movement renders `after` as a local preview. We want restore the
			// committed mirror before executing the command so history and persistence
			// receive the real before/after pair exactly once.
			store.setState(() => before);
			store.executeCommand(new SnapshotCommand(name, kind, before, after, topologyEdits));
			syncHandleState();
		},
		onBrowseRequested: () => fileBrowser.handleOpen(),
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

	async function importBrowserSvgSource(source: {
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
											'Embedded image nodes were omitted because image shapes are not available yet.',
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
				await importBrowserSvgSource({ name: source.name, contents: source.bytes });
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

	async function importBrowserSvgSourceWithStatus(
		source:
			| { name: string; contents: string | Uint8Array }
			| Promise<{ name: string; contents: string | Uint8Array }>
	) {
		if (platform !== 'web' || !platformSession?.interchange) return;
		interchangeBusy = true;
		try {
			await importBrowserSvgSource(await source);
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
		await importBrowserSvgSourceWithStatus({ name: 'pasted-svg.svg', contents });
	}

	async function importSvgFile(file: File) {
		await importBrowserSvgSourceWithStatus(
			file
				.arrayBuffer()
				.then((bytes) => ({ name: file.name, contents: new Uint8Array(bytes) }))
		);
	}

	async function exportSvg(selectedOnly: boolean) {
		const exportFunction = platformSession?.interchange?.exportSvg;
		if (!exportFunction || !activeBoardId || !repo || !sink || !platformSession?.interchange) {
			throw new Error('The browser SVG exporter is not available.');
		}
		interchangeBusy = true;
		try {
			await sink.flush();
			const snapshot = await repo.exportBoard(activeBoardId);
			const state = store.getState();
			const options: SvgExportOptions = {
				pageId: state.ui.currentPageId ?? undefined,
				selectionIds: selectedOnly ? [...state.ui.selectionIds] : [],
				selectionOnly: selectedOnly
			};
			const exported = await exportFunction(snapshot, options);
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
				const bounds = shapeBounds(shape);
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
				const bounds = shapeBounds(shape);
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
				const bounds = shapeBounds(shape);
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
			const bounds = shapeBounds(shape);
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
					snappedWorld: pointerState.snappedWorld
				})
			},
			handleProvider: { get: () => handleState.getSnapshot() },
			themeProvider: { get: () => themeStore.current }
		});

		const unsubSnap = snapStore.subscribe(() => renderer?.markDirty());

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
			inputAdapter?.dispose();
			inputAdapter = null;
			renderer?.dispose();
			renderer = null;
			canvasInitialized = false;
		};
	});

	onMount(async () => {
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
						void desktop.handleSaveAs(() => (sink ? sink.flush() : Promise.resolve()));
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
				.catch((error) => console.error('Failed to close desktop session', error));
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
		importSvgMarkup,
		importSvgFile,
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
