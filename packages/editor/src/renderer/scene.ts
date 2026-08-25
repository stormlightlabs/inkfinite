import type { Camera, EditorBindingRecord, EditorShapeRecord, EditorState, Viewport } from '@inkfinite/core';
import {
	arrowPathForShape,
	getLayersOnCurrentPage,
	getShapesOnCurrentPage,
	localToWorld,
	shapeBoundsForState
} from '@inkfinite/core';
import { drawShape } from './shapes.js';
import { drawBindingPreview, drawSelection, drawSnapGuides } from './overlays.js';
import type { RendererResources } from './resources.js';
import type { HandleRenderState, PointerVisualState, SnapSettings } from './types.js';

/** Render the world scene, then the editor overlays, in their fixed z-order. */
export function drawScene(
	context: CanvasRenderingContext2D,
	state: EditorState,
	viewport: Viewport,
	snapSettings: SnapSettings | undefined,
	cursorState: import('@inkfinite/core').CursorState | undefined,
	pointerState: PointerVisualState | undefined,
	handleState: HandleRenderState,
	theme: 'light' | 'dark',
	resources: RendererResources,
	onImageLoaded: () => void
): void {
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	context.restore();

	context.save();
	applyCameraTransform(context, state.camera, viewport);
	drawGrid(context, state.camera, viewport, snapSettings, theme);

	const shapes = getShapesOnCurrentPage(state);
	const bindingsBySource = new Map<string, EditorBindingRecord[]>();
	for (const binding of Object.values(state.doc.bindings)) {
		const bindings = bindingsBySource.get(binding.fromShapeId);
		if (bindings) bindings.push(binding);
		else bindingsBySource.set(binding.fromShapeId, [binding]);
	}
	const visibleBounds = getExpandedViewportBounds(state.camera, viewport);
	const layers = getLayersOnCurrentPage(state);
	const renderShape = (shape: EditorShapeRecord) => {
		if (!isShapeVisible(state, shape, visibleBounds, bindingsBySource)) return;
		drawShape(context, state, shape, bindingsBySource, theme, resources, onImageLoaded);
	};

	if (layers.length === 0) {
		for (const shape of shapes) renderShape(shape);
	} else {
		for (const layer of layers) {
			if (!layer.visible) continue;
			context.save();
			context.globalAlpha *= layer.opacity;
			for (const shapeId of layer.shapeIds) {
				const shape = state.doc.shapes[shapeId];
				if (shape) renderShape(shape);
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
	shape: EditorShapeRecord,
	viewport: VisibleBounds,
	bindingsBySource: Map<string, EditorBindingRecord[]>
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

	const bounds = shapeBoundsForState(state, shape);
	return (
		bounds.max.x >= viewport.minX &&
		bounds.min.x <= viewport.maxX &&
		bounds.max.y >= viewport.minY &&
		bounds.min.y <= viewport.maxY
	);
}

/** Apply the camera transform shared by all scene and overlay drawing. */
function applyCameraTransform(context: CanvasRenderingContext2D, camera: Camera, viewport: Viewport): void {
	context.translate(viewport.width / 2, viewport.height / 2);
	context.scale(camera.zoom, camera.zoom);
	context.translate(-camera.x, -camera.y);
}

const DEFAULT_GRID_SIZE = 25;

/** Draw the snapping grid in world space. */
function drawGrid(
	context: CanvasRenderingContext2D,
	camera: Camera,
	viewport: Viewport,
	snapSettings?: SnapSettings,
	theme: 'light' | 'dark' = 'light'
): void {
	if (snapSettings && !snapSettings.gridEnabled) return;
	const gridSize = snapSettings?.gridSize ?? DEFAULT_GRID_SIZE;
	const stepMultiplier = Math.max(1, Math.ceil(10 / (gridSize * camera.zoom)));
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
