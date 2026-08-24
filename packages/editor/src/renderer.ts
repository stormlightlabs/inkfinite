import type {
	ArrowLabel,
	ArrowShape,
	BindingIndex,
	BindingRecord,
	Camera,
	CursorState,
	EditorState,
	EllipseShape,
	FilterEffect,
	LineShape,
	MarkdownShape,
	PathGeometry,
	PathShape,
	RectShape,
	ShapeRecord,
	Store,
	StrokeShape,
	TextShape,
	Vec2,
	Viewport,
	SnapGuide
} from '@inkfinite/core';
import {
	paintForCanvas,
	arrowBendHandleForShape,
	arrowGeometryForShape,
	arrowHeadGeometry,
	arrowLabelPlacement,
	arrowPathForShape,
	arrowShaftGeometry,
	getLayersOnCurrentPage,
	getStrokeOutline,
	getShapesOnCurrentPage,
	localToWorld,
	localShapeBounds,
	pathAnchorPosition,
	pathAnchorRefs,
	pathGeometryBounds,
	pathControlHandles,
	resolveArrowEndpoints,
	shapeBounds,
	shapeTransform,
	worldToLocal,
	pathAnchorHandleId,
	pathControlHandleId
} from '@inkfinite/core';

export interface Renderer {
	/**
	 * Clean up the renderer and stop rendering
	 */
	dispose(): void;

	/**
	 * Force a redraw on the next frame
	 */
	markDirty(): void;
}

export type SnapSettings = { snapEnabled: boolean; gridEnabled: boolean; gridSize: number };

export type PointerVisualState = { isPointerDown: boolean; snappedWorld?: Vec2 | null; snapGuides?: SnapGuide[] };

export type HandleRenderState = { hover: string | null; active: string | null } | null | undefined;

export type RendererOptions = {
	snapProvider?: { get(): SnapSettings };
	cursorProvider?: { get(): CursorState };
	pointerStateProvider?: { get(): PointerVisualState };
	handleProvider?: { get(): HandleRenderState };
	themeProvider?: { get(): 'light' | 'dark' };
};

const imageCache = new Map<string, HTMLImageElement>();

class LruCache<Key, Value> {
	readonly #entries = new Map<Key, Value>();

	constructor(private readonly capacity: number) {}

	get(key: Key): Value | undefined {
		const value = this.#entries.get(key);
		if (value === undefined) return undefined;
		this.#entries.delete(key);
		this.#entries.set(key, value);
		return value;
	}

	set(key: Key, value: Value): void {
		this.#entries.delete(key);
		this.#entries.set(key, value);
		if (this.#entries.size <= this.capacity) return;
		const oldestKey = this.#entries.keys().next().value;
		if (oldestKey !== undefined) this.#entries.delete(oldestKey);
	}
}

/**
 * Create a canvas renderer
 *
 * The renderer subscribes to the store and redraws the canvas
 * whenever the state changes. It uses requestAnimationFrame with
 * a dirty flag to optimize rendering.
 *
 * @param canvas - The HTMLCanvasElement to render to
 * @param store - The editor state store
 * @param gridProvider - Optional provider for grid settings (snap store)
 * @returns Renderer instance with dispose method
 */
export function createRenderer(canvas: HTMLCanvasElement, store: Store, options?: RendererOptions): Renderer {
	const maybeContext = canvas.getContext('2d');
	if (!maybeContext) {
		throw new Error('Failed to get 2D context from canvas');
	}
	const context: CanvasRenderingContext2D = maybeContext;

	let isDirty = true;
	let animationFrameId: number | null = null;
	let isDisposed = false;
	const textLayoutCache = new LruCache<string, string[]>(512);
	const textMetricCache = new LruCache<string, number>(2_048);
	const markdownLayoutCache = new LruCache<string, MarkdownLine[]>(256);

	/**
	 * Mark the canvas as needing a redraw
	 */
	function markDirty() {
		if (isDisposed) return;
		isDirty = true;
		if (animationFrameId === null) {
			scheduleRender();
		}
	}

	/**
	 * Schedule a render on the next animation frame
	 */
	function scheduleRender() {
		animationFrameId = requestAnimationFrame(() => {
			animationFrameId = null;
			if (isDirty && !isDisposed) {
				isDirty = false;
				render();
			}
		});
	}

	/**
	 * Render the current state to the canvas
	 */
	function render() {
		const state = store.getState();

		const viewport = setupCanvas(canvas, context);

		const snapSettings = options?.snapProvider?.get();
		const cursorState = options?.cursorProvider?.get();
		const pointerState = options?.pointerStateProvider?.get();
		const handleState = options?.handleProvider?.get();
		const theme = options?.themeProvider?.get() ?? 'light';
		drawScene(
			context,
			state,
			viewport,
			snapSettings,
			cursorState,
			pointerState,
			handleState,
			theme,
			textLayoutCache,
			textMetricCache,
			markdownLayoutCache,
			markDirty
		);
	}

	/**
	 * Subscribe to store updates and mark dirty
	 */
	const unsubscribe = store.subscribe(() => {
		markDirty();
	});

	/**
	 * Dispose the renderer
	 */
	function dispose() {
		isDisposed = true;
		unsubscribe();
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	}

	markDirty();

	return { dispose, markDirty };
}

/**
 * Setup canvas with proper pixel ratio for sharp rendering
 */
function setupCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): Viewport {
	const pixelRatio = getPixelRatio();
	const rect = canvas.getBoundingClientRect();
	const width = Math.max(1, Math.round(rect.width * pixelRatio));
	const height = Math.max(1, Math.round(rect.height * pixelRatio));

	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}

	// Canvas state survives between frames. Establish the backing-store transform
	// explicitly so a previous camera transform can never leak into the next draw.
	context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

	return { width: rect.width || 1, height: rect.height || 1 };
}

/**
 * Get device pixel ratio for sharp rendering on high-DPI displays
 */
function getPixelRatio(): number {
	return globalThis.window !== undefined && window.devicePixelRatio ? window.devicePixelRatio : 1;
}

/**
 * Draw the entire scene
 */
