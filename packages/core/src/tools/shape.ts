import type { Action } from '../actions';
import { computeNormalizedAnchor, hitTestPoint, shapeBounds } from '../geom';
import { Vec2 } from '../math';
import { snapAngle } from '../snapping';
import { BindingRecord, createId, ShapeRecord } from '../model';
import type { EditorState, ToolId } from '../reactivity';
import { canCreateShapeOnActiveLayer, getCurrentPage } from '../reactivity';
import type { Tool } from '../tools/base';

function adoptFrameContents(state: EditorState, frameId: string): EditorState {
	const frame = state.doc.shapes[frameId];
	if (!frame || frame.type !== 'container') return state;
	const frameBounds = shapeBounds(frame);
	const candidates = Object.values(state.doc.shapes)
		.filter((shape) => shape.id !== frameId && shape.pageId === frame.pageId && !shape.groupId && !shape.locked)
		.filter((shape) => {
			const bounds = shapeBounds(shape);
			return (
				bounds.min.x >= frameBounds.min.x &&
				bounds.min.y >= frameBounds.min.y &&
				bounds.max.x <= frameBounds.max.x &&
				bounds.max.y <= frameBounds.max.y
			);
		})
		.sort((left, right) => pageShapeIndex(state, left.id) - pageShapeIndex(state, right.id));
	if (candidates.length === 0) return state;

	const shapes = { ...state.doc.shapes };
	for (const shape of candidates) shapes[shape.id] = { ...shape, groupId: frameId };
	const childIds = candidates.map((shape) => shape.id);
	const pages = { ...state.doc.pages };
	const page = pages[frame.pageId];
	if (page) pages[frame.pageId] = { ...page, shapeIds: moveFrameBeforeChildren(page.shapeIds, frameId, childIds) };
	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	if (layers && frame.layerId && layers[frame.layerId]) {
		const layer = layers[frame.layerId];
		layers[frame.layerId] = { ...layer, shapeIds: moveFrameBeforeChildren(layer.shapeIds, frameId, childIds) };
	}
	return { ...state, doc: { ...state.doc, shapes, pages, ...(layers ? { layers } : {}) } };
}

function moveFrameBeforeChildren(ids: readonly string[], frameId: string, childIds: readonly string[]): string[] {
	const children = new Set(childIds);
	const filtered = ids.filter((id) => id !== frameId && !children.has(id));
	const firstChild = ids.findIndex((id) => children.has(id));
	filtered.splice(firstChild < 0 ? filtered.length : Math.min(firstChild, filtered.length), 0, frameId, ...childIds);
	return filtered;
}

