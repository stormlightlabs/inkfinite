import type { Store, Viewport } from '@inkfinite/core';
import { drawScene } from './renderer/scene.js';
import { RendererResources } from './renderer/resources.js';
import type { Renderer, RendererOptions } from './renderer/types.js';

export type {
	CanvasViewport,
	HandleRenderState,
	PointerVisualState,
	Renderer,
	RendererOptions,
	SceneRenderOptions,
	ShapeRenderState,
	SnapSettings
} from './renderer/types.js';

/** Create a Canvas renderer with one lifecycle, scene traversal, and resource set. */
export function createRenderer(canvas: HTMLCanvasElement, store: Store, options?: RendererOptions): Renderer {
	const maybeContext = canvas.getContext('2d');
	if (!maybeContext) throw new Error('Failed to get 2D context from canvas');
	const context: CanvasRenderingContext2D = maybeContext;
	const resources = new RendererResources();

	let isDirty = true;
	let animationFrameId: number | null = null;
	let isDisposed = false;

	/** Schedule the latest state for one animation-frame render. */
	function markDirty(): void {
		if (isDisposed) return;
		isDirty = true;
		if (animationFrameId === null) scheduleRender();
	}

	function scheduleRender(): void {
		animationFrameId = requestAnimationFrame(() => {
			animationFrameId = null;
			if (!isDirty || isDisposed) return;
			isDirty = false;
			render();
		});
	}

	function render(): void {
		const state = store.getState();
		const viewport = setupCanvas(canvas, context);
		drawScene(
			context,
			state,
			viewport,
			options?.snapProvider?.get(),
			options?.cursorProvider?.get(),
			options?.pointerStateProvider?.get(),
			options?.handleProvider?.get(),
			options?.themeProvider?.get() ?? 'light',
			resources,
			markDirty
		);
	}

	const unsubscribe = store.subscribe(() => markDirty());

	/** Stop rendering and clear instance-owned caches. */
	function dispose(): void {
		isDisposed = true;
		unsubscribe();
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		resources.dispose();
	}

	markDirty();
	return { dispose, markDirty };
}

/** Resize the backing store and reset its transform before every frame. */
function setupCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): Viewport {
	const pixelRatio = getPixelRatio();
	const rect = canvas.getBoundingClientRect();
	const width = Math.max(1, Math.round(rect.width * pixelRatio));
	const height = Math.max(1, Math.round(rect.height * pixelRatio));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	return { width: rect.width || 1, height: rect.height || 1 };
}

function getPixelRatio(): number {
	return globalThis.window !== undefined && window.devicePixelRatio ? window.devicePixelRatio : 1;
}