function drawScene(
	context: CanvasRenderingContext2D,
	state: EditorState,
	viewport: Viewport,
	snapSettings?: SnapSettings,
	cursorState?: CursorState,
	pointerState?: PointerVisualState,
	handleState?: HandleRenderState,
	theme: 'light' | 'dark' = 'light',
	textLayoutCache = new LruCache<string, string[]>(512),
	textMetricCache = new LruCache<string, number>(2_048),
	markdownLayoutCache = new LruCache<string, MarkdownLine[]>(256),
	onImageLoaded?: () => void
) {
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	context.restore();

	context.save();

	applyCameraTransform(context, state.camera, viewport);

	drawGrid(context, state.camera, viewport, snapSettings, theme);

	const shapes = getShapesOnCurrentPage(state);
	const bindingsBySource = new Map<string, BindingRecord[]>();
	for (const binding of Object.values(state.doc.bindings)) {
		const bindings = bindingsBySource.get(binding.fromShapeId);
		if (bindings) bindings.push(binding);
		else bindingsBySource.set(binding.fromShapeId, [binding]);
	}
	const visibleBounds = getExpandedViewportBounds(state.camera, viewport);
	const layers = getLayersOnCurrentPage(state);
	if (layers.length === 0) {
		for (const shape of shapes) {
			if (!isShapeVisible(state, shape, visibleBounds, bindingsBySource)) continue;
			drawShape(
				context,
				state,
				shape,
				bindingsBySource,
				theme,
				textLayoutCache,
				textMetricCache,
				markdownLayoutCache,
				onImageLoaded
			);
		}
	} else {
		for (const layer of layers) {
			if (!layer.visible) continue;
			context.save();
			context.globalAlpha *= layer.opacity;
			for (const shapeId of layer.shapeIds) {
				const shape = state.doc.shapes[shapeId];
				if (!shape || !isShapeVisible(state, shape, visibleBounds, bindingsBySource)) continue;
				drawShape(
					context,
					state,
					shape,
					bindingsBySource,
					theme,
					textLayoutCache,
					textMetricCache,
					markdownLayoutCache,
					onImageLoaded
				);
			}
			context.restore();
		}
	}

	drawSelection(context, state, shapes, handleState, bindingsBySource, theme);

	drawBindingPreview(context, state);

	drawSnapGuides(context, state.camera, viewport, snapSettings, cursorState, pointerState);

	context.restore();
}

type VisibleBounds = { minX: number; minY: number; maxX: number; maxY: number };

function getExpandedViewportBounds(camera: Camera, viewport: Viewport): VisibleBounds {
	const padding = 48 / camera.zoom;
	const halfWidth = viewport.width / (2 * camera.zoom);
	const halfHeight = viewport.height / (2 * camera.zoom);
	return {
		minX: camera.x - halfWidth - padding,
		minY: camera.y - halfHeight - padding,
		maxX: camera.x + halfWidth + padding,
		maxY: camera.y + halfHeight + padding
	};
}

function isShapeVisible(
	state: EditorState,
	shape: ShapeRecord,
	viewport: VisibleBounds,
	bindingsBySource?: BindingIndex
): boolean {
	if (shape.type === 'arrow') {
		const points = arrowPathForShape(state, shape, bindingsBySource);
		if (points.length >= 2) {
			const worldPoints = points.map((point) => localToWorld(shape, point));
			const minX = Math.min(...worldPoints.map((point) => point.x));
			const minY = Math.min(...worldPoints.map((point) => point.y));
			const maxX = Math.max(...worldPoints.map((point) => point.x));
			const maxY = Math.max(...worldPoints.map((point) => point.y));
			return maxX >= viewport.minX && minX <= viewport.maxX && maxY >= viewport.minY && minY <= viewport.maxY;
		}
	}

	const bounds = shapeBounds(shape);
	return (
		bounds.max.x >= viewport.minX &&
		bounds.min.x <= viewport.maxX &&
		bounds.max.y >= viewport.minY &&
		bounds.min.y <= viewport.maxY
	);
}

/**
 * Apply camera transform to the canvas context
 *
 * This transforms the coordinate system so that drawing in world
 * coordinates appears correctly on screen.
 */
function applyCameraTransform(context: CanvasRenderingContext2D, camera: Camera, viewport: Viewport) {
	context.translate(viewport.width / 2, viewport.height / 2);

	context.scale(camera.zoom, camera.zoom);

	context.translate(-camera.x, -camera.y);
}

/**
 * Default grid size in world units
 * This must match the default in the snap store to ensure grid lines and snapping align
 */
const DEFAULT_GRID_SIZE = 25;

/**
 * Draw a dot-grid background at the same world-space positions used by snapping.
 *
 * At distant zoom levels, the renderer skips intermediate dots so the grid
 * stays legible without changing the snapping interval.
 */
function drawGrid(
	context: CanvasRenderingContext2D,
	camera: Camera,
	viewport: Viewport,
	snapSettings?: SnapSettings,
	theme: 'light' | 'dark' = 'light'
) {
	if (snapSettings && !snapSettings.gridEnabled) {
		return;
	}
	const gridSize = snapSettings?.gridSize ?? DEFAULT_GRID_SIZE;
	const minimumScreenSpacing = 10;
	const stepMultiplier = Math.max(1, Math.ceil(minimumScreenSpacing / (gridSize * camera.zoom)));
	const visibleGridSize = gridSize * stepMultiplier;

	const topLeft = {
		x: camera.x - viewport.width / (2 * camera.zoom),
		y: camera.y - viewport.height / (2 * camera.zoom)
	};
	const bottomRight = {
		x: camera.x + viewport.width / (2 * camera.zoom),
		y: camera.y + viewport.height / (2 * camera.zoom)
	};

	const startX = Math.floor(topLeft.x / visibleGridSize) * visibleGridSize;
	const endX = Math.ceil(bottomRight.x / visibleGridSize) * visibleGridSize;
	const startY = Math.floor(topLeft.y / visibleGridSize) * visibleGridSize;
	const endY = Math.ceil(bottomRight.y / visibleGridSize) * visibleGridSize;
	const dotRadius = 1.25 / camera.zoom;

	context.fillStyle = theme === 'dark' ? 'rgba(167, 180, 188, 0.38)' : 'rgba(73, 80, 99, 0.32)';
	context.beginPath();
	for (let x = startX; x <= endX; x += visibleGridSize) {
		for (let y = startY; y <= endY; y += visibleGridSize) {
			context.moveTo(x + dotRadius, y);
			context.arc(x, y, dotRadius, 0, Math.PI * 2);
		}
	}
	context.fill();
}

function drawSnapGuides(
	context: CanvasRenderingContext2D,
	camera: Camera,
	viewport: Viewport,
	snapSettings?: SnapSettings,
	cursorState?: CursorState,
	pointerState?: PointerVisualState
) {
	if (!snapSettings?.snapEnabled || !pointerState?.isPointerDown) {
		return;
	}

	const gridSize = snapSettings?.gridSize ?? DEFAULT_GRID_SIZE;
	const guideWorld = pointerState.snappedWorld ?? cursorState?.cursorWorld;
	if (!guideWorld) {
		return;
	}

	const snappedX = pointerState.snappedWorld
		? pointerState.snappedWorld.x
		: Math.round(guideWorld.x / gridSize) * gridSize;
	const snappedY = pointerState.snappedWorld
		? pointerState.snappedWorld.y
		: Math.round(guideWorld.y / gridSize) * gridSize;

	const guides = pointerState.snapGuides ?? [];
	if (guides.length === 0 && !snapSettings.gridEnabled) return;
	if (guides.length > 0) {
		const halfWidth = viewport.width / (2 * camera.zoom);
		const halfHeight = viewport.height / (2 * camera.zoom);
		context.save();
		context.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
		context.lineWidth = 1 / camera.zoom;
		context.strokeStyle = 'rgba(236, 72, 153, 0.82)';
		for (const guide of guides) {
			const start = guide.start ?? (guide.axis === 'x' ? camera.y - halfHeight : camera.x - halfWidth);
			const end = guide.end ?? (guide.axis === 'x' ? camera.y + halfHeight : camera.x + halfWidth);
			context.beginPath();
			if (guide.axis === 'x') {
				context.moveTo(guide.position, start);
				context.lineTo(guide.position, end);
			} else {
				context.moveTo(start, guide.position);
				context.lineTo(end, guide.position);
			}
			context.stroke();
		}
		context.restore();
		return;
	}

	const halfWidth = viewport.width / (2 * camera.zoom);
	const halfHeight = viewport.height / (2 * camera.zoom);
	const minX = camera.x - halfWidth;
	const maxX = camera.x + halfWidth;
	const minY = camera.y - halfHeight;
	const maxY = camera.y + halfHeight;

	context.save();
	const dashLength = 4 / camera.zoom;
	context.setLineDash([dashLength, dashLength]);
	context.lineWidth = 1 / camera.zoom;
	context.strokeStyle = 'rgba(59, 130, 246, 0.6)';

	context.beginPath();
	context.moveTo(minX, snappedY);
	context.lineTo(maxX, snappedY);
	context.stroke();

	context.beginPath();
	context.moveTo(snappedX, minY);
	context.lineTo(snappedX, maxY);
	context.stroke();

	context.setLineDash([]);
	context.fillStyle = 'rgba(59, 130, 246, 0.6)';
	context.beginPath();
	context.arc(snappedX, snappedY, 4 / camera.zoom, 0, Math.PI * 2);
	context.fill();

	context.restore();
}