function pageShapeIndex(state: EditorState, shapeId: string): number {
	const page = state.doc.pages[state.doc.shapes[shapeId]?.pageId ?? ''];
	return page?.shapeIds.indexOf(shapeId) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Internal state for shape creation tools
 */
type ShapeCreationToolState = {
	/** Whether we're currently creating a shape */
	isCreating: boolean;
	/** World coordinates where creation started */
	startWorld: Vec2 | null;
	/** ID of the shape being created */
	creatingShapeId: string | null;
};

/**
 * Minimum size threshold for shapes (in world units)
 * Shapes smaller than this on either dimension will be deleted
 */
const MIN_SHAPE_SIZE = 5;

function constrainedRect(
	start: Vec2,
	pointer: Vec2,
	keepAspect: boolean,
	fromCenter: boolean
): { x: number; y: number; w: number; h: number } {
	let dx = pointer.x - start.x;
	let dy = pointer.y - start.y;
	if (keepAspect) {
		const size = Math.max(Math.abs(dx), Math.abs(dy));
		dx = Math.sign(dx || 1) * size;
		dy = Math.sign(dy || 1) * size;
	}
	if (fromCenter) {
		return { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
	}
	return { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/**
 * Rect tool - creates rectangle shapes by dragging
 *
 * Features:
 * - Drag to create a rectangle from start point to current point
 * - Click-cancel: shapes too small are deleted on pointer up
 */
export class RectTool implements Tool {
	readonly id: ToolId = 'rect';
	private toolState: ShapeCreationToolState;

	constructor() {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}

	onEnter(state: EditorState): EditorState {
		this.resetToolState();
		return state;
	}

	onExit(state: EditorState): EditorState {
		let newState = state;
		if (this.toolState.creatingShapeId) {
			newState = this.cancelShapeCreation(state);
		}
		this.resetToolState();
		return newState;
	}

	onAction(state: EditorState, action: Action): EditorState {
		switch (action.type) {
			case 'pointer-down': {
				return this.handlePointerDown(state, action);
			}
			case 'pointer-move': {
				return this.handlePointerMove(state, action);
			}
			case 'pointer-up': {
				return this.handlePointerUp(state, action);
			}
			case 'key-down': {
				return this.handleKeyDown(state, action);
			}
			default: {
				return state;
			}
		}
	}

	private handlePointerDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-down') return state;
		if (!canCreateShapeOnActiveLayer(state)) return state;

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const shapeId = createId('shape');

		const shape = ShapeRecord.createRect(
			currentPage.id,
			action.world.x,
			action.world.y,
			{ w: 0, h: 0, fill: '#4a90e2', stroke: '#2e5c8a', radius: 4 },
			shapeId
		);

		this.toolState.isCreating = true;
		this.toolState.startWorld = action.world;
		this.toolState.creatingShapeId = shapeId;

		const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

		return {
			...state,
			doc: {
				...state.doc,
				shapes: { ...state.doc.shapes, [shapeId]: shape },
				pages: { ...state.doc.pages, [currentPage.id]: newPage }
			},
			ui: { ...state.ui, selectionIds: [shapeId] }
		};
	}

	private handlePointerMove(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-move' || !this.toolState.isCreating || !this.toolState.startWorld) return state;
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'rect') return state;

		const frame = constrainedRect(
			this.toolState.startWorld,
			action.world,
			action.modifiers.shift,
			action.modifiers.alt
		);
		const updatedShape = { ...shape, x: frame.x, y: frame.y, props: { ...shape.props, w: frame.w, h: frame.h } };

		return {
			...state,
			doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } }
		};
	}

	private handlePointerUp(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-up' || !this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'rect') return state;

		let newState = state;

		const completed = shape.props.w >= MIN_SHAPE_SIZE && shape.props.h >= MIN_SHAPE_SIZE;
		if (!completed) {
			newState = this.cancelShapeCreation(state);
		}

		this.resetToolState();
		return completed ? { ...newState, ui: { ...newState.ui, toolId: 'select' } } : newState;
	}

	private handleKeyDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'key-down') return state;

		if (action.key === 'Escape' && this.toolState.creatingShapeId) {
			const newState = this.cancelShapeCreation(state);
			this.resetToolState();
			return newState;
		}

		return state;
	}

	private cancelShapeCreation(state: EditorState): EditorState {
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape) return state;

		const newShapes = { ...state.doc.shapes };
		delete newShapes[this.toolState.creatingShapeId];

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const newPage = {
			...currentPage,
			shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId)
		};

		return {
			...state,
			doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
			ui: { ...state.ui, selectionIds: [] }
		};
	}

	private resetToolState(): void {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}
}

/**
 * Frame tool - creates a titled container and adopts shapes completely inside it.
 */
export class FrameTool implements Tool {
	readonly id: ToolId = 'frame';
	private toolState: ShapeCreationToolState = { isCreating: false, startWorld: null, creatingShapeId: null };

	onEnter(state: EditorState): EditorState {
		this.resetToolState();
		return state;
	}

	onExit(state: EditorState): EditorState {
		const next = this.toolState.creatingShapeId ? this.cancelShapeCreation(state) : state;
		this.resetToolState();
		return next;
	}

