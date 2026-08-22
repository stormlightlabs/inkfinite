import { shapeBounds } from './geom';
import { Box2, type Box2 as Box2Type, type Vec2 } from './math';
import { createId, ShapeRecord, type ContainerShape, type ShapeRecord as Shape } from './model';
import type { EditorState } from './reactivity';

/** Axis used to distribute selected shapes. */
export type LayoutAxis = 'horizontal' | 'vertical';

/** Edge or center line used to align selected shapes. */
export type ShapeAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Edge used when moving selected shapes to the front or back of their layer. */
export type ShapeOrderEdge = 'front' | 'back';

/** Aligns at least two selected shapes by their world-space bounds. */
export function alignShapes(state: EditorState, shapeIds: readonly string[], alignment: ShapeAlignment): EditorState {
	const shapes = selectedShapes(state, shapeIds);
	if (shapes.length < 2) return state;

	const bounds = shapes.map((shape) => shapeBounds(shape));
	const target = alignmentTarget(bounds, alignment);
	const deltas = new Map<string, Vec2>();
	for (const [index, shape] of shapes.entries()) {
		const box = bounds[index];
		deltas.set(shape.id, alignmentDelta(box, alignment, target));
	}
	return translateSelectedRoots(state, shapes, deltas);
}

/** Places at least two selected shapes into a deterministic grid. */
export function gridShapes(state: EditorState, shapeIds: readonly string[], gap = 24): EditorState {
	const shapes = selectedShapes(state, shapeIds);
	if (shapes.length < 2) return state;
	const columns = Math.max(1, Math.ceil(Math.sqrt(shapes.length)));
	const items = shapes
		.map((shape) => ({ shape, bounds: shapeBounds(shape) }))
		.sort(
			(left, right) =>
				left.bounds.min.y - right.bounds.min.y ||
				left.bounds.min.x - right.bounds.min.x ||
				left.shape.id.localeCompare(right.shape.id)
		);
	const cellWidth = Math.max(...items.map(({ bounds }) => Box2.width(bounds)));
	const cellHeight = Math.max(...items.map(({ bounds }) => Box2.height(bounds)));
	const origin = items.reduce(
		(current, item) => ({ x: Math.min(current.x, item.bounds.min.x), y: Math.min(current.y, item.bounds.min.y) }),
		{ x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY }
	);
	const deltas = new Map<string, Vec2>();
	for (const [index, item] of items.entries()) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const target = {
			x: origin.x + column * (cellWidth + Math.max(0, gap)),
			y: origin.y + row * (cellHeight + Math.max(0, gap))
		};
		deltas.set(item.shape.id, { x: target.x - item.bounds.min.x, y: target.y - item.bounds.min.y });
	}
	return translateSelectedRoots(state, shapes, deltas);
}

/** Distributes at least three selected shapes with equal gaps on one axis. */
export function distributeShapes(state: EditorState, shapeIds: readonly string[], axis: LayoutAxis): EditorState {
	const shapes = selectedShapes(state, shapeIds);
	if (shapes.length < 3) return state;

	const ordered = shapes
		.map((shape) => ({ shape, bounds: shapeBounds(shape) }))
		.sort((left, right) => {
			const leftPosition = axis === 'horizontal' ? left.bounds.min.x : left.bounds.min.y;
			const rightPosition = axis === 'horizontal' ? right.bounds.min.x : right.bounds.min.y;
			return leftPosition - rightPosition || left.shape.id.localeCompare(right.shape.id);
		});
	const first = ordered[0].bounds;
	const last = ordered.at(-1)!.bounds;
	const start = axis === 'horizontal' ? first.min.x : first.min.y;
	const end = axis === 'horizontal' ? last.max.x : last.max.y;
	const totalSize = ordered.reduce(
		(total, item) => total + (axis === 'horizontal' ? Box2.width(item.bounds) : Box2.height(item.bounds)),
		0
	);
	const gap = (end - start - totalSize) / (ordered.length - 1);
	const deltas = new Map<string, Vec2>();
	let cursor = start;
	for (const item of ordered) {
		const position = axis === 'horizontal' ? item.bounds.min.x : item.bounds.min.y;
		const delta = cursor - position;
		deltas.set(item.shape.id, axis === 'horizontal' ? { x: delta, y: 0 } : { x: 0, y: delta });
		cursor += (axis === 'horizontal' ? Box2.width(item.bounds) : Box2.height(item.bounds)) + gap;
	}
	return translateSelectedRoots(state, shapes, deltas);
}