/**
 * Draw binding preview indicator when dragging arrow endpoints
 */
function drawBindingPreview(context: CanvasRenderingContext2D, state: EditorState) {
	if (!state.ui.bindingPreview) return;

	const targetShape = state.doc.shapes[state.ui.bindingPreview.targetShapeId];
	if (!targetShape) return;

	const bounds = shapeBounds(targetShape);

	context.save();
	context.strokeStyle = 'rgba(59, 130, 246, 0.8)';
	context.lineWidth = 3 / state.camera.zoom;
	context.setLineDash([8 / state.camera.zoom, 4 / state.camera.zoom]);

	const padding = 4;
	context.strokeRect(
		bounds.min.x - padding,
		bounds.min.y - padding,
		bounds.max.x - bounds.min.x + padding * 2,
		bounds.max.y - bounds.min.y + padding * 2
	);

	context.setLineDash([]);
	context.restore();
}

/**
 * Draw a single shape
 */
function drawShape(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: ShapeRecord,
	bindingsBySource?: BindingIndex,
	theme: 'light' | 'dark' = 'light',
	textLayoutCache = new LruCache<string, string[]>(512),
	textMetricCache = new LruCache<string, number>(2_048),
	markdownLayoutCache = new LruCache<string, MarkdownLine[]>(256),
	onImageLoaded?: () => void
) {
	context.save();
	context.globalAlpha *= shape.opacity ?? 1;

	applyShapeTransform(context, shape);
	applyShapeEffects(context, shape);

	switch (shape.type) {
		case 'rect': {
			drawRect(context, shape);
			break;
		}
		case 'ellipse': {
			drawEllipse(context, shape);
			break;
		}
		case 'line': {
			drawLine(context, shape);
			break;
		}
		case 'arrow': {
			drawArrow(context, state, shape, bindingsBySource);
			break;
		}
		case 'text': {
			drawText(context, shape, textLayoutCache, textMetricCache);
			break;
		}
		case 'markdown': {
			drawMarkdown(context, shape, theme, textLayoutCache, textMetricCache, markdownLayoutCache);
			break;
		}
		case 'image': {
			drawImage(context, state, shape, onImageLoaded);
			break;
		}
		case 'reference': {
			drawReference(context, shape);
			break;
		}
		case 'stroke': {
			drawStroke(context, shape);
			break;
		}
		case 'path': {
			drawPath(context, shape);
			break;
		}
		case 'container': {
			drawContainer(context, shape);
			break;
		}
	}

	context.restore();
}

/** Apply the native clip, mask, and filter subset before drawing one shape. */
function applyShapeEffects(context: CanvasRenderingContext2D, shape: ShapeRecord) {
	const props = shape.props as ShapeRecord['props'] & {
		clipPath?: PathGeometry;
		maskEffect?: { geometry: PathGeometry; opacity?: number };
		filter?: {
			primitives: Array<
				| { type: 'blur'; radius: number }
				| { type: 'brightness'; amount: number }
				| { type: 'contrast'; amount: number }
				| { type: 'grayscale'; amount: number }
				| { type: 'hue_rotate'; degrees: number }
				| { type: 'invert'; amount: number }
				| { type: 'saturate'; amount: number }
				| { type: 'sepia'; amount: number }
				| { type: 'opacity'; amount: number }
				| { type: 'drop_shadow'; dx: number; dy: number; radius: number; color: string; opacity: number }
			>;
		};
	};
	if (props.filter) context.filter = filterToCanvas(props.filter);
	if (props.clipPath) {
		drawNativePath(context, props.clipPath);
		context.clip(props.clipPath.fill_rule === 'evenodd' ? 'evenodd' : 'nonzero');
	}
	if (props.maskEffect) {
		context.globalAlpha *= props.maskEffect.opacity ?? 1;
		drawNativePath(context, props.maskEffect.geometry);
		context.clip(props.maskEffect.geometry.fill_rule === 'evenodd' ? 'evenodd' : 'nonzero');
	}
}