	onAction(state: EditorState, action: Action): EditorState {
		switch (action.type) {
			case 'pointer-down':
				return this.handlePointerDown(state, action);
			case 'pointer-move':
				return this.handlePointerMove(state, action);
			case 'pointer-up':
				return this.handlePointerUp(state, action);
			case 'key-down':
				return this.handleKeyDown(state, action);
			default:
				return state;
		}
	}

	private handlePointerDown(state: EditorState, action: Extract<Action, { type: 'pointer-down' }>): EditorState {
		if (!canCreateShapeOnActiveLayer(state)) return state;
		const page = getCurrentPage(state);
		if (!page) return state;
		const id = createId('shape');
		const shape = ShapeRecord.createContainer(
			page.id,
			action.world.x,
			action.world.y,
			{ w: 0, h: 0, title: 'Frame', fill: 'rgba(37, 99, 235, 0.05)', stroke: '#2563eb', radius: 8 },
			id
		);
		shape.layerId = state.ui.activeLayerId ?? page.layerIds?.[0];
		this.toolState = { isCreating: true, startWorld: action.world, creatingShapeId: id };
		return {
			...state,
			doc: {
				...state.doc,
				shapes: { ...state.doc.shapes, [id]: shape },
				pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: [...page.shapeIds, id] } }
			},
			ui: { ...state.ui, selectionIds: [id] }
		};
	}

	private handlePointerMove(state: EditorState, action: Extract<Action, { type: 'pointer-move' }>): EditorState {
		if (!this.toolState.isCreating || !this.toolState.startWorld || !this.toolState.creatingShapeId) return state;
		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'container') return state;
		const frame = constrainedRect(
			this.toolState.startWorld,
			action.world,
			action.modifiers.shift,
			action.modifiers.alt
		);
		return {
			...state,
			doc: {
				...state.doc,
				shapes: {
					...state.doc.shapes,
					[shape.id]: { ...shape, x: frame.x, y: frame.y, props: { ...shape.props, w: frame.w, h: frame.h } }
				}
			}
		};
	}

	private handlePointerUp(state: EditorState, _action: Extract<Action, { type: 'pointer-up' }>): EditorState {
		if (!this.toolState.creatingShapeId) return state;
		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'container') return state;
		const completed = (shape.props.w ?? 0) >= MIN_SHAPE_SIZE && (shape.props.h ?? 0) >= MIN_SHAPE_SIZE;
		const next = completed ? adoptFrameContents(state, shape.id) : this.cancelShapeCreation(state);
		this.resetToolState();
		return completed ? { ...next, ui: { ...next.ui, toolId: 'select' } } : next;
	}

	private handleKeyDown(state: EditorState, action: Extract<Action, { type: 'key-down' }>): EditorState {
		if (action.key !== 'Escape' || !this.toolState.creatingShapeId) return state;
		const next = this.cancelShapeCreation(state);
		this.resetToolState();
		return next;
	}

	private cancelShapeCreation(state: EditorState): EditorState {
		const id = this.toolState.creatingShapeId;
		if (!id) return state;
		const page = getCurrentPage(state);
		if (!page) return state;
		const shapes = { ...state.doc.shapes };
		delete shapes[id];
		return {
			...state,
			doc: {
				...state.doc,
				shapes,
				pages: {
					...state.doc.pages,
					[page.id]: { ...page, shapeIds: page.shapeIds.filter((value) => value !== id) }
				}
			},
			ui: { ...state.ui, selectionIds: [] }
		};
	}

	private resetToolState(): void {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}
}

/**
 * Ellipse tool - creates ellipse shapes by dragging
 *
 * Features:
 * - Drag to create an ellipse from start point to current point
 * - Click-cancel: shapes too small are deleted on pointer up
 */
export class EllipseTool implements Tool {
	readonly id: ToolId = 'ellipse';
	private toolState: ShapeCreationToolState;

