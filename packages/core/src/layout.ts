import { shapeBoundsForState } from './geom';
import { Box2, type Box2 as Box2Type, type Vec2 } from './math';
import { createId, ShapeRecord, type ContainerShape, type ShapeRecord as Shape } from './model';
import type { EditorState } from './reactivity';

/** Axis used to distribute selected shapes. */
export type LayoutAxis = 'horizontal' | 'vertical';

/** Edge or center line used to align selected shapes. */
export type ShapeAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Edge used when moving selected shapes to the front or back of their layer. */
export type ShapeOrderEdge = 'front' | 'back';

type LayoutItem = { shape: Shape; bounds: Box2Type; locked: boolean };

/** Aligns at least two selected shapes by their world-space bounds. */
export function alignShapes(state: EditorState, shapeIds: readonly string[], alignment: ShapeAlignment): EditorState {
	const items = layoutItems(state, shapeIds, 2);
	if (items.length === 0) return state;

	const target = alignmentTarget(
		items.map((item) => item.bounds),
		alignment
	);
	const deltas = new Map<string, Vec2>();
	for (const item of items) deltas.set(item.shape.id, alignmentDelta(item.bounds, alignment, target));
	return translateSelectedRoots(
		state,
		items.map((item) => item.shape),
		deltas
	);
}

/** Places at least two selected shapes into a deterministic row-major grid. */
export function gridShapes(state: EditorState, shapeIds: readonly string[], gap = 24, columns?: number): EditorState {
	const items = layoutItems(state, shapeIds, 2);
	if (items.length === 0) return state;
	const requestedColumns =
		columns !== undefined && Number.isFinite(columns) ? Math.floor(columns) : Math.ceil(Math.sqrt(items.length));
	const columnCount = Math.max(1, Math.min(items.length, requestedColumns));
	return arrangeGrid(state, items, columnCount, gap, gap);
}

/** Places at least two selected shapes in a balanced grid using their current extent. */
export function tidyShapes(state: EditorState, shapeIds: readonly string[], gap = 24): EditorState {
	return gridShapes(state, shapeIds, gap);
}

/** Graph algorithm used by tree, flow, and radial selection layout. */
export type GraphLayoutAlgorithm = 'flow' | 'tree' | 'radial';

/** Direction used by ranked graph layouts. */
export type GraphLayoutDirection = 'top-to-bottom' | 'left-to-right';

/**
 * Places selected shapes from explicit relationship or connector bindings.
 * Visual proximity is never used to infer an edge.
 */
export function graphLayout(
	state: EditorState,
	shapeIds: readonly string[],
	algorithm: GraphLayoutAlgorithm = 'flow',
	direction: GraphLayoutDirection = 'top-to-bottom',
	nodeGap = 64,
	rankGap = 96
): EditorState {
	const items = layoutItems(state, shapeIds, 2);
	if (items.length === 0) return state;
	const ids = new Set(items.map((item) => item.shape.id));
	const edges = new Set<string>();
	const arrowEndpoints = new Map<string, Map<string, string>>();
	for (const binding of Object.values(state.doc.bindings)) {
		const isRelation = binding.type === 'relation' || binding.relationType !== undefined;
		if (
			isRelation &&
			ids.has(binding.fromShapeId) &&
			ids.has(binding.toShapeId) &&
			binding.fromShapeId !== binding.toShapeId
		) {
			edges.add(`${binding.fromShapeId}\\u0000${binding.toShapeId}`);
		}
		const source = state.doc.shapes[binding.fromShapeId];
		if (binding.type === 'arrow-end' && source?.type === 'arrow' && ids.has(binding.toShapeId)) {
			const endpoints = arrowEndpoints.get(binding.fromShapeId) ?? new Map<string, string>();
			endpoints.set(binding.handle, binding.toShapeId);
			arrowEndpoints.set(binding.fromShapeId, endpoints);
		}
	}
	for (const endpoints of arrowEndpoints.values()) {
		const source = endpoints.get('start');
		const target = endpoints.get('end');
		if (source && target && source !== target) edges.add(`${source}\\u0000${target}`);
	}
	const positions = layoutGraphPositions(
		items.map(({ shape, bounds }) => ({ id: shape.id, width: Box2.width(bounds), height: Box2.height(bounds) })),
		[...edges].map((edge) => {
			const [source, target] = edge.split('\\u0000');
			return { source: source!, target: target! };
		}),
		algorithm,
		direction,
		nodeGap,
		rankGap
	);
	const origin = {
		x: Math.min(...items.map((item) => item.bounds.min.x)),
		y: Math.min(...items.map((item) => item.bounds.min.y))
	};
	const deltas = new Map<string, Vec2>();
	for (const item of items) {
		const position = positions.get(item.shape.id);
		if (!position) return state;
		deltas.set(item.shape.id, {
			x: origin.x + position.x - item.bounds.min.x,
			y: origin.y + position.y - item.bounds.min.y
		});
	}
	return translateSelectedRoots(
		state,
		items.map((item) => item.shape),
		deltas
	);
}