function filterToCanvas(filter: FilterEffect): string {
	return filter.primitives
		.map((primitive) => {
			switch (primitive.type) {
				case 'blur':
					return `blur(${Math.max(0, primitive.radius)}px)`;
				case 'brightness':
					return `brightness(${Math.max(0, primitive.amount)})`;
				case 'contrast':
					return `contrast(${Math.max(0, primitive.amount)})`;
				case 'grayscale':
					return `grayscale(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'hue_rotate':
					return `hue-rotate(${primitive.degrees}deg)`;
				case 'invert':
					return `invert(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'saturate':
					return `saturate(${Math.max(0, primitive.amount)})`;
				case 'sepia':
					return `sepia(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'opacity':
					return `opacity(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'drop_shadow':
					return `drop-shadow(${primitive.dx}px ${primitive.dy}px ${Math.max(0, primitive.radius)}px ${primitive.color})`;
			}
		})
		.join(' ');
}

/** Draw an embedded image, preserving its crop window when one is set. */
function drawImage(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: Extract<ShapeRecord, { type: 'image' }>,
	onImageLoaded?: () => void
) {
	const asset = state.doc.assets?.[shape.props.assetId];
	const { w, h, crop, mask, caption } = shape.props;
	context.globalAlpha *= shape.fillOpacity ?? 1;
	if (!asset) {
		context.fillStyle = '#e5e7eb';
		context.fillRect(0, 0, w, h);
		return;
	}
	let image = imageCache.get(asset.digest);
	if (!image && typeof Image !== 'undefined') {
		image = new Image();
		image.onload = () => onImageLoaded?.();
		image.src = `data:${asset.mediaType};base64,${bytesToBase64(asset.bytes)}`;
		imageCache.set(asset.digest, image);
	}
	if (!image || !image.complete || image.naturalWidth === 0) {
		context.fillStyle = '#e5e7eb';
		context.fillRect(0, 0, w, h);
		context.strokeStyle = '#9ca3af';
		context.strokeRect(0, 0, w, h);
		return;
	}
	const top = crop?.top ?? 0;
	const right = crop?.right ?? 0;
	const bottom = crop?.bottom ?? 0;
	const left = crop?.left ?? 0;
	const sourceX = image.naturalWidth * left;
	const sourceY = image.naturalHeight * top;
	const sourceWidth = image.naturalWidth * Math.max(0.001, 1 - left - right);
	const sourceHeight = image.naturalHeight * Math.max(0.001, 1 - top - bottom);
	context.save();
	if (mask?.kind === 'ellipse') {
		context.beginPath();
		context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
		context.clip();
	} else if (mask?.kind === 'rounded') {
		const radius = Math.min(mask.radius ?? 16, w / 2, h / 2);
		context.beginPath();
		context.roundRect(0, 0, w, h, radius);
		context.clip();
	}
	context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, w, h);
	context.restore();
	if (caption?.trim()) {
		const captionHeight = Math.min(24, h);
		context.fillStyle = 'rgba(0, 0, 0, 0.58)';
		context.fillRect(0, h - captionHeight, w, captionHeight);
		context.fillStyle = '#ffffff';
		context.font = '12px sans-serif';
		context.textBaseline = 'middle';
		context.fillText(caption, 8, h - captionHeight / 2, Math.max(0, w - 16));
	}
}

function drawReference(context: CanvasRenderingContext2D, shape: Extract<ShapeRecord, { type: 'reference' }>) {
	const { w, h, referenceType, value, label } = shape.props;
	const accent = referenceType === 'url' ? '#2563eb' : referenceType === 'file' ? '#16a34a' : '#7c3aed';
	context.fillStyle = '#f8fafc';
	context.strokeStyle = accent;
	context.lineWidth = 2;
	context.beginPath();
	context.roundRect(0, 0, w, h, 8);
	context.fill();
	context.stroke();
	context.fillStyle = accent;
	context.font = '600 12px sans-serif';
	context.fillText(referenceType.toUpperCase(), 12, 20);
	context.fillStyle = '#1f2937';
	context.font = '13px sans-serif';
	context.fillText(label || value, 12, 42, Math.max(0, w - 24));
}

function bytesToBase64(bytes: number[]): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return typeof btoa === 'function' ? btoa(binary) : '';
}

/**
 * Draw a rectangle shape
 */
function drawRect(context: CanvasRenderingContext2D, shape: RectShape) {
	const { w, h, fill, stroke, radius } = shape.props;
	const shapeAlpha = context.globalAlpha;

	context.beginPath();
	if (radius > 0) {
		const r = Math.min(radius, w / 2, h / 2);
		context.moveTo(r, 0);
		context.lineTo(w - r, 0);
		context.arcTo(w, 0, w, r, r);
		context.lineTo(w, h - r);
		context.arcTo(w, h, w - r, h, r);
		context.lineTo(r, h);
		context.arcTo(0, h, 0, h - r, r);
		context.lineTo(0, r);
		context.arcTo(0, 0, r, 0, r);
		context.closePath();
	} else {
		context.rect(0, 0, w, h);
	}

	if (fill) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, { x: 0, y: 0, width: w, height: h });
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill();
		}
	}

	if (stroke) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h });
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = 2;
			context.stroke();
		}
	}
}

/**
 * Draw an ellipse shape
 */
function drawEllipse(context: CanvasRenderingContext2D, shape: EllipseShape) {
	const { w, h, fill, stroke } = shape.props;
	const shapeAlpha = context.globalAlpha;

	context.beginPath();
	context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);

	if (fill) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, { x: 0, y: 0, width: w, height: h });
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill();
		}
	}

	if (stroke) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h });
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = 2;
			context.stroke();
		}
	}
}

/**
 * Draw a line shape
 */
function drawLine(context: CanvasRenderingContext2D, shape: LineShape) {
	const { a, b, stroke, width } = shape.props;

	context.beginPath();
	context.moveTo(a.x, a.y);
	context.lineTo(b.x, b.y);

	context.globalAlpha *= shape.strokeOpacity ?? 1;
	const strokeStyle = paintForCanvas(context, stroke, {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(b.x - a.x),
		height: Math.abs(b.y - a.y)
	});
	if (strokeStyle) {
		context.strokeStyle = strokeStyle;
		context.lineWidth = width;
		context.stroke();
	}
}

function drawContainer(context: CanvasRenderingContext2D, shape: Extract<ShapeRecord, { type: 'container' }>) {
	const { w = 0, h = 0, title, fill, stroke, radius = 0 } = shape.props;
	const shapeAlpha = context.globalAlpha;
	context.beginPath();
	if (radius > 0) {
		const r = Math.min(radius, w / 2, h / 2);
		context.moveTo(r, 0);
		context.lineTo(w - r, 0);
		context.arcTo(w, 0, w, r, r);
		context.lineTo(w, h - r);
		context.arcTo(w, h, w - r, h, r);
		context.lineTo(r, h);
		context.arcTo(0, h, 0, h - r, r);
		context.lineTo(0, r);
		context.arcTo(0, 0, r, 0, r);
		context.closePath();
	} else {
		context.rect(0, 0, w, h);
	}
	if (fill) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, { x: 0, y: 0, width: w, height: h });
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill();
		}
	}
	if (stroke) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h });
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = 1.5;
			context.stroke();
		}
	}
	if (title) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		context.fillStyle = paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h }) ?? '#69717d';
		context.font = '600 14px sans-serif';
		context.textBaseline = 'top';
		context.fillText(title, 8, 6);
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		context.strokeStyle =
			paintForCanvas(context, stroke, { x: 0, y: 0, width: w, height: h }) ?? 'rgba(37, 99, 235, 0.45)';
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(0, 26);
		context.lineTo(w, 26);
		context.stroke();
	}
}

function drawNativePath(context: CanvasRenderingContext2D, geometry: PathGeometry) {
	context.beginPath();
	for (const subpath of geometry.subpaths) {
		for (const segment of subpath.segments) {
			switch (segment.type) {
				case 'move':
					context.moveTo(segment.to.x, segment.to.y);
					break;
				case 'line':
					context.lineTo(segment.to.x, segment.to.y);
					break;
				case 'quadratic':
					context.quadraticCurveTo(segment.control.x, segment.control.y, segment.to.x, segment.to.y);
					break;
				case 'cubic':
					context.bezierCurveTo(
						segment.control_1.x,
						segment.control_1.y,
						segment.control_2.x,
						segment.control_2.y,
						segment.to.x,
						segment.to.y
					);
					break;
			}
		}
		if (subpath.closed) context.closePath();
	}
}

/**
 * Draw an arrow shape
 */