	constructor() {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}

	onEnter(state: EditorState): EditorState {
		this.resetToolState();
		return state;
	}

	onExit(state: EditorState): EditorState {
		let newState = state;
		if (this.toolState.creatingShapeId) {
			newState = this.cancelShapeCreation(state);
		}
		this.resetToolState();
		return newState;
	}

	onAction(state: EditorState, action: Action): EditorState {
		switch (action.type) {
			case 'pointer-down': {
				return this.handlePointerDown(state, action);
			}
			case 'pointer-move': {
				return this.handlePointerMove(state, action);
			}
			case 'pointer-up': {
				return this.handlePointerUp(state, action);
			}
			case 'key-down': {
				return this.handleKeyDown(state, action);
			}
			default: {
				return state;
			}
		}
	}

	private handlePointerDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-down') return state;
		if (!canCreateShapeOnActiveLayer(state)) return state;

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const shapeId = createId('shape');

		const shape = ShapeRecord.createEllipse(
			currentPage.id,
			action.world.x,
			action.world.y,
			{ w: 0, h: 0, fill: '#51cf66', stroke: '#2f9e44' },
			shapeId
		);

		this.toolState.isCreating = true;
		this.toolState.startWorld = action.world;
		this.toolState.creatingShapeId = shapeId;

		const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

		return {
			...state,
			doc: {
				...state.doc,
				shapes: { ...state.doc.shapes, [shapeId]: shape },
				pages: { ...state.doc.pages, [currentPage.id]: newPage }
			},
			ui: { ...state.ui, selectionIds: [shapeId] }
		};
	}

	private handlePointerMove(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-move' || !this.toolState.isCreating || !this.toolState.startWorld) return state;
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'ellipse') return state;

		const frame = constrainedRect(
			this.toolState.startWorld,
			action.world,
			action.modifiers.shift,
			action.modifiers.alt
		);
		const updatedShape = { ...shape, x: frame.x, y: frame.y, props: { ...shape.props, w: frame.w, h: frame.h } };

		return {
			...state,
			doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } }
		};
	}

	private handlePointerUp(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-up' || !this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'ellipse') return state;

		let newState = state;

		const completed = shape.props.w >= MIN_SHAPE_SIZE && shape.props.h >= MIN_SHAPE_SIZE;
		if (!completed) {
			newState = this.cancelShapeCreation(state);
		}

		this.resetToolState();
		return completed ? { ...newState, ui: { ...newState.ui, toolId: 'select' } } : newState;
	}

	private handleKeyDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'key-down') return state;

		if (action.key === 'Escape' && this.toolState.creatingShapeId) {
			const newState = this.cancelShapeCreation(state);
			this.resetToolState();
			return newState;
		}

		return state;
	}

	private cancelShapeCreation(state: EditorState): EditorState {
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape) return state;

		const newShapes = { ...state.doc.shapes };
		delete newShapes[this.toolState.creatingShapeId];

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const newPage = {
			...currentPage,
			shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId)
		};

		return {
			...state,
			doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
			ui: { ...state.ui, selectionIds: [] }
		};
	}

	private resetToolState(): void {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}
}

/**
 * Line tool - creates line shapes by dragging
 *
 * Features:
 * - Drag to create a line from start point (a) to current point (b)
 * - Click-cancel: very short lines are deleted on pointer up
 */
export class LineTool implements Tool {
	readonly id: ToolId = 'line';
	private toolState: ShapeCreationToolState;

	constructor() {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}

	onEnter(state: EditorState): EditorState {
		this.resetToolState();
		return state;
	}

	onExit(state: EditorState): EditorState {
		let newState = state;
		if (this.toolState.creatingShapeId) {
			newState = this.cancelShapeCreation(state);
		}
		this.resetToolState();
		return newState;
	}

