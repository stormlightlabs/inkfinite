import type {
	BindingIndex,
	Camera,
	CursorState,
	EditorShapeRecord,
	EditorState,
	PathShape,
	SnapGuide,
	StrokeShape,
	Vec2,
	Viewport
} from '@inkfinite/core';
import {
	arrowBendHandleForShape,
	arrowGeometryForShape,
	arrowLabelPlacement,
	arrowPathForShape,
	arrowShaftGeometry,
	getStrokeOutline,
	localShapeBounds,
	localToWorld,
	pathAnchorHandleId,
	pathAnchorPosition,
	pathAnchorRefs,
	pathControlHandleId,
	pathControlHandles,
	resolveArrowEndpoints,
	shapeBounds,
	shapeBoundsForState,
	strokeWidthHandleId,
	strokeWidthHandles,
	textPathAnchorForShape,
	textPathLayoutForShape
} from '@inkfinite/core';
import { applyShapeTransform, drawNativePath } from './canvas.js';
import type { HandleRenderState, PointerVisualState, SnapSettings } from './types.js';

const DEFAULT_GRID_SIZE = 25;

export function drawSnapGuides(
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
export function drawBindingPreview(context: CanvasRenderingContext2D, state: EditorState) {
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
 * Draw selection outlines for selected shapes
 */
const SELECTION_COLOR = '#34d399';

export function drawSelection(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shapes: EditorShapeRecord[],
	handleState?: HandleRenderState,
	bindingsBySource?: BindingIndex,
	theme: 'light' | 'dark' = 'light'
) {
	const selectedIds = new Set(state.ui.selectionIds);
	const singleSelectionId = state.ui.selectionIds.length === 1 ? state.ui.selectionIds[0] : null;
	const hovered = state.ui.hoveredShapeId ? state.doc.shapes[state.ui.hoveredShapeId] : undefined;
	if (hovered && !selectedIds.has(hovered.id)) {
		const bounds = shapeBoundsForState(state, hovered);
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
		const attachedText = shape.type === 'text' && shape.props.textPath && textPathLayoutForShape(state, shape);
		if (!attachedText) applyShapeTransform(context, shape);

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
					if (attachedText) {
						const bounds = shapeBoundsForState(state, shape);
						context.strokeRect(
							bounds.min.x,
							bounds.min.y,
							bounds.max.x - bounds.min.x,
							bounds.max.y - bounds.min.y
						);
						break;
					}
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
			if (state.ui.toolId === 'direct-select' && state.ui.pathSelection?.pathId === shape.id) {
				if (shape.type === 'path') drawPathEditingHandles(context, state, shape, handleState);
				if (shape.type === 'stroke') drawStrokeEditingHandles(context, state, shape, handleState);
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
	shape: EditorShapeRecord,
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

function drawStrokeEditingHandles(
	context: CanvasRenderingContext2D,
	state: EditorState,
	shape: StrokeShape,
	handleState?: HandleRenderState
): void {
	const selected = new Set(state.ui.pathSelection?.widthPoints ?? []);
	const scale = state.camera.zoom;
	context.save();
	applyShapeTransform(context, shape);
	context.lineWidth = 1 / scale;
	context.setLineDash([]);
	for (const handle of strokeWidthHandles(shape)) {
		const id = strokeWidthHandleId(handle.index);
		const active = handleState?.active === id;
		const hover = handleState?.hover === id;
		context.strokeStyle = 'rgba(37, 99, 235, 0.6)';
		context.beginPath();
		context.moveTo(handle.center.x, handle.center.y);
		context.lineTo(handle.position.x, handle.position.y);
		context.stroke();
		context.fillStyle = selected.has(handle.index) || active ? '#2563eb' : hover ? '#dbeafe' : '#ffffff';
		context.strokeStyle = active || hover ? '#1d4ed8' : '#2563eb';
		context.beginPath();
		context.arc(handle.position.x, handle.position.y, 5 / scale, 0, Math.PI * 2);
		context.fill();
		context.stroke();
	}
	context.restore();
}

function getHandlesForShape(
	state: EditorState,
	shape: EditorShapeRecord,
	bindingsBySource?: BindingIndex
): HandleVisual[] {
	const handles: HandleVisual[] = [];
	if (shape.type === 'text' && shape.props.textPath) {
		const position = textPathAnchorForShape(state, shape);
		if (position) handles.push({ id: 'text-path-offset', position });
		return handles;
	}
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