function drawArrow(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: ArrowShape,
	bindingsBySource?: BindingIndex
) {
	const style = shape.props.style;
	const shapeAlpha = context.globalAlpha;

	const geometry = arrowGeometryForShape(state, shape, bindingsBySource);
	if (!geometry) return;

	const shaft = arrowShaftGeometry(geometry.path, style);
	drawNativePath(context, shaft);

	const strokePaint = paintForCanvas(context, style.stroke, pathGeometryBounds(geometry.path));
	if (!strokePaint) return;
	context.strokeStyle = strokePaint;
	context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
	context.lineWidth = style.width;
	if (style.dash) context.setLineDash(style.dash);
	context.stroke();
	if (style.dash) context.setLineDash([]);

	const drawHead = (atStart: boolean) => {
		const head = arrowHeadGeometry(geometry.path, atStart);
		if (!head) return;
		const headStyle = atStart ? style.headStartStyle : style.headEndStyle;
		context.beginPath();
		context.moveTo(head.tip.x, head.tip.y);
		if (headStyle === 'triangle') {
			context.lineTo(head.left.x, head.left.y);
			context.lineTo(head.right.x, head.right.y);
			context.closePath();
			const headFill = paintForCanvas(context, style.stroke, pathGeometryBounds(geometry.path));
			if (headFill) {
				context.fillStyle = headFill;
				context.fill();
			}
		} else {
			context.lineTo(head.left.x, head.left.y);
			context.moveTo(head.tip.x, head.tip.y);
			context.lineTo(head.right.x, head.right.y);
		}
		const headStroke = paintForCanvas(context, style.stroke, pathGeometryBounds(geometry.path));
		if (headStroke) {
			context.strokeStyle = headStroke;
			context.lineWidth = style.width;
			context.stroke();
		}
	};

	if (style.headEnd !== false) drawHead(false);
	if (style.headStart) drawHead(true);

	const label = shape.props.label;
	if (label) {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		drawArrowLabel(context, state, geometry.path, label);
	}
}

/**
 * Draw an arrow label
 */
function drawArrowLabel(
	context: CanvasRenderingContext2D,
	state: EditorState,
	geometry: PathGeometry,
	label: ArrowLabel
) {
	if (!label.text) return;

	const placement = arrowLabelPlacement(geometry, label);
	if (!placement) return;
	const labelPos = placement.point;

	context.save();
	context.font = '14px sans-serif';
	context.fillStyle = '#000';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	const metrics = context.measureText(label.text);
	const padding = 4;
	const bgWidth = metrics.width + padding * 2;
	const bgHeight = 18;

	context.fillStyle = 'rgba(255, 255, 255, 0.9)';
	context.fillRect(labelPos.x - bgWidth / 2, labelPos.y - bgHeight / 2, bgWidth, bgHeight);
	context.strokeStyle = '#ccc';
	context.lineWidth = 1 / state.camera.zoom;
	context.strokeRect(labelPos.x - bgWidth / 2, labelPos.y - bgHeight / 2, bgWidth, bgHeight);

	context.fillStyle = '#000';
	context.fillText(label.text, labelPos.x, labelPos.y);
	context.restore();
}

/**
 * Draw a text shape
 */
function drawText(
	context: CanvasRenderingContext2D,
	shape: TextShape,
	textLayoutCache: LruCache<string, string[]>,
	textMetricCache: LruCache<string, number>
) {
	const { text, fontSize, fontFamily, color, w } = shape.props;

	context.globalAlpha *= shape.fillOpacity ?? 1;
	context.font = `${fontSize}px ${fontFamily}`;
	context.fillStyle =
		paintForCanvas(context, color, { x: 0, y: 0, width: w ?? fontSize * 10, height: fontSize * 1.2 }) ?? '#000000';
	context.textBaseline = 'top';

	if (w === undefined) {
		context.fillText(text, 0, 0);
	} else {
		const lines = wrapText(context, text, w, textLayoutCache, textMetricCache);
		for (const [index, line] of lines.entries()) {
			context.fillText(line, 0, index * fontSize * 1.2);
		}
	}
}

/**
 * Parse and render markdown to canvas
 *
 * Renders markdown with basic formatting:
 * - Headings (h1-h6) with appropriate sizes
 * - Bold (**text** or __text__)
 * - Italic (*text* or _text_)
 * - Code (`code`)
 * - Paragraphs with line wrapping
 * - Lists (ordered and unordered)
 * - Code blocks (```)
 */
type MarkdownLine = { source: string; kind: 'code' | 'text'; fontSize: number; weight: string; prefix: string };