/** Stacks at least two selected shapes along one axis and centers the cross-axis bounds. */
export function stackShapes(state: EditorState, shapeIds: readonly string[], axis: LayoutAxis, gap = 24): EditorState {
	const items = layoutItems(state, shapeIds, 2);
	if (items.length === 0) return state;
	const ordered = items.slice().sort((left, right) => layoutOrder(left, right, axis));
	const axisStart = Math.min(...ordered.map((item) => axisPosition(item.bounds, axis)));
	const crossCenter = ordered.reduce((sum, item) => sum + crossCenterPosition(item.bounds, axis), 0) / ordered.length;
	const deltas = new Map<string, Vec2>();
	let cursor = axisStart;
	for (const item of ordered) {
		const axisDelta = cursor - axisPosition(item.bounds, axis);
		const crossDelta = crossCenter - crossCenterPosition(item.bounds, axis);
		deltas.set(item.shape.id, combineAxisDelta(axis, axisDelta, crossDelta));
		cursor += axisSize(item.bounds, axis) + spacing(gap);
	}
	return translateSelectedRoots(
		state,
		items.map((item) => item.shape),
		deltas
	);
}

/** Distributes at least three selected shapes with equal gaps on one axis. */
export function distributeShapes(state: EditorState, shapeIds: readonly string[], axis: LayoutAxis): EditorState {
	const items = layoutItems(state, shapeIds, 3);
	if (items.length === 0) return state;
	const ordered = items.slice().sort((left, right) => layoutOrder(left, right, axis));
	const start = axisPosition(ordered[0].bounds, axis);
	const end = axisEnd(ordered.at(-1)!.bounds, axis);
	const totalSize = ordered.reduce((total, item) => total + axisSize(item.bounds, axis), 0);
	const gap = (end - start - totalSize) / (ordered.length - 1);
	const deltas = new Map<string, Vec2>();
	let cursor = start;
	for (const item of ordered) {
		deltas.set(item.shape.id, axisDelta(axis, cursor - axisPosition(item.bounds, axis)));
		cursor += axisSize(item.bounds, axis) + gap;
	}
	return translateSelectedRoots(
		state,
		items.map((item) => item.shape),
		deltas
	);
}

function arrangeGrid(
	state: EditorState,
	items: LayoutItem[],
	columns: number,
	columnGap: number,
	rowGap: number
): EditorState {
	const ordered = items
		.slice()
		.sort(
			(left, right) =>
				left.bounds.min.y - right.bounds.min.y ||
				left.bounds.min.x - right.bounds.min.x ||
				left.shape.id.localeCompare(right.shape.id)
		);
	const cellWidth = Math.max(...ordered.map((item) => Box2.width(item.bounds)));
	const cellHeight = Math.max(...ordered.map((item) => Box2.height(item.bounds)));
	const rowCount = Math.ceil(ordered.length / columns);
	const origin = {
		x: Math.min(...ordered.map((item) => item.bounds.min.x)),
		y: Math.min(...ordered.map((item) => item.bounds.min.y))
	};
	const columnX = [origin.x];
	for (let column = 1; column < columns; column++)
		columnX[column] = columnX[column - 1] + cellWidth + spacing(columnGap);
	const rowY = [origin.y];
	for (let row = 1; row < rowCount; row++) rowY[row] = rowY[row - 1] + cellHeight + spacing(rowGap);
	const deltas = new Map<string, Vec2>();
	for (const [index, item] of ordered.entries()) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		deltas.set(item.shape.id, { x: columnX[column] - item.bounds.min.x, y: rowY[row] - item.bounds.min.y });
	}
	return translateSelectedRoots(
		state,
		items.map((item) => item.shape),
		deltas
	);
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

	const bounds = combineBounds(roots.map((shape) => shapeBoundsForState(state, shape)));
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

