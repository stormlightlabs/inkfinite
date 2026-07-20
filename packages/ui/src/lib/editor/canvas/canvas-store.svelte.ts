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
	createToolMap,
	CursorStore,
	diffDoc,
	EllipseTool,
	getInteractiveShapesOnCurrentPage,
	LineTool,
	LayerRecord,
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
	LoadedDoc,
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
	let unsubscribeFileMenu: (() => void) | null = null;
	let removeBeforeUnload: (() => void) | null = null;
	let stencilPaletteOpen = $state(false);
	let overlayViewport = $state<Viewport>({ width: 1, height: 1 });
	let renderer: Renderer | null = null;
	let inputAdapter: InputAdapter | null = null;
	const initialPage = PageRecord.create('Page 1');
	const initialLayer = LayerRecord.create(initialPage.id, 'Default');
	const handleResize = () => {
		overlayViewport = measureViewport(canvas);
		if (marqueeBounds) {
			updateMarquee(marqueeBounds);
		}
		renderer?.markDirty();
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
				const patch = diffDoc(event.beforeState.doc, event.afterState.doc);
				sink.enqueueDocPatch(activeBoardId, patch);
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

	function applyLoadedDoc(doc: LoadedDoc) {
		const firstPageId = doc.order.pageIds[0] ?? Object.keys(doc.pages)[0] ?? null;
		store.setState((state) => ({
			...state,
			doc: {
				pages: doc.pages,
				layers: doc.layers ?? doc.order.layers,
				shapes: doc.shapes,
				bindings: doc.bindings
			},
			ui: { ...state.ui, currentPageId: firstPageId, selectionIds: [] }
		}));
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
			applyLoadedDoc(doc);
		},
		() => activeBoardId
	);
	const fileBrowser = new FileBrowserController(
		() => repo,
		(boardId, doc) => {
			setActiveBoardId(boardId);
			applyLoadedDoc(doc);
		},
		() => platformSession?.inspectBoard
	);
	const runtime = new EditorRuntime({
		store,
		tools,
		selectionTool: selectTool,
		getSnapSettings: () => snapStore.get(),
		onTransactionDraft: ({ name, kind, before, after }) => {
			// Tool movement renders `after` as a local preview. Restore the durable
			// mirror before executing the command so history and persistence receive
			// the real before/after pair exactly once.
			store.setState(() => before);
			store.executeCommand(new SnapshotCommand(name, kind, before, after));
			syncHandleState();
		},
		onOpenRequested: () => fileBrowser.handleOpen(),
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
		handleState.active = selectTool.getActiveHandle ? selectTool.getActiveHandle() : null;
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

	function handleCanvasDoubleClick(event: MouseEvent) {
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		const world = Camera.screenToWorld(store.getState().camera, screen, getViewport());

		const shapes = getInteractiveShapesOnCurrentPage(store.getState());
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
						void desktop.handleSaveAs();
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
		setCanvasRef,
		marqueeRect: () => marqueeRect,
		proposal: () => proposal,
		proposalMessage: () => proposalMessage,
		acceptProposal: (operationPositions?: number[]) => {
			if (!desktopRepo || !proposal) return Promise.reject(new Error('No proposal is open'));
			return desktopRepo.acceptProposal(proposal.id, operationPositions);
		},
		rejectProposal: () => {
			if (!desktopRepo || !proposal) return Promise.reject(new Error('No proposal is open'));
			return desktopRepo.rejectProposal(proposal.id);
		},
		authorizeApply: () => {
			if (!desktopRepo) return Promise.reject(new Error('No desktop session is open'));
			return desktopRepo.authorizeApply();
		},
		insertStencil,
		commitLayerState,
		get stencilPaletteOpen() {
			return stencilPaletteOpen;
		},
		set stencilPaletteOpen(val: boolean) {
			stencilPaletteOpen = val;
		}
	};

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
}