function prepareMarkdownLines(source: string, baseFontSize: number): MarkdownLine[] {
	const sourceLines = source.split('\n');
	const lines: MarkdownLine[] = [];

	for (let index = 0; index < sourceLines.length; index++) {
		let line = sourceLines[index];
		if (line.startsWith('```')) {
			const codeLines: string[] = [];
			index++;
			while (index < sourceLines.length && !sourceLines[index].startsWith('```')) {
				codeLines.push(sourceLines[index]);
				index++;
			}
			lines.push({
				source: codeLines.join('\n'),
				kind: 'code',
				fontSize: baseFontSize,
				weight: 'normal',
				prefix: ''
			});
			continue;
		}

		let fontSize = baseFontSize;
		let weight = 'normal';
		let prefix = '';
		const heading = line.match(/^(#{1,6})\s(.*)$/);
		const orderedItem = line.match(/^(\d+)\.\s(.*)$/);
		if (heading) {
			fontSize = baseFontSize * (2 - heading[1].length * 0.15);
			weight = 'bold';
			line = heading[2];
		} else if (/^[-*+]\s/.test(line)) {
			prefix = '• ';
			line = line.replace(/^[-*+]\s/, '');
		} else if (orderedItem) {
			prefix = `${orderedItem[1]}. `;
			line = orderedItem[2];
		}
		lines.push({ source: line, kind: 'text', fontSize, weight, prefix });
	}

	return lines;
}

function drawMarkdown(
	context: CanvasRenderingContext2D,
	shape: MarkdownShape,
	theme: 'light' | 'dark' = 'light',
	textLayoutCache = new LruCache<string, string[]>(512),
	textMetricCache = new LruCache<string, number>(2_048),
	markdownLayoutCache = new LruCache<string, MarkdownLine[]>(256)
) {
	const { md, w, h, fontSize, fontFamily, color, bg, border } = shape.props;

	const width = w;
	const height = h ?? fontSize * 10;
	const shapeAlpha = context.globalAlpha;

	context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
	context.fillStyle = paintForCanvas(context, bg, { x: 0, y: 0, width, height }) ?? '#ffffff';
	context.fillRect(0, 0, width, height);

	if (border) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		context.strokeStyle = paintForCanvas(context, border, { x: 0, y: 0, width, height }) ?? '#000000';
		context.lineWidth = 1;
		context.strokeRect(0, 0, width, height);
	}

	context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
	context.fillStyle = paintForCanvas(context, color, { x: 0, y: 0, width, height }) ?? '#000000';
	context.textBaseline = 'top';

	const padding = 8;
	let yOffset = padding;
	const lineHeight = fontSize * 1.4;

	const layoutKey = `${md}\u0000${w}\u0000${fontSize}\u0000${fontFamily}\u0000${theme}`;
	let preparedLines = markdownLayoutCache.get(layoutKey);
	if (!preparedLines) {
		preparedLines = prepareMarkdownLines(md, fontSize);
		markdownLayoutCache.set(layoutKey, preparedLines);
	}

	for (let lineIndex = 0; lineIndex < preparedLines.length; lineIndex++) {
		const prepared = preparedLines[lineIndex];
		let line = prepared.source;

		if (yOffset + lineHeight > height - padding) break;

		let currentFontSize = prepared.fontSize;
		let currentStyle = 'normal';
		let currentWeight = 'normal';
		let prefix = prepared.prefix;

		if (prepared.kind === 'code') {
			context.fillStyle = theme === 'dark' ? '#2e3440' : '#f4f4f4';
			const codeBlockLines = line.split('\n');

			const codeBlockHeight = codeBlockLines.length * lineHeight + padding * 2;
			if (yOffset + codeBlockHeight <= height - padding) {
				context.fillRect(padding, yOffset, width - padding * 2, codeBlockHeight);

				context.fillStyle = theme === 'dark' ? '#e5e9f0' : '#333';
				context.font = `normal normal ${fontSize}px monospace`;

				for (const [index, codeLine] of codeBlockLines.entries()) {
					context.fillText(codeLine, padding + 4, yOffset + padding + index * lineHeight);
				}

				yOffset += codeBlockHeight + padding;
			}

			context.fillStyle = paintForCanvas(context, color, { x: 0, y: 0, width, height }) ?? '#000000';
			context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
			continue;
		}

		currentWeight = prepared.weight;

		line = prefix + line;

		line = line.replace(/`([^`]+)`/g, '$1');

		context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;

		const wrappedLines = wrapText(context, line, width - padding * 2, textLayoutCache, textMetricCache);

		for (const wrappedLine of wrappedLines) {
			if (yOffset + currentFontSize * 1.4 > height - padding) break;

			const styledLine = wrappedLine;
			let xOffset = padding;

			const segments = parseInlineStyles(styledLine);

			for (const segment of segments) {
				const { text: segmentText, bold, italic, code } = segment;

				if (code) {
					context.fillStyle = theme === 'dark' ? '#2e3440' : '#f4f4f4';
					const metrics = context.measureText(segmentText);
					context.fillRect(xOffset, yOffset, metrics.width + 4, currentFontSize * 1.2);

					context.fillStyle = theme === 'dark' ? '#e5e9f0' : '#333';
					context.font = `normal normal ${currentFontSize * 0.9}px monospace`;
					context.fillText(segmentText, xOffset + 2, yOffset);
					xOffset += metrics.width + 4;
					context.fillStyle = paintForCanvas(context, color, { x: 0, y: 0, width, height }) ?? '#000000';
					context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
				} else {
					const weight = bold ? 'bold' : currentWeight;
					const style = italic ? 'italic' : currentStyle;
					context.font = `${weight} ${style} ${currentFontSize}px ${fontFamily}`;
					context.fillText(segmentText, xOffset, yOffset);
					const metrics = context.measureText(segmentText);
					xOffset += metrics.width;
					context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
				}
			}

			yOffset += currentFontSize * 1.4;
		}
	}
}

/**
 * Parse inline markdown styles (bold, italic, code) into segments
 */
function parseInlineStyles(text: string): Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> {
	const segments: Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> = [];

	const codeRegex = /`([^`]+)`/g;
	const parts = [];
	let lastIndex = 0;
	let match;

	while ((match = codeRegex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			parts.push({ text: text.slice(lastIndex, match.index), code: false });
		}
		parts.push({ text: match[1], code: true });
		lastIndex = codeRegex.lastIndex;
	}

	if (lastIndex < text.length) {
		parts.push({ text: text.slice(lastIndex), code: false });
	}

	for (const part of parts) {
		if (part.code) {
			segments.push({ text: part.text, bold: false, italic: false, code: true });
		} else {
			const boldItalicRegex = /(\*\*\*|___)([^*_]+)(\*\*\*|___)|(\*\*|__)([^*_]+)(\*\*|__)|(\*|_)([^*_]+)(\*|_)/g;
			let lastPartIndex = 0;
			let partMatch;

			while ((partMatch = boldItalicRegex.exec(part.text)) !== null) {
				if (partMatch.index > lastPartIndex) {
					segments.push({
						text: part.text.slice(lastPartIndex, partMatch.index),
						bold: false,
						italic: false,
						code: false
					});
				}

				if (partMatch[1]) {
					segments.push({ text: partMatch[2], bold: true, italic: true, code: false });
				} else if (partMatch[4]) {
					segments.push({ text: partMatch[5], bold: true, italic: false, code: false });
				} else if (partMatch[7]) {
					segments.push({ text: partMatch[8], bold: false, italic: true, code: false });
				}

				lastPartIndex = boldItalicRegex.lastIndex;
			}

			if (lastPartIndex < part.text.length) {
				segments.push({ text: part.text.slice(lastPartIndex), bold: false, italic: false, code: false });
			}

			if (segments.length === 0 || lastPartIndex === 0) {
				if (segments.length === 0) {
					segments.push({ text: part.text, bold: false, italic: false, code: false });
				}
			}
		}
	}

	if (segments.length === 0) {
		segments.push({ text, bold: false, italic: false, code: false });
	}

	return segments;
}

/** Draw a native path with Canvas' compound fill rule and stroke. */
function drawPath(context: CanvasRenderingContext2D, shape: PathShape) {
	const { subpaths, fill_rule: fillRule, fill, stroke, stroke_width: strokeWidth } = shape.props;
	const shapeAlpha = context.globalAlpha;
	context.beginPath();
	for (const subpath of subpaths) {
		const first = subpath.segments[0];
		if (!first || first.type !== 'move') continue;
		context.moveTo(first.to.x, first.to.y);
		for (const segment of subpath.segments.slice(1)) {
			switch (segment.type) {
				case 'move':
					context.moveTo(segment.to.x, segment.to.y);
					break;
				case 'line':
					context.lineTo(segment.to.x, segment.to.y);
					break;
				case 'quadratic':
					context.quadraticCurveTo(segment.control.x, segment.control.y, segment.to.x, segment.to.y);
					break;
				case 'cubic':
					context.bezierCurveTo(
						segment.control_1.x,
						segment.control_1.y,
						segment.control_2.x,
						segment.control_2.y,
						segment.to.x,
						segment.to.y
					);
					break;
			}
		}
		if (subpath.closed) context.closePath();
	}
	if (fill && fill !== 'none' && fill !== 'transparent') {
		context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
		const fillStyle = paintForCanvas(context, fill, pathGeometryBounds(shape.props));
		if (fillStyle) {
			context.fillStyle = fillStyle;
			context.fill(fillRule);
		}
	}
	if (stroke && stroke !== 'none' && stroke !== 'transparent') {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		const strokeStyle = paintForCanvas(context, stroke, pathGeometryBounds(shape.props));
		if (strokeStyle) {
			context.strokeStyle = strokeStyle;
			context.lineWidth = Math.max(0, strokeWidth ?? 2);
			context.stroke();
		}
	}
}

/**
 * Draw a stroke shape (freehand drawing)
 */
function drawStroke(context: CanvasRenderingContext2D, shape: StrokeShape) {
	const { points, style } = shape.props;

	if (points.length < 2) {
		return;
	}

	const outline = getStrokeOutline(shape);

	if (outline.length === 0) {
		return;
	}

	context.globalAlpha *= shape.strokeOpacity ?? style.opacity;
	const outlineBounds = {
		x: Math.min(...outline.map((point) => point.x)),
		y: Math.min(...outline.map((point) => point.y)),
		width: Math.max(...outline.map((point) => point.x)) - Math.min(...outline.map((point) => point.x)),
		height: Math.max(...outline.map((point) => point.y)) - Math.min(...outline.map((point) => point.y))
	};
	context.fillStyle = paintForCanvas(context, style.color, outlineBounds) ?? '#000000';
	context.beginPath();
	context.moveTo(outline[0].x, outline[0].y);

	for (let i = 1; i < outline.length; i++) {
		context.lineTo(outline[i].x, outline[i].y);
	}

	context.closePath();
	context.fill();
}

/**
 * Wrap text to fit within a given width
 */
function wrapText(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	layoutCache = new LruCache<string, string[]>(512),
	metricCache = new LruCache<string, number>(2_048)
): string[] {
	const cacheKey = `${context.font}\u0000${maxWidth}\u0000${text}`;
	const cached = layoutCache.get(cacheKey);
	if (cached) return cached;
	const lines: string[] = [];
	for (const sourceLine of text.split('\n')) {
		let currentLine = '';
		for (const word of sourceLine.split(' ')) {
			const testLine = currentLine ? `${currentLine} ${word}` : word;
			const widthKey = `${context.font}\u0000${testLine}`;
			let measuredWidth = metricCache.get(widthKey);
			if (measuredWidth === undefined) {
				measuredWidth = context.measureText(testLine).width;
				metricCache.set(widthKey, measuredWidth);
			}

			if (measuredWidth > maxWidth && currentLine) {
				lines.push(currentLine);
				currentLine = word;
			} else {
				currentLine = testLine;
			}
		}
		lines.push(currentLine);
	}

	layoutCache.set(cacheKey, lines);
	return lines;
}

/**
 * Draw selection outlines for selected shapes
 */
const SELECTION_COLOR = '#34d399';

function drawSelection(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shapes: ShapeRecord[],
	handleState?: HandleRenderState,
	bindingsBySource?: BindingIndex,
	theme: 'light' | 'dark' = 'light'
) {
	const selectedIds = new Set(state.ui.selectionIds);
	const singleSelectionId = state.ui.selectionIds.length === 1 ? state.ui.selectionIds[0] : null;
	const hovered = state.ui.hoveredShapeId ? state.doc.shapes[state.ui.hoveredShapeId] : undefined;
	if (hovered && !selectedIds.has(hovered.id)) {
		const bounds = shapeBounds(hovered);
		context.save();
		context.setLineDash([5 / state.camera.zoom, 4 / state.camera.zoom]);
		context.strokeStyle = 'rgba(37, 99, 235, 0.65)';
		context.lineWidth = 1.5 / state.camera.zoom;
		context.strokeRect(bounds.min.x, bounds.min.y, bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
		context.restore();
	}

	for (const shape of shapes) {
		if (!selectedIds.has(shape.id)) continue;

		context.save();
		applyShapeTransform(context, shape);

		const strokeSelectionBounds = () => {
			switch (shape.type) {
				case 'rect':
				case 'ellipse': {
					const { w, h } = shape.props;
					context.strokeRect(0, 0, w, h);
					break;
				}
				case 'line': {
					const { a, b } = shape.props;
					const minX = Math.min(a.x, b.x);
					const minY = Math.min(a.y, b.y);
					const maxX = Math.max(a.x, b.x);
					const maxY = Math.max(a.y, b.y);
					const padding = 5;
					context.strokeRect(
						minX - padding,
						minY - padding,
						maxX - minX + padding * 2,
						maxY - minY + padding * 2
					);
					break;
				}
				case 'arrow': {
					const geometry = arrowGeometryForShape(state, shape, bindingsBySource);
					if (geometry) {
						drawNativePath(context, arrowShaftGeometry(geometry.path, shape.props.style));
						context.stroke();
					} else {
						const points = arrowPathForShape(state, shape, bindingsBySource);
						if (points.length > 0) {
							context.beginPath();
							context.moveTo(points[0].x, points[0].y);
							for (const point of points.slice(1)) context.lineTo(point.x, point.y);
							context.stroke();
						}
					}
					break;
				}
				case 'path': {
					const bounds = localShapeBounds(shape);
					const padding = 5;
					context.strokeRect(
						bounds.min.x - padding,
						bounds.min.y - padding,
						bounds.max.x - bounds.min.x + padding * 2,
						bounds.max.y - bounds.min.y + padding * 2
					);
					break;
				}
				case 'text': {
					const { fontSize, fontFamily, text, w } = shape.props;
					context.font = `${fontSize}px ${fontFamily}`;
					const width = w ?? context.measureText(text).width;
					context.strokeRect(0, 0, width, fontSize * 1.2);
					break;
				}
				case 'markdown': {
					const { w, h, fontSize } = shape.props;
					context.strokeRect(0, 0, w, h ?? fontSize * 10);
					break;
				}
				case 'container':
				case 'reference': {
					const bounds = localShapeBounds(shape);
					context.strokeRect(
						bounds.min.x,
						bounds.min.y,
						bounds.max.x - bounds.min.x,
						bounds.max.y - bounds.min.y
					);
					break;
				}
				case 'stroke': {
					const outline = shape.props.points.length >= 2 ? getStrokeOutline(shape) : [];
					if (outline.length === 0) break;
					let minX = outline[0].x;
					let maxX = outline[0].x;
					let minY = outline[0].y;
					let maxY = outline[0].y;
					for (const point of outline) {
						minX = Math.min(minX, point.x);
						maxX = Math.max(maxX, point.x);
						minY = Math.min(minY, point.y);
						maxY = Math.max(maxY, point.y);
					}
					context.strokeRect(minX, minY, maxX - minX, maxY - minY);
					break;
				}
			}
		};

		context.setLineDash([7 / state.camera.zoom, 5 / state.camera.zoom]);
		context.strokeStyle = SELECTION_COLOR;
		context.lineWidth = 2.5 / state.camera.zoom;
		strokeSelectionBounds();

		context.restore();

		if (singleSelectionId === shape.id) {
			drawHandles(context, state, shape, handleState, bindingsBySource, theme);
			if (
				state.ui.toolId === 'direct-select' &&
				state.ui.pathSelection?.pathId === shape.id &&
				shape.type === 'path'
			) {
				drawPathEditingHandles(context, state, shape, handleState);
			}
		}
	}
}

type HandleVisual = { id: string; position: Vec2; connectorFrom?: Vec2 };
const ROTATE_HANDLE_OFFSET = 40;
const TEXT_HANDLE_OFFSET = 7;

function drawHandles(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: ShapeRecord,
	handleState?: HandleRenderState,
	bindingsBySource?: BindingIndex,
	theme: 'light' | 'dark' = 'light'
) {
	if (!handleState) {
		return;
	}
	const handles = getHandlesForShape(state, shape, bindingsBySource);
	if (handles.length === 0) {
		return;
	}

	for (const handle of handles) {
		if (handle.connectorFrom) {
			context.save();
			context.strokeStyle = 'rgba(52, 211, 153, 0.72)';
			context.lineWidth = 1 / state.camera.zoom;
			context.beginPath();
			context.moveTo(handle.connectorFrom.x, handle.connectorFrom.y);
			context.lineTo(handle.position.x, handle.position.y);
			context.stroke();
			context.restore();
		}

		context.save();
		const isActive = handleState.active === handle.id;
		const isHover = handleState.hover === handle.id;
		const fill = isActive || isHover ? SELECTION_COLOR : theme === 'dark' ? '#171928' : '#f0f3f4';
		const size = (handle.id === 'rotate' ? 7 : 6) / state.camera.zoom;

		context.translate(handle.position.x, handle.position.y);
		context.lineWidth = 3 / state.camera.zoom;
		context.strokeStyle = SELECTION_COLOR;
		context.fillStyle = fill;
		context.beginPath();
		context.arc(0, 0, size, 0, Math.PI * 2);
		context.fill();
		context.stroke();

		context.restore();
	}
}

function drawPathEditingHandles(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: PathShape,
	handleState?: HandleRenderState
): void {
	const selectedAnchors = new Set(
		(state.ui.pathSelection?.anchors ?? []).map((anchor) => `${anchor.subpathIndex}:${anchor.segmentIndex}`)
	);
	const scale = state.camera.zoom;
	const anchorSize = 5 / scale;
	const controlSize = 4 / scale;

	context.save();
	applyShapeTransform(context, shape);
	context.lineWidth = 1 / scale;
	context.setLineDash([]);

	for (const handle of pathControlHandles(shape)) {
		const handleId = pathControlHandleId(handle.ref);
		context.strokeStyle = 'rgba(37, 99, 235, 0.6)';
		context.beginPath();
		context.moveTo(handle.anchor.x, handle.anchor.y);
		context.lineTo(handle.position.x, handle.position.y);
		context.stroke();
		const active = handleState?.active === handleId;
		const hover = handleState?.hover === handleId;
		context.fillStyle = active ? '#2563eb' : hover ? '#dbeafe' : '#ffffff';
		context.strokeStyle = active || hover ? '#1d4ed8' : '#2563eb';
		context.beginPath();
		context.arc(handle.position.x, handle.position.y, controlSize, 0, Math.PI * 2);
		context.fill();
		context.stroke();
	}

	for (const anchor of pathAnchorRefs(shape)) {
		const position = pathAnchorPosition(shape, anchor);
		if (!position) continue;
		const anchorId = pathAnchorHandleId(anchor);
		const key = `${anchor.subpathIndex}:${anchor.segmentIndex}`;
		const selected = selectedAnchors.has(key);
		const hover = handleState?.hover === anchorId;
		context.fillStyle = selected || handleState?.active === anchorId ? '#2563eb' : hover ? '#dbeafe' : '#ffffff';
		context.strokeStyle = hover ? '#1e40af' : '#1d4ed8';
		context.lineWidth = 1.5 / scale;
		context.beginPath();
		context.rect(position.x - anchorSize, position.y - anchorSize, anchorSize * 2, anchorSize * 2);
		context.fill();
		context.stroke();
	}
	context.restore();
}

function getHandlesForShape(state: EditorState, shape: ShapeRecord, bindingsBySource?: BindingIndex): HandleVisual[] {
	const handles: HandleVisual[] = [];
	if (
		shape.type === 'rect' ||
		shape.type === 'ellipse' ||
		shape.type === 'text' ||
		shape.type === 'markdown' ||
		shape.type === 'container'
	) {
		const bounds = localShapeBounds(shape);
		const minX = bounds.min.x;
		const maxX = bounds.max.x;
		const minY = bounds.min.y;
		const maxY = bounds.max.y;
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		const offset = shape.type === 'text' ? TEXT_HANDLE_OFFSET / state.camera.zoom : 0;
		const world = (point: Vec2) => localToWorld(shape, point);
		handles.push(
			{ id: 'nw', position: world({ x: minX - offset, y: minY - offset }) },
			{ id: 'n', position: world({ x: centerX, y: minY - offset }) },
			{ id: 'ne', position: world({ x: maxX + offset, y: minY - offset }) },
			{ id: 'e', position: world({ x: maxX + offset, y: centerY }) },
			{ id: 'se', position: world({ x: maxX + offset, y: maxY + offset }) },
			{ id: 's', position: world({ x: centerX, y: maxY + offset }) },
			{ id: 'sw', position: world({ x: minX - offset, y: maxY + offset }) },
			{ id: 'w', position: world({ x: minX - offset, y: centerY }) },
			{
				id: 'rotate',
				position: world({ x: centerX, y: minY - ROTATE_HANDLE_OFFSET }),
				connectorFrom: world({ x: centerX, y: minY - offset })
			}
		);
		return handles;
	}

	if (shape.type === 'line') {
		const start = localToWorld(shape, shape.props.a);
		const end = localToWorld(shape, shape.props.b);
		handles.push({ id: 'line-start', position: start }, { id: 'line-end', position: end });
		return handles;
	}

	if (shape.type === 'arrow') {
		const resolved = resolveArrowEndpoints(state, shape.id, bindingsBySource);
		const arrowGeometry = arrowGeometryForShape(state, shape, bindingsBySource);
		if (resolved && arrowGeometry && shape.props.points && shape.props.points.length >= 2) {
			handles.push({ id: 'line-start', position: resolved.a });

			for (let i = 1; i < shape.props.points.length - 1; i++) {
				const point = shape.props.points[i];
				const worldPos = localToWorld(shape, point);
				handles.push({ id: `arrow-point-${i}`, position: worldPos });
			}

			const bendHandle = arrowBendHandleForShape(state, shape, bindingsBySource);
			if (bendHandle) handles.push({ id: 'arrow-bend', ...bendHandle });

			handles.push({ id: 'line-end', position: resolved.b });

			if (shape.props.label) {
				const placement = arrowLabelPlacement(arrowGeometry.path, shape.props.label);
				if (placement) {
					const worldLabelPos = localToWorld(shape, placement.point);
					handles.push({ id: 'arrow-label', position: worldLabelPos });
				}
			}
		}
		return handles;
	}

	return handles;
}

function applyShapeTransform(context: CanvasRenderingContext2D, shape: ShapeRecord): void {
	const matrix = shapeTransform(shape);
	if (shape.editorTransform && typeof context.transform === 'function') {
		context.transform(matrix[0], matrix[1], matrix[3], matrix[4], matrix[6], matrix[7]);
		return;
	}
	context.translate(shape.x, shape.y);
	if (shape.rot !== 0) context.rotate(shape.rot);
}
