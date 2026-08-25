import type { CursorState, EditorState, SnapGuide, Store, Vec2, Viewport } from '@inkfinite/core';

/** Grid and snapping settings consumed by the Canvas renderer. */
export type SnapSettings = { snapEnabled: boolean; gridEnabled: boolean; gridSize: number };

/** Ephemeral pointer information used by snap guides and overlays. */
export type PointerVisualState = { isPointerDown: boolean; snappedWorld?: Vec2 | null; snapGuides?: SnapGuide[] };

/** Current hover and active state for editor handles. */
export type HandleRenderState = { hover: string | null; active: string | null } | null | undefined;

/** Platform-neutral providers used by the Canvas renderer. */
export type RendererOptions = {
	snapProvider?: { get(): SnapSettings };
	cursorProvider?: { get(): CursorState };
	pointerStateProvider?: { get(): PointerVisualState };
	handleProvider?: { get(): HandleRenderState };
	themeProvider?: { get(): 'light' | 'dark' };
};

/** Lifecycle controls for a Canvas renderer instance. */
export interface Renderer {
	/** Stop rendering and release subscriptions and renderer-owned resources. */
	dispose(): void;

	/** Schedule a redraw on the next animation frame. */
	markDirty(): void;
}

/** Inputs required to render one scene frame. */
export type SceneRenderOptions = {
	viewport: Viewport;
	snapSettings?: SnapSettings;
	cursorState?: CursorState;
	pointerState?: PointerVisualState;
	handleState?: HandleRenderState;
	theme: 'light' | 'dark';
	onImageLoaded: () => void;
};

/** State and drawing context shared by shape renderers. */
export type ShapeRenderState = {
	state: EditorState;
	context: CanvasRenderingContext2D;
	bindingsBySource: Map<string, import('@inkfinite/core').EditorBindingRecord[]>;
};

/** Canvas viewport dimensions in CSS pixels. */
export type CanvasViewport = Viewport;

/** Store type retained here to make renderer lifecycle dependencies explicit. */
export type RendererStore = Store;
