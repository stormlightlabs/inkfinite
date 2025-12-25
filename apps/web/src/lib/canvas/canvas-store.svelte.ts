import { createInputAdapter } from "$lib/input";
import type { InputAdapter } from "$lib/input";
import type { DesktopDocRepo } from "$lib/persistence/desktop";
import { createPlatformRepo, detectPlatform } from "$lib/platform";
import { createBrushStore, createPersistenceManager, createSnapStore, createStatusStore } from "$lib/status";
import type { BrushStore, SnapStore, StatusStore } from "$lib/status";
import {
  ArrowTool,
  Camera,
  createId,
  createToolMap,
  CursorStore,
  diffDoc,
  EditorState,
  EllipseTool,
  getShapesOnCurrentPage,
  InkfiniteDB,
  LineTool,
  MarkdownTool,
  PenTool,
  RectTool,
  routeAction,
  SelectTool,
  shapeBounds,
  ShapeRecord,
  SnapshotCommand,
  Store,
  TextTool,
} from "inkfinite-core";
import type { Action, Box2, LoadedDoc, PersistenceSink, PersistentDocRepo, Viewport } from "inkfinite-core";
import { createRenderer, type Renderer } from "inkfinite-renderer";
import { onDestroy, onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { computeCursor, describeAction, getCommandKind, statesEqual } from "./canvas-helpers";
import { ArrowLabelEditorController } from "./controllers/arrowlabel-controller.svelte";
import { DesktopFileController } from "./controllers/desktop-file-controller.svelte";
import { FileBrowserController } from "./controllers/filebrowser-controller.svelte";
import { HistoryController } from "./controllers/history-controller";
import { MarkdownEditorController } from "./controllers/markdown-controller.svelte";
import { TextEditorController } from "./controllers/texteditor-controller.svelte";
import { ToolController } from "./controllers/tool-controller.svelte";
import { HandleState } from "./store/handle-state.svelte";
import { PanState } from "./store/pan-state.svelte";
import { PointerState } from "./store/pointer-state.svelte";

export type CanvasControllerBindings = { setHistoryViewerOpen(value: boolean): void };

export type CanvasController = ReturnType<typeof createCanvasController>;

export function createCanvasController(bindings: CanvasControllerBindings) {
  let repo: PersistentDocRepo | null = null;
  let sink: PersistenceSink | null = null;
  let persistenceManager: ReturnType<typeof createPersistenceManager> | null = null;
  const platform = detectPlatform();
  const fallbackStatusStore = createStatusStore({
    backend: platform === "desktop" ? "filesystem" : "indexeddb",
    state: "saved",
    pendingWrites: 0,
  });
  let persistenceStatusStore = $state<StatusStore>(fallbackStatusStore);
  let activeBoardId: string | null = null;
  let desktopRepo: DesktopDocRepo | null = null;
  let removeBeforeUnload: (() => void) | null = null;
  const handleResize = () => {
    if (marqueeBounds) {
      updateMarquee(marqueeBounds);
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleResize);
  }
  let webDb: InkfiniteDB | null = null;
  let canvas = $state<HTMLCanvasElement | null>(null);

  const pointerState = new PointerState();
  const handleState = new HandleState();
  const panState = new PanState();

  const store = new Store(undefined, {
    onHistoryEvent: (event) => {
      if (!activeBoardId || event.kind !== "doc" || !sink) {
        return;
      }
      const patch = diffDoc(event.beforeState.doc, event.afterState.doc);
      sink.enqueueDocPatch(activeBoardId, patch);
    },
  });

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

  function getViewport(): Viewport {
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      return { width: rect.width || 1, height: rect.height || 1 };
    }
    if (typeof window !== "undefined") {
      return { width: window.innerWidth || 1, height: window.innerHeight || 1 };
    }
    return { width: 1, height: 1 };
  }

  function refreshCursor() {
    if (!canvas) {
      return;
    }
    const cursor = computeCursor(
      textEditor.isEditing || arrowLabelEditor.isEditing || markdownEditor.isEditing,
      { isPanning: panState.isPanning, spaceHeld: panState.spaceHeld },
      { hover: handleState.hover, active: handleState.active },
      pointerState.isPointerDown,
    );
    canvas.style.cursor = cursor;
  }

  function setActiveBoardId(boardId: string) {
    activeBoardId = boardId;
    persistenceManager?.setActiveBoard(boardId);
  }

  function applyLoadedDoc(doc: LoadedDoc) {
    const firstPageId = doc.order.pageIds[0] ?? Object.keys(doc.pages)[0] ?? null;
    store.setState((state) => ({
      ...state,
      doc: { pages: doc.pages, shapes: doc.shapes, bindings: doc.bindings },
      ui: { ...state.ui, currentPageId: firstPageId, selectionIds: [] },
    }));
  }

  const handleMarqueeChange = (bounds: Box2 | null) => {
    updateMarquee(bounds);
  };
  const selectTool = new SelectTool(handleMarqueeChange);
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
    penTool,
  ]);

  const textEditor = new TextEditorController(store, getViewport, refreshCursor);
  const arrowLabelEditor = new ArrowLabelEditorController(store, getViewport, refreshCursor);
  const markdownEditor = new MarkdownEditorController(store, getViewport, refreshCursor);
  const toolController = new ToolController(store, tools);
  const unsubscribeMarqueeCamera = store.subscribe((state) => {
    if (marqueeBounds) {
      updateMarquee(marqueeBounds, state.camera);
    }
  });
  const history = new HistoryController(bindings);
  const desktop = new DesktopFileController(() => repo, () => desktopRepo, (boardId, doc) => {
    setActiveBoardId(boardId);
    applyLoadedDoc(doc);
  });
  const fileBrowser = new FileBrowserController(() => repo);

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

  function applySnapping(action: Action): Action {
    if (!("world" in action) || !action.world) {
      return action;
    }
    const snap = snapStore.get();
    if (!snap.snapEnabled || !snap.gridEnabled) {
      return action;
    }
    const gridSize = snap.gridSize;
    const snappedX = Math.round(action.world.x / gridSize) * gridSize;
    const snappedY = Math.round(action.world.y / gridSize) * gridSize;
    return { ...action, world: { x: snappedX, y: snappedY } };
  }

  let pendingCommandStart: EditorState | null = null;

  function duplicateSelection(state: EditorState): EditorState | null {
    const selectedIds = state.ui.selectionIds;
    if (selectedIds.length === 0) {
      return null;
    }
    const shapes = { ...state.doc.shapes };
    const pages = { ...state.doc.pages };
    const nextSelection: string[] = [];

    for (const id of selectedIds) {
      const shape = shapes[id];
      if (!shape) continue;
      const cloned = ShapeRecord.clone(shape);
      const newId = createId("shape");
      const shifted = { ...cloned, id: newId, x: cloned.x + 12, y: cloned.y + 12 };
      shapes[newId] = shifted;
      const originalPage = state.doc.pages[shape.pageId];
      if (!originalPage) continue;
      const existingPage = pages[shape.pageId];
      const pageClone = !existingPage || existingPage === originalPage
        ? { ...originalPage, shapeIds: [...originalPage.shapeIds] }
        : { ...existingPage, shapeIds: [...existingPage.shapeIds] };
      pageClone.shapeIds.push(newId);
      pages[shape.pageId] = pageClone;
      nextSelection.push(newId);
    }

    if (!nextSelection.length) {
      return null;
    }

    return { ...state, doc: { ...state.doc, shapes, pages }, ui: { ...state.ui, selectionIds: nextSelection } };
  }

  function reorderSelection(state: EditorState, direction: "forward" | "backward"): EditorState | null {
    const pageId = state.ui.currentPageId;
    if (!pageId) return null;
    const page = state.doc.pages[pageId];
    if (!page) return null;
    const selection = new SvelteSet(state.ui.selectionIds);
    if (selection.size === 0) {
      return null;
    }

    const shapeIds = [...page.shapeIds];
    let changed = false;

    if (direction === "forward") {
      for (let index = shapeIds.length - 2; index >= 0; index--) {
        const id = shapeIds[index];
        if (!selection.has(id)) continue;
        const nextId = shapeIds[index + 1];
        if (nextId && !selection.has(nextId)) {
          shapeIds[index] = nextId;
          shapeIds[index + 1] = id;
          changed = true;
        }
      }
    } else {
      for (let index = 1; index < shapeIds.length; index++) {
        const id = shapeIds[index];
        if (!selection.has(id)) continue;
        const prevId = shapeIds[index - 1];
        if (prevId && !selection.has(prevId)) {
          shapeIds[index] = prevId;
          shapeIds[index - 1] = id;
          changed = true;
        }
      }
    }

    if (!changed) {
      return null;
    }

    return { ...state, doc: { ...state.doc, pages: { ...state.doc.pages, [pageId]: { ...page, shapeIds } } } };
  }

  function handleKeyboardShortcuts(state: EditorState, action: Action): EditorState | null {
    if (action.type !== "key-down") {
      return null;
    }

    const primaryModifier = action.modifiers.meta || action.modifiers.ctrl;

    if (primaryModifier && (action.key === "o" || action.key === "O")) {
      fileBrowser.handleOpen();
      return null;
    }

    if (primaryModifier && (action.key === "n" || action.key === "N")) {
      fileBrowser.handleOpen();
      return null;
    }

    const selectionIds = state.ui.selectionIds;
    if (selectionIds.length === 0) {
      return null;
    }

    if (action.key.startsWith("Arrow")) {
      const step = action.modifiers.shift ? 10 : 1;
      let dx = 0;
      let dy = 0;
      switch (action.key) {
        case "ArrowLeft":
          dx = -step;
          break;
        case "ArrowRight":
          dx = step;
          break;
        case "ArrowUp":
          dy = -step;
          break;
        case "ArrowDown":
          dy = step;
          break;
      }
      if (dx !== 0 || dy !== 0) {
        const shapes = { ...state.doc.shapes };
        let changed = false;
        for (const id of selectionIds) {
          const shape = shapes[id];
          if (!shape) continue;
          shapes[id] = { ...shape, x: shape.x + dx, y: shape.y + dy };
          changed = true;
        }
        if (!changed) {
          return null;
        }
        return { ...state, doc: { ...state.doc, shapes } };
      }
    }

    if (primaryModifier && (action.key === "d" || action.key === "D")) {
      return duplicateSelection(state);
    }
    if (primaryModifier && action.key === "]") {
      return reorderSelection(state, "forward");
    }
    if (primaryModifier && action.key === "[") {
      return reorderSelection(state, "backward");
    }

    return null;
  }

  function commitSnapshot(beforeState: EditorState, afterState: EditorState, action: Action) {
    const kind = getCommandKind(beforeState, afterState);
    const name = describeAction(action, kind);
    const command = new SnapshotCommand(name, kind, EditorState.clone(beforeState), EditorState.clone(afterState));
    store.executeCommand(command);
    syncHandleState();
  }

  function handleAction(action: Action) {
    if (textEditor.isEditing && (action.type === "pointer-down" || action.type === "pointer-up")) {
      textEditor.commit();
    }

    if (markdownEditor.isEditing && (action.type === "pointer-down" || action.type === "pointer-up")) {
      markdownEditor.commit();
    }

    if (action.type === "pointer-move" && "world" in action && !panState.isPanning && !panState.spaceHeld) {
      const hover = selectTool.getHandleAtPoint(store.getState(), action.world);
      setHandleHover(hover);
    }

    if (action.type === "key-down" && action.key === " " && !action.repeat) {
      panState.spaceHeld = true;
      refreshCursor();
      return;
    }

    if (action.type === "key-up" && action.key === " ") {
      panState.spaceHeld = false;
      panState.isPanning = false;
      refreshCursor();
      return;
    }

    if (action.type === "pointer-down" && (action.button === 1 || (action.button === 0 && panState.spaceHeld))) {
      panState.isPanning = true;
      panState.lastScreen = action.screen;
      refreshCursor();
      return;
    }

    if (action.type === "pointer-move" && panState.isPanning) {
      const delta = { x: action.screen.x - panState.lastScreen.x, y: action.screen.y - panState.lastScreen.y };
      panState.lastScreen = action.screen;
      store.setState((state) => ({ ...state, camera: Camera.pan(state.camera, delta) }));
      return;
    }

    if (action.type === "pointer-up" && panState.isPanning) {
      panState.isPanning = false;
      refreshCursor();
      return;
    }

    if (panState.isPanning || panState.spaceHeld) {
      return;
    }

    const actionWithSnap = applySnapping(action);
    if ("world" in actionWithSnap) {
      pointerState.snappedWorld = actionWithSnap.world;
    }

    if (actionWithSnap.type === "pointer-down" && actionWithSnap.button === 0) {
      pointerState.isPointerDown = true;
      setHandleHover(null);
      pendingCommandStart = EditorState.clone(store.getState());
    }

    const before = store.getState();
    const shortcutResult = handleKeyboardShortcuts(before, actionWithSnap);
    const after = shortcutResult ?? routeAction(before, actionWithSnap, tools);

    if (!statesEqual(before, after)) {
      const kind = getCommandKind(before, after);
      const shouldCommitImmediately = !pendingCommandStart && kind === "doc";

      if (shouldCommitImmediately) {
        commitSnapshot(before, after, actionWithSnap);
      } else {
        store.setState(() => after);
        syncHandleState();
      }
    }

    if (actionWithSnap.type === "pointer-up" && actionWithSnap.button === 0) {
      pointerState.isPointerDown = false;
      refreshCursor();

      if (pendingCommandStart && !statesEqual(pendingCommandStart, after)) {
        commitSnapshot(pendingCommandStart, after, actionWithSnap);
      }
      pendingCommandStart = null;
    }
  }

  function handleCanvasDoubleClick(event: MouseEvent) {
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = Camera.screenToWorld(store.getState().camera, screen, getViewport());

    const shapes = getShapesOnCurrentPage(store.getState());
    for (let index = shapes.length - 1; index >= 0; index--) {
      const shape = shapes[index];
      if (shape.type === "text") {
        const bounds = shapeBounds(shape);
        if (world.x >= bounds.min.x && world.x <= bounds.max.x && world.y >= bounds.min.y && world.y <= bounds.max.y) {
          textEditor.start(shape.id);
          return;
        }
      }
      if (shape.type === "arrow") {
        const bounds = shapeBounds(shape);
        if (world.x >= bounds.min.x && world.x <= bounds.max.x && world.y >= bounds.min.y && world.y <= bounds.max.y) {
          arrowLabelEditor.start(shape.id);
          return;
        }
      }
      if (shape.type === "markdown") {
        const bounds = shapeBounds(shape);
        if (world.x >= bounds.min.x && world.x <= bounds.max.x && world.y >= bounds.min.y && world.y <= bounds.max.y) {
          markdownEditor.start(shape.id);
          return;
        }
      }
    }
  }

  function handlePointerLeave() {
    setHandleHover(null);
  }

  function setCanvasRef(node: HTMLCanvasElement | null) {
    canvas = node;
  }

  let renderer: Renderer | null = null;
  let inputAdapter: InputAdapter | null = null;
  let canvasInitialized = false;

  $effect(() => {
    if (!canvas || canvasInitialized) return;

    canvasInitialized = true;

    renderer = createRenderer(canvas, store, {
      snapProvider: { get: () => snapStore.get() },
      cursorProvider: { get: () => cursorStore.getState() },
      pointerStateProvider: {
        get: () => ({ isPointerDown: pointerState.isPointerDown, snappedWorld: pointerState.snappedWorld }),
      },
      handleProvider: { get: () => handleState.getSnapshot() },
    });

    const unsubStore = store.subscribe(() => renderer?.markDirty());
    const unsubSnap = snapStore.subscribe(() => renderer?.markDirty());

    inputAdapter = createInputAdapter({
      canvas,
      getCamera: () => store.getState().camera,
      getViewport,
      onAction: handleAction,
      onCursorUpdate: (world, screen) => cursorStore.updateCursor(world, screen),
    });

    return () => {
      unsubStore();
      unsubSnap();
      inputAdapter?.dispose();
      inputAdapter = null;
      renderer?.dispose();
      renderer = null;
      canvasInitialized = false;
    };
  });

  onMount(async () => {
    if (platform === "desktop") {
      const desktopPlatformRepo = await createPlatformRepo();
      if (desktopPlatformRepo && "type" in desktopPlatformRepo && desktopPlatformRepo.type === "desktop") {
        desktopRepo = desktopPlatformRepo.repo as DesktopDocRepo;
        repo = desktopRepo;
        await desktop.refreshBoards();
      }
    } else {
      webDb = new InkfiniteDB();
      const { createWebDocRepo, createPersistenceSink } = await import("inkfinite-core");
      const { liveQuery } = await import("dexie");
      repo = createWebDocRepo(webDb);
      sink = createPersistenceSink(repo);
      persistenceManager = createPersistenceManager(webDb, repo, { liveQueryFn: liveQuery });
      persistenceStatusStore = persistenceManager.status;

      const boards = await repo.listBoards();
      if (boards.length > 0) {
        const boardId = boards[0].id;
        const doc = await repo.loadDoc(boardId);
        setActiveBoardId(boardId);
        applyLoadedDoc(doc);
      }

      removeBeforeUnload = () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
    }
  });

  function handleBeforeUnload() {
    sink?.flush();
  }

  onDestroy(() => {
    renderer?.dispose();
    inputAdapter?.dispose();
    persistenceManager?.dispose();
    unsubscribeMarqueeCamera();
    removeBeforeUnload?.();
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleResize);
    }
    fallbackStatusStore.update(() => ({ backend: "indexeddb", state: "saved", pendingWrites: 0 }));
    persistenceStatusStore = fallbackStatusStore;
  });

  return {
    platform: () => platform,
    desktop,
    fileBrowser,
    tools: toolController,
    history,
    textEditor,
    arrowLabelEditor,
    markdownEditor,
    store,
    getViewport,
    handleCanvasDoubleClick,
    handlePointerLeave,
    cursorStore,
    persistenceStatusStore: () => persistenceStatusStore,
    snapStore,
    brushStore,
    setCanvasRef,
    marqueeRect: () => marqueeRect,
  };
}