function layoutItems(state: EditorState, shapeIds: readonly string[], minimum: number): LayoutItem[] {
	const shapes = selectedShapes(state, shapeIds);
	const selectedIds = new Set(shapes.map((shape) => shape.id));
	const roots = shapes
		.filter((shape) => {
			let parentId = shape.groupId;
			while (parentId) {
				if (selectedIds.has(parentId)) return false;
				parentId = state.doc.shapes[parentId]?.groupId;
			}
			return true;
		})
		.sort((left, right) => left.id.localeCompare(right.id));
	if (roots.length < minimum) return [];
	return roots.map((shape) => ({
		shape,
		bounds: shapeBoundsForState(state, shape),
		locked: shapeIsLocked(state, shape)
	}));
}

function shapeIsLocked(state: EditorState, shape: Shape): boolean {
	if (shape.locked) return true;
	let parentId = shape.groupId;
	while (parentId) {
		const parent = state.doc.shapes[parentId];
		if (!parent) return true;
		if (parent.locked) return true;
		parentId = parent.groupId;
	}
	return Boolean(shape.layerId && state.doc.layers?.[shape.layerId]?.locked);
}

function axisPosition(bounds: Box2Type, axis: LayoutAxis): number {
	return axis === 'horizontal' ? bounds.min.x : bounds.min.y;
}

function axisEnd(bounds: Box2Type, axis: LayoutAxis): number {
	return axisPosition(bounds, axis) + axisSize(bounds, axis);
}

function axisSize(bounds: Box2Type, axis: LayoutAxis): number {
	return axis === 'horizontal' ? Box2.width(bounds) : Box2.height(bounds);
}

function crossStart(bounds: Box2Type, axis: LayoutAxis): number {
	return axis === 'horizontal' ? bounds.min.y : bounds.min.x;
}

function crossCenterPosition(bounds: Box2Type, axis: LayoutAxis): number {
	return crossStart(bounds, axis) + axisSize(bounds, axis === 'horizontal' ? 'vertical' : 'horizontal') / 2;
}

function layoutOrder(left: LayoutItem, right: LayoutItem, axis: LayoutAxis): number {
	return (
		axisPosition(left.bounds, axis) - axisPosition(right.bounds, axis) ||
		crossStart(left.bounds, axis) - crossStart(right.bounds, axis) ||
		left.shape.id.localeCompare(right.shape.id)
	);
}

function axisDelta(axis: LayoutAxis, delta: number): Vec2 {
	return axis === 'horizontal' ? { x: delta, y: 0 } : { x: 0, y: delta };
}

function combineAxisDelta(axis: LayoutAxis, axisDeltaValue: number, crossDelta: number): Vec2 {
	return axis === 'horizontal' ? { x: axisDeltaValue, y: crossDelta } : { x: crossDelta, y: axisDeltaValue };
}