/** Groups selected root shapes in a new frame without changing their world positions. */
export function groupShapes(state: EditorState, shapeIds: readonly string[]): EditorState {
	const shapes = selectedShapes(state, shapeIds);
	const roots = removeSelectedDescendants(state, shapes);
	if (roots.length < 2) return state;
	const pageId = roots[0].pageId;
	if (roots.some((shape) => shape.pageId !== pageId)) return state;
	const page = state.doc.pages[pageId];
	if (!page) return state;
	const rootLayerIds = new Set(roots.map((shape) => shape.layerId).filter((id): id is string => Boolean(id)));
	if (rootLayerIds.size > 1) return state;

	const bounds = combineBounds(roots.map(shapeBounds));
	if (!bounds) return state;
	const containerId = createId('shape');
	const firstLayerId = roots.find((shape) => shape.layerId)?.layerId;
	const layerId = firstLayerId ?? state.ui.activeLayerId ?? page.layerIds?.[0];
	const container = ShapeRecord.createContainer(
		pageId,
		bounds.min.x,
		bounds.min.y,
		{ w: Box2.width(bounds), h: Box2.height(bounds), title: 'Frame' },
		containerId
	);
	const commonParentId = roots.every((shape) => shape.groupId === roots[0].groupId) ? roots[0].groupId : undefined;
	const nextContainer: ContainerShape = {
		...container,
		layerId,
		...(commonParentId ? { groupId: commonParentId } : {})
	};
	const orderedRoots = roots
		.slice()
		.sort((left, right) => page.shapeIds.indexOf(left.id) - page.shapeIds.indexOf(right.id));
	const nextShapes = { ...state.doc.shapes, [containerId]: nextContainer };
	for (const shape of orderedRoots) nextShapes[shape.id] = { ...shape, groupId: containerId };

	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	if (layers && layerId && layers[layerId]) {
		layers[layerId] = {
			...layers[layerId],
			shapeIds: insertBeforeFirst(
				layers[layerId].shapeIds,
				orderedRoots.map((shape) => shape.id),
				containerId
			)
		};
	}
	const nextPage = {
		...page,
		shapeIds: insertBeforeFirst(
			page.shapeIds,
			orderedRoots.map((shape) => shape.id),
			containerId
		),
		...(layers ? { layerIds: [...(page.layerIds ?? [])] } : {})
	};
	return {
		...state,
		doc: {
			...state.doc,
			shapes: nextShapes,
			pages: { ...state.doc.pages, [pageId]: nextPage },
			...(layers ? { layers } : {})
		},
		ui: { ...state.ui, selectionIds: [containerId], toolId: 'select' }
	};
}

/** Ungroups selected frames, or the frames that own selected children. */
export function ungroupShapes(state: EditorState, shapeIds: readonly string[]): EditorState {
	const selected = selectedShapes(state, shapeIds);
	const groupIds = new Set<string>();
	for (const shape of selected) {
		if (shape.type === 'container') groupIds.add(shape.id);
		else if (shape.groupId) groupIds.add(shape.groupId);
	}
	if (groupIds.size === 0) return state;

	const shapes = { ...state.doc.shapes };
	const promotedIds: string[] = [];
	const replacements = new Map<string, string[]>();
	for (const groupId of groupIds) {
		const group = state.doc.shapes[groupId];
		if (group?.type !== 'container') continue;
		const parentId = group.groupId;
		const children = Object.values(state.doc.shapes)
			.filter((shape) => shape.groupId === groupId)
			.sort((left, right) => pageOrder(state, left.id) - pageOrder(state, right.id));
		const childIds = children.map((shape) => shape.id);
		replacements.set(groupId, childIds);
		for (const shape of children) {
			shapes[shape.id] = { ...shape, ...(parentId ? { groupId: parentId } : { groupId: undefined }) };
			promotedIds.push(shape.id);
		}
		delete shapes[groupId];
	}

	const pages = { ...state.doc.pages };
	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	for (const [pageId, page] of Object.entries(pages)) {
		const shapeIds = replaceGroups(page.shapeIds, replacements);
		pages[pageId] =
			shapeIds.length === page.shapeIds.length && shapeIds.every((id, index) => id === page.shapeIds[index])
				? page
				: { ...page, shapeIds };
	}
	if (layers) {
		for (const [layerId, layer] of Object.entries(layers)) {
			const shapeIds = replaceGroups(layer.shapeIds, replacements);
			if (
				shapeIds.length !== layer.shapeIds.length ||
				shapeIds.some((id, index) => id !== layer.shapeIds[index])
			) {
				layers[layerId] = { ...layer, shapeIds };
			}
		}
	}
	const bindings = { ...state.doc.bindings };
	for (const [id, binding] of Object.entries(bindings)) {
		if (!shapes[binding.fromShapeId] || !shapes[binding.toShapeId]) delete bindings[id];
	}
	const selectionIds = promotedIds.filter((id) => shapes[id]);
	return {
		...state,
		doc: { ...state.doc, shapes, pages, bindings, ...(layers ? { layers } : {}) },
		ui: { ...state.ui, selectionIds }
	};
}