	onAction(state: EditorState, action: Action): EditorState {
		switch (action.type) {
			case 'pointer-down': {
				return this.handlePointerDown(state, action);
			}
			case 'pointer-move': {
				return this.handlePointerMove(state, action);
			}
			case 'pointer-up': {
				return this.handlePointerUp(state, action);
			}
			case 'key-down': {
				return this.handleKeyDown(state, action);
			}
			default: {
				return state;
			}
		}
	}

	private handlePointerDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-down') return state;
		if (!canCreateShapeOnActiveLayer(state)) return state;

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const shapeId = createId('shape');

		const shape = ShapeRecord.createLine(
			currentPage.id,
			action.world.x,
			action.world.y,
			{ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, stroke: '#495057', width: 2 },
			shapeId
		);

		this.toolState.isCreating = true;
		this.toolState.startWorld = action.world;
		this.toolState.creatingShapeId = shapeId;

		const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

		return {
			...state,
			doc: {
				...state.doc,
				shapes: { ...state.doc.shapes, [shapeId]: shape },
				pages: { ...state.doc.pages, [currentPage.id]: newPage }
			},
			ui: { ...state.ui, selectionIds: [shapeId] }
		};
	}

	private handlePointerMove(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-move' || !this.toolState.isCreating || !this.toolState.startWorld) return state;
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'line') return state;

		const end = action.modifiers.shift ? snapAngle(this.toolState.startWorld, action.world) : action.world;
		const b = Vec2.sub(end, this.toolState.startWorld);
		const updatedShape = { ...shape, props: { ...shape.props, b } };

		return {
			...state,
			doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } }
		};
	}

	private handlePointerUp(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-up' || !this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'line') return state;

		let newState = state;

		const lineLength = Vec2.len(shape.props.b);
		const completed = lineLength >= MIN_SHAPE_SIZE;
		if (!completed) {
			newState = this.cancelShapeCreation(state);
		}

		this.resetToolState();
		return completed ? { ...newState, ui: { ...newState.ui, toolId: 'select' } } : newState;
	}

	private handleKeyDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'key-down') return state;

		if (action.key === 'Escape' && this.toolState.creatingShapeId) {
			const newState = this.cancelShapeCreation(state);
			this.resetToolState();
			return newState;
		}

		return state;
	}

	private cancelShapeCreation(state: EditorState): EditorState {
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape) return state;

		const newShapes = { ...state.doc.shapes };
		delete newShapes[this.toolState.creatingShapeId];

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const newPage = {
			...currentPage,
			shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId)
		};

		return {
			...state,
			doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
			ui: { ...state.ui, selectionIds: [] }
		};
	}

	private resetToolState(): void {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}
}

/**
 * Arrow tool - creates arrow shapes by dragging
 *
 * Features:
 * - Drag to create an arrow from start point (a) to current point (b)
 * - Click-cancel: very short arrows are deleted on pointer up
 */
export class ArrowTool implements Tool {
	readonly id: ToolId = 'arrow';
	private toolState: ShapeCreationToolState;

	constructor() {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}

	onEnter(state: EditorState): EditorState {
		this.resetToolState();
		return state;
	}

	onExit(state: EditorState): EditorState {
		let newState = state;
		if (this.toolState.creatingShapeId) {
			newState = this.cancelShapeCreation(state);
		}
		this.resetToolState();
		return newState;
	}

	onAction(state: EditorState, action: Action): EditorState {
		switch (action.type) {
			case 'pointer-down': {
				return this.handlePointerDown(state, action);
			}
			case 'pointer-move': {
				return this.handlePointerMove(state, action);
			}
			case 'pointer-up': {
				return this.handlePointerUp(state, action);
			}
			case 'key-down': {
				return this.handleKeyDown(state, action);
			}
			default: {
				return state;
			}
		}
	}

	private handlePointerDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-down') return state;
		if (!canCreateShapeOnActiveLayer(state)) return state;

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const shapeId = createId('shape');