function spacing(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
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
	const roots = removeSelectedDescendants(state, shapes).filter((shape) => !shapeIsLocked(state, shape));
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

type GraphLayoutNode = { id: string; width: number; height: number };
type GraphLayoutEdge = { source: string; target: string };

function layoutGraphPositions(
	nodes: GraphLayoutNode[],
	edges: GraphLayoutEdge[],
	algorithm: GraphLayoutAlgorithm,
	direction: GraphLayoutDirection,
	nodeGap: number,
	rankGap: number
): Map<string, Vec2> {
	const gap = spacing(nodeGap);
	const rankSpacing = spacing(rankGap);
	const ordered = nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
	const indices = new Map(ordered.map((node, index) => [node.id, index]));
	const outgoing = ordered.map(() => [] as number[]);
	for (const edge of edges) {
		const source = indices.get(edge.source);
		const target = indices.get(edge.target);
		if (source === undefined || target === undefined || source === target) continue;
		if (!outgoing[source].includes(target)) outgoing[source].push(target);
	}
	for (const targets of outgoing) targets.sort((left, right) => ordered[left]!.id.localeCompare(ordered[right]!.id));
	const ranks = graphRanks(outgoing);
	const result = new Map<string, Vec2>();
	if (algorithm === 'radial') {
		const rings = new Map<number, number[]>();
		for (const [index, rank] of ranks.entries()) {
			const ring = rings.get(rank) ?? [];
			ring.push(index);
			rings.set(rank, ring);
		}
		const radiusStep = Math.max(
			ordered.reduce((maximum, node) => Math.max(maximum, node.width, node.height), 0) + rankSpacing,
			gap + 1
		);
		for (const [depth, ring] of [...rings.entries()].sort(([left], [right]) => left - right)) {
			ring.sort((left, right) => ordered[left]!.id.localeCompare(ordered[right]!.id));
			const radius = radiusStep * (depth + (ring.length > 1 ? 1 : 0));
			for (const [offset, index] of ring.entries()) {
				const angle = -Math.PI / 2 + (Math.PI * 2 * offset) / ring.length;
				result.set(ordered[index]!.id, {
					x: radius * Math.cos(angle) - ordered[index]!.width / 2,
					y: radius * Math.sin(angle) - ordered[index]!.height / 2
				});
			}
		}
	} else {
		const grouped = new Map<number, number[]>();
		for (const [index, rank] of ranks.entries()) {
			const group = grouped.get(rank) ?? [];
			group.push(index);
			grouped.set(rank, group);
		}
		let rankCursor = 0;
		for (const rank of [...grouped.keys()].sort((left, right) => left - right)) {
			const group = grouped.get(rank)!;
			group.sort((left, right) => ordered[left]!.id.localeCompare(ordered[right]!.id));
			const rankExtent = Math.max(
				...group.map((index) =>
					direction === 'top-to-bottom' ? ordered[index]!.height : ordered[index]!.width
				),
				0
			);
			let crossCursor = 0;
			for (const index of group) {
				const node = ordered[index]!;
				result.set(node.id, {
					x: direction === 'top-to-bottom' ? crossCursor : rankCursor,
					y: direction === 'top-to-bottom' ? rankCursor : crossCursor
				});
				crossCursor += (direction === 'top-to-bottom' ? node.width : node.height) + gap;
			}
			rankCursor += rankExtent + rankSpacing;
		}
	}
	const minX = Math.min(...[...result.values()].map((position) => position.x));
	const minY = Math.min(...[...result.values()].map((position) => position.y));
	for (const position of result.values()) {
		position.x -= minX;
		position.y -= minY;
	}
	return result;
}

function graphRanks(outgoing: number[][]): Map<number, number> {
	const components = graphComponents(outgoing);
	const componentCount = Math.max(...components) + 1;
	const componentEdges = Array.from({ length: componentCount }, () => new Set<number>());
	const indegree = Array.from({ length: componentCount }, () => 0);
	for (const [source, targets] of outgoing.entries()) {
		for (const target of targets) {
			const from = components[source]!;
			const to = components[target]!;
			if (from !== to && !componentEdges[from]!.has(to)) {
				componentEdges[from]!.add(to);
				indegree[to] = indegree[to]! + 1;
			}
		}
	}
	const queue = indegree.flatMap((degree, component) => (degree === 0 ? [component] : []));
	const componentRanks = Array.from({ length: componentCount }, () => 0);
	while (queue.length > 0) {
		queue.sort((left, right) => left - right);
		const component = queue.shift()!;
		for (const target of [...componentEdges[component]!].sort((left, right) => left - right)) {
			componentRanks[target] = Math.max(componentRanks[target]!, componentRanks[component]! + 1);
			indegree[target] = indegree[target]! - 1;
			if (indegree[target] === 0) queue.push(target);
		}
	}
	return new Map(components.map((component, index) => [index, componentRanks[component]!]));
}

function graphComponents(outgoing: number[][]): number[] {
	const reverse = outgoing.map(() => [] as number[]);
	for (const [source, targets] of outgoing.entries()) for (const target of targets) reverse[target]!.push(source);
	for (const targets of reverse) targets.sort((left, right) => left - right);
	const visited = outgoing.map(() => false);
	const order: number[] = [];
	const visit = (node: number, graph: number[][]) => {
		if (visited[node]) return;
		visited[node] = true;
		for (const target of graph[node]!) visit(target, graph);
		order.push(node);
	};
	for (let node = 0; node < outgoing.length; node++) visit(node, outgoing);
	const components = outgoing.map(() => -1);
	const assign = (node: number, component: number) => {
		if (components[node] !== -1) return;
		components[node] = component;
		for (const target of reverse[node]!) assign(target, component);
	};
	let component = 0;
	for (const node of order.reverse()) {
		if (components[node] === -1) {
			assign(node, component);
			component++;
		}
	}
	return components;
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