/** Translates selected root shapes and their descendants in world space. */
export function translateShapes(state: EditorState, shapeIds: readonly string[], delta: Vec2): EditorState {
	const shapes = selectedShapes(state, shapeIds);
	if (shapes.length === 0 || (delta.x === 0 && delta.y === 0)) return state;
	const deltas = new Map(shapes.map((shape) => [shape.id, delta] as const));
	return translateSelectedRoots(state, shapes, deltas);
}

/** Sets the lock flag on selected shapes. */
export function setShapesLocked(state: EditorState, shapeIds: readonly string[], locked: boolean): EditorState {
	return patchSelectedShapes(state, shapeIds, (shape) => ({ ...shape, locked }));
}

/** Sets whether agents may edit selected shapes. */
export function setShapesAgentEditable(
	state: EditorState,
	shapeIds: readonly string[],
	agentEditable: boolean
): EditorState {
	return patchSelectedShapes(state, shapeIds, (shape) => ({ ...shape, agentEditable }));
}

/** Moves selected shapes to the front or back of each owning layer. */
export function reorderShapesToEdge(
	state: EditorState,
	shapeIds: readonly string[],
	edge: ShapeOrderEdge
): EditorState {
	const pageId = state.ui.currentPageId;
	const page = pageId ? state.doc.pages[pageId] : undefined;
	if (!page || shapeIds.length === 0) return state;
	const selected = new Set(shapeIds);
	const reorder = (ids: readonly string[]) => {
		const selectedIds = ids.filter((id) => selected.has(id));
		const unselectedIds = ids.filter((id) => !selected.has(id));
		if (selectedIds.length === 0) return [...ids];
		return edge === 'front' ? [...unselectedIds, ...selectedIds] : [...selectedIds, ...unselectedIds];
	};

	if (!state.doc.layers || !page.layerIds?.length) {
		const shapeIdsAfter = reorder(page.shapeIds);
		return sameIds(shapeIdsAfter, page.shapeIds)
			? state
			: {
					...state,
					doc: {
						...state.doc,
						pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: shapeIdsAfter } }
					}
				};
	}
	const layers = { ...state.doc.layers };
	let changed = false;
	for (const layerId of page.layerIds) {
		const layer = layers[layerId];
		if (!layer) continue;
		const shapeIdsAfter = reorder(layer.shapeIds);
		if (!sameIds(shapeIdsAfter, layer.shapeIds)) {
			layers[layerId] = { ...layer, shapeIds: shapeIdsAfter };
			changed = true;
		}
	}
	if (!changed) return state;
	const shapeIdsAfter = page.layerIds.flatMap((id) => layers[id]?.shapeIds ?? []);
	return {
		...state,
		doc: { ...state.doc, layers, pages: { ...state.doc.pages, [page.id]: { ...page, shapeIds: shapeIdsAfter } } }
	};
}

function selectedShapes(state: EditorState, shapeIds: readonly string[]): Shape[] {
	const seen = new Set<string>();
	return shapeIds
		.map((id) => state.doc.shapes[id])
		.filter((shape): shape is Shape => {
			if (!shape || seen.has(shape.id) || shape.pageId !== state.ui.currentPageId) return false;
			seen.add(shape.id);
			return true;
		});
}

function removeSelectedDescendants(state: EditorState, shapes: Shape[]): Shape[] {
	const selectedIds = new Set(shapes.map((shape) => shape.id));
	return shapes.filter((shape) => {
		let parentId = shape.groupId;
		while (parentId) {
			if (selectedIds.has(parentId)) return false;
			parentId = state.doc.shapes[parentId]?.groupId;
		}
		return true;
	});
}

function translateSelectedRoots(state: EditorState, shapes: Shape[], deltas: Map<string, Vec2>): EditorState {
	const roots = removeSelectedDescendants(state, shapes);
	const selectedIds = new Set(roots.map((shape) => shape.id));
	const nextShapes = { ...state.doc.shapes };
	let changed = false;
	for (const root of roots) {
		const delta = deltas.get(root.id);
		if (!delta || (delta.x === 0 && delta.y === 0)) continue;
		for (const shape of Object.values(state.doc.shapes)) {
			if (shape.id !== root.id && !isDescendantOf(shape, selectedIds, state)) continue;
			nextShapes[shape.id] = translateShape(shape, delta);
			changed = true;
		}
	}
	return changed ? { ...state, doc: { ...state.doc, shapes: nextShapes } } : state;
}