		const shape = ShapeRecord.createArrow(
			currentPage.id,
			action.world.x,
			action.world.y,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 0, y: 0 }
				],
				start: { kind: 'free' },
				end: { kind: 'free' },
				style: { stroke: '#2563eb', width: 2, headEnd: true },
				routing: { kind: 'straight' }
			},
			shapeId
		);

		this.toolState.isCreating = true;
		this.toolState.startWorld = action.world;
		this.toolState.creatingShapeId = shapeId;

		const newPage = { ...currentPage, shapeIds: [...currentPage.shapeIds, shapeId] };

		return {
			...state,
			doc: {
				...state.doc,
				shapes: { ...state.doc.shapes, [shapeId]: shape },
				pages: { ...state.doc.pages, [currentPage.id]: newPage }
			},
			ui: { ...state.ui, selectionIds: [shapeId] }
		};
	}

	private handlePointerMove(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-move' || !this.toolState.isCreating || !this.toolState.startWorld) return state;
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'arrow') return state;

		const end = action.modifiers.shift ? snapAngle(this.toolState.startWorld, action.world) : action.world;
		const b = Vec2.sub(end, this.toolState.startWorld);
		const updatedPoints = [{ x: 0, y: 0 }, b];
		const updatedShape = { ...shape, props: { ...shape.props, points: updatedPoints } };

		let newState = {
			...state,
			doc: { ...state.doc, shapes: { ...state.doc.shapes, [this.toolState.creatingShapeId]: updatedShape } }
		};

		const stateWithoutArrow = {
			...newState,
			doc: {
				...newState.doc,
				shapes: Object.fromEntries(
					Object.entries(newState.doc.shapes).filter(([id]) => id !== this.toolState.creatingShapeId)
				)
			}
		};

		const hitShapeId = hitTestPoint(stateWithoutArrow, action.world);

		if (hitShapeId) {
			newState = {
				...newState,
				ui: {
					...newState.ui,
					bindingPreview: {
						arrowId: this.toolState.creatingShapeId,
						targetShapeId: hitShapeId,
						handle: 'end'
					}
				}
			};
		} else {
			newState = { ...newState, ui: { ...newState.ui, bindingPreview: undefined } };
		}

		return newState;
	}

	private handlePointerUp(state: EditorState, action: Action): EditorState {
		if (action.type !== 'pointer-up' || !this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape || shape.type !== 'arrow') return state;

		let newState = state;

		const points = shape.props.points;
		if (!points || points.length < 2) {
			newState = this.cancelShapeCreation(state);
			this.resetToolState();
			return newState;
		}

		const endPoint = points[points.length - 1];
		const arrowLength = Vec2.len(endPoint);
		if (arrowLength < MIN_SHAPE_SIZE) {
			newState = this.cancelShapeCreation(state);
		} else {
			newState = this.createBindingsForArrow(state, this.toolState.creatingShapeId);
		}

		if (newState.ui.bindingPreview) {
			newState = { ...newState, ui: { ...newState.ui, bindingPreview: undefined } };
		}

		this.resetToolState();
		return arrowLength >= MIN_SHAPE_SIZE ? { ...newState, ui: { ...newState.ui, toolId: 'select' } } : newState;
	}

	/**
	 * Create bindings for arrow endpoints that hit other shapes
	 */
	private createBindingsForArrow(state: EditorState, arrowId: string): EditorState {
		const arrow = state.doc.shapes[arrowId];
		if (!arrow || arrow.type !== 'arrow') return state;

		const points = arrow.props.points;
		if (!points || points.length < 2) return state;

		const startPoint = points[0];
		const endPoint = points[points.length - 1];

		const startWorld = {
			x: arrow.editorTransform
				? arrow.editorTransform.e +
					arrow.editorTransform.a * startPoint.x +
					arrow.editorTransform.c * startPoint.y
				: arrow.x + Math.cos(arrow.rot) * startPoint.x - Math.sin(arrow.rot) * startPoint.y,
			y: arrow.editorTransform
				? arrow.editorTransform.f +
					arrow.editorTransform.b * startPoint.x +
					arrow.editorTransform.d * startPoint.y
				: arrow.y + Math.sin(arrow.rot) * startPoint.x + Math.cos(arrow.rot) * startPoint.y
		};
		const endWorld = {
			x: arrow.editorTransform
				? arrow.editorTransform.e + arrow.editorTransform.a * endPoint.x + arrow.editorTransform.c * endPoint.y
				: arrow.x + Math.cos(arrow.rot) * endPoint.x - Math.sin(arrow.rot) * endPoint.y,
			y: arrow.editorTransform
				? arrow.editorTransform.f + arrow.editorTransform.b * endPoint.x + arrow.editorTransform.d * endPoint.y
				: arrow.y + Math.sin(arrow.rot) * endPoint.x + Math.cos(arrow.rot) * endPoint.y
		};

		const newBindings = { ...state.doc.bindings };
		let updatedArrow = arrow;

		const stateWithoutArrow = {
			...state,
			doc: {
				...state.doc,
				shapes: Object.fromEntries(Object.entries(state.doc.shapes).filter(([id]) => id !== arrowId))
			}
		};

		const startHitId = hitTestPoint(stateWithoutArrow, startWorld);
		if (startHitId) {
			const targetShape = state.doc.shapes[startHitId];
			if (targetShape) {
				const anchor = computeNormalizedAnchor(startWorld, targetShape);
				const binding = BindingRecord.create(arrowId, startHitId, 'start', {
					kind: 'edge',
					nx: anchor.nx,
					ny: anchor.ny
				});
				newBindings[binding.id] = binding;
				updatedArrow = {
					...updatedArrow,
					props: { ...updatedArrow.props, start: { kind: 'bound', bindingId: binding.id } }
				};
			}
		}

		const endHitId = hitTestPoint(stateWithoutArrow, endWorld);
		if (endHitId) {
			const targetShape = state.doc.shapes[endHitId];
			if (targetShape) {
				const anchor = computeNormalizedAnchor(endWorld, targetShape);
				const binding = BindingRecord.create(arrowId, endHitId, 'end', {
					kind: 'edge',
					nx: anchor.nx,
					ny: anchor.ny
				});
				newBindings[binding.id] = binding;
				updatedArrow = {
					...updatedArrow,
					props: { ...updatedArrow.props, end: { kind: 'bound', bindingId: binding.id } }
				};
			}
		}

		return {
			...state,
			doc: { ...state.doc, bindings: newBindings, shapes: { ...state.doc.shapes, [arrowId]: updatedArrow } }
		};
	}

	private handleKeyDown(state: EditorState, action: Action): EditorState {
		if (action.type !== 'key-down') return state;

		if (action.key === 'Escape' && this.toolState.creatingShapeId) {
			const newState = this.cancelShapeCreation(state);
			this.resetToolState();
			return newState;
		}

		return state;
	}

	private cancelShapeCreation(state: EditorState): EditorState {
		if (!this.toolState.creatingShapeId) return state;

		const shape = state.doc.shapes[this.toolState.creatingShapeId];
		if (!shape) return state;

		const newShapes = { ...state.doc.shapes };
		delete newShapes[this.toolState.creatingShapeId];

		const currentPage = getCurrentPage(state);
		if (!currentPage) return state;

		const newPage = {
			...currentPage,
			shapeIds: currentPage.shapeIds.filter((id) => id !== this.toolState.creatingShapeId)
		};

		return {
			...state,
			doc: { ...state.doc, shapes: newShapes, pages: { ...state.doc.pages, [currentPage.id]: newPage } },
			ui: { ...state.ui, selectionIds: [] }
		};
	}

	private resetToolState(): void {
		this.toolState = { isCreating: false, startWorld: null, creatingShapeId: null };
	}
}