function isDescendantOf(shape: Shape, ancestors: ReadonlySet<string>, state: EditorState): boolean {
	let parentId = shape.groupId;
	while (parentId) {
		if (ancestors.has(parentId)) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}

function translateShape(shape: Shape, delta: Vec2): Shape {
	if (shape.editorTransform) {
		return {
			...shape,
			x: shape.x + delta.x,
			y: shape.y + delta.y,
			editorTransform: {
				...shape.editorTransform,
				e: shape.editorTransform.e + delta.x,
				f: shape.editorTransform.f + delta.y
			}
		};
	}
	return { ...shape, x: shape.x + delta.x, y: shape.y + delta.y };
}

function patchSelectedShapes(
	state: EditorState,
	shapeIds: readonly string[],
	patch: (shape: Shape) => Shape
): EditorState {
	const ids = new Set(shapeIds);
	const shapes = { ...state.doc.shapes };
	let changed = false;
	for (const id of ids) {
		const shape = shapes[id];
		if (!shape || shape.pageId !== state.ui.currentPageId) continue;
		const next = patch(shape);
		if (next.locked !== shape.locked || next.agentEditable !== shape.agentEditable) {
			shapes[id] = next;
			changed = true;
		}
	}
	return changed ? { ...state, doc: { ...state.doc, shapes } } : state;
}

function alignmentTarget(bounds: Box2Type[], alignment: ShapeAlignment): number {
	switch (alignment) {
		case 'left':
			return Math.min(...bounds.map((box) => box.min.x));
		case 'center':
			return bounds.reduce((sum, box) => sum + (box.min.x + box.max.x) / 2, 0) / bounds.length;
		case 'right':
			return Math.max(...bounds.map((box) => box.max.x));
		case 'top':
			return Math.min(...bounds.map((box) => box.min.y));
		case 'middle':
			return bounds.reduce((sum, box) => sum + (box.min.y + box.max.y) / 2, 0) / bounds.length;
		case 'bottom':
			return Math.max(...bounds.map((box) => box.max.y));
	}
}

function alignmentDelta(bounds: Box2Type, alignment: ShapeAlignment, target: number): Vec2 {
	switch (alignment) {
		case 'left':
		case 'center':
		case 'right':
			return {
				x:
					target -
					(alignment === 'left'
						? bounds.min.x
						: alignment === 'right'
							? bounds.max.x
							: (bounds.min.x + bounds.max.x) / 2),
				y: 0
			};
		case 'top':
		case 'middle':
		case 'bottom':
			return {
				x: 0,
				y:
					target -
					(alignment === 'top'
						? bounds.min.y
						: alignment === 'bottom'
							? bounds.max.y
							: (bounds.min.y + bounds.max.y) / 2)
			};
	}
}

function combineBounds(bounds: Box2Type[]): Box2Type | null {
	if (bounds.length === 0) return null;
	return bounds
		.slice(1)
		.reduce(
			(combined, box) => ({
				min: { x: Math.min(combined.min.x, box.min.x), y: Math.min(combined.min.y, box.min.y) },
				max: { x: Math.max(combined.max.x, box.max.x), y: Math.max(combined.max.y, box.max.y) }
			}),
			{ min: { ...bounds[0].min }, max: { ...bounds[0].max } }
		);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function insertBeforeFirst(ids: readonly string[], removedIds: readonly string[], insertedId: string): string[] {
	const removed = new Set(removedIds);
	const firstIndex = ids.findIndex((id) => removed.has(id));
	const result = ids.filter((id) => !removed.has(id));
	result.splice(firstIndex < 0 ? result.length : Math.min(firstIndex, result.length), 0, insertedId, ...removedIds);
	return result;
}

function replaceGroups(ids: readonly string[], replacements: ReadonlyMap<string, string[]>): string[] {
	const result: string[] = [];
	const alreadyAdded = new Set<string>();
	for (const id of ids) {
		const replacement = replacements.get(id);
		const values = replacement ? replacement : [id];
		for (const value of values) {
			if (alreadyAdded.has(value)) continue;
			alreadyAdded.add(value);
			result.push(value);
		}
	}
	return result;
}

function pageOrder(state: EditorState, shapeId: string): number {
	const page = state.doc.pages[state.doc.shapes[shapeId]?.pageId ?? ''];
	const index = page?.shapeIds.indexOf(shapeId) ?? -1;
	return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
