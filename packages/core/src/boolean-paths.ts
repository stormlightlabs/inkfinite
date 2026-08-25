import polygonClipping, { type MultiPolygon, type Pair, type Ring } from 'polygon-clipping';
import { flattenPath, transformPathGeometry } from './path-metrics';
import { Mat3 } from './math';
import type { Mat3 as Mat3Type } from './math';
import { ensureDocumentLayers, EditorShapeRecord } from './editor-model';
import type { EditorDocument, PathGeometry, PathShape, EditorShapeRecord as Shape } from './editor-model';
import type { EditorState } from './reactivity';
import { shapeTransform } from './geom';

/** Boolean operation applied to selected filled paths in selection order. */
export type BooleanPathOperation = 'union' | 'intersection' | 'difference' | 'exclusion';

/**
 * Combines two or more native paths into the first selected path.
 *
 * Curves are flattened only for the boolean calculation. The result is stored
 * as ordinary closed native path subpaths in the first path's local space, so
 * the first path keeps its transform, paint, metadata, and identity.
 *
 * Returns `null` when the selection is not a valid path selection or when the
 * operation removes every filled region.
 */
export function applyBooleanPathOperation(
	state: EditorState,
	shapeIds: readonly string[],
	operation: BooleanPathOperation
): EditorState | null {
	const selected = shapeIds.map((id) => state.doc.shapes[id]);
	if (selected.length < 2 || selected.some((shape) => !shape || shape.type !== 'path')) {
		return null;
	}
	const paths = selected as PathShape[];
	if (new Set(paths.map((path) => path.id)).size !== paths.length) return null;
	if (
		paths.some((path) => path.pageId !== paths[0]!.pageId || path.props.subpaths.some((subpath) => !subpath.closed))
	) {
		return null;
	}

	const worldGeometries = paths.map((path) => transformPathGeometry(path.props, shapeTransform(path)));
	const polygons = worldGeometries.map((geometry) => geometryToMultiPolygon(geometry));
	if (polygons.some((geometry) => geometry.length === 0)) return null;

	const result = runBoolean(polygons, operation);
	if (result.length === 0) return null;
	const inverse = Mat3.invert(shapeTransform(paths[0]!));
	if (!inverse) return null;
	const subpaths = result
		.flatMap((polygon) => polygon)
		.map((ring) => ringToSubpath(ring, inverse))
		.filter((subpath): subpath is NonNullable<typeof subpath> => subpath !== null);
	if (subpaths.length === 0) return null;

	const first = EditorShapeRecord.clone(paths[0]!) as PathShape;
	first.props = { ...first.props, subpaths };
	const removed = new Set(paths.slice(1).map((path) => path.id));
	const shapes = Object.fromEntries(
		Object.entries(state.doc.shapes)
			.filter(([id]) => !removed.has(id))
			.map(([id, shape]) => [id, id === first.id ? first : shape])
	);
	const pages = Object.fromEntries(
		Object.entries(state.doc.pages).map(([id, page]) => [
			id,
			{ ...page, shapeIds: page.shapeIds.filter((id) => !removed.has(id)) }
		])
	);
	const layers = state.doc.layers
		? Object.fromEntries(
				Object.entries(state.doc.layers).map(([id, layer]) => [
					id,
					{ ...layer, shapeIds: layer.shapeIds.filter((shapeId) => !removed.has(shapeId)) }
				])
			)
		: undefined;
	const bindings = Object.fromEntries(
		Object.entries(state.doc.bindings).filter(
			([, binding]) => !removed.has(binding.fromShapeId) && !removed.has(binding.toShapeId)
		)
	);
	const document: EditorDocument = { ...state.doc, pages, shapes, bindings, ...(layers ? { layers } : {}) };
	return {
		...state,
		doc: ensureDocumentLayers(document),
		ui: { ...state.ui, selectionIds: [first.id], pathSelection: undefined, toolId: 'select' }
	};
}

function runBoolean(polygons: MultiPolygon[], operation: BooleanPathOperation): MultiPolygon {
	const first = polygons[0]!;
	const rest = polygons.slice(1);
	switch (operation) {
		case 'union':
			return polygonClipping.union(first, ...rest);
		case 'intersection':
			return polygonClipping.intersection(first, ...rest);
		case 'difference':
			return polygonClipping.difference(first, ...rest);
		case 'exclusion':
			return polygonClipping.xor(first, ...rest);
	}
}

function geometryToMultiPolygon(geometry: PathGeometry): MultiPolygon {
	const rings = flattenPath(geometry, 0.1).subpaths.map((subpath) =>
		subpath.points.map((point) => [point.x, point.y] as Pair)
	);
	const parent = rings.map(
		(ring, index) =>
			rings
				.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
				.filter(({ candidateIndex }) => candidateIndex !== index)
				.filter(({ candidate }) => pointInRing(ring[0]!, candidate))
				.sort((left, right) => Math.abs(ringArea(left.candidate)) - Math.abs(ringArea(right.candidate)))[0]
				?.candidateIndex ?? null
	);
	const depth = rings.map((_, index) => {
		let current = parent[index];
		let count = 0;
		while (current !== null) {
			count += 1;
			current = parent[current]!;
		}
		return count;
	});
	return rings.flatMap((ring, index) => {
		if (depth[index]! % 2 !== 0) return [];
		const holes = rings.filter((_, childIndex) => parent[childIndex] === index && depth[childIndex]! % 2 === 1);
		return [[ring, ...holes]];
	});
}

function ringToSubpath(ring: Ring, inverse: Mat3Type): PathGeometry['subpaths'][number] | null {
	const points = ring
		.map(([x, y]) => Mat3.transformPoint(inverse, { x, y }))
		.filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y);
	if (points.length > 1 && points[0]!.x === points.at(-1)!.x && points[0]!.y === points.at(-1)!.y) {
		points.pop();
	}
	if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
		return null;
	}
	return {
		segments: [{ type: 'move', to: points[0]! }, ...points.slice(1).map((to) => ({ type: 'line' as const, to }))],
		closed: true
	};
}

function ringArea(ring: Ring): number {
	return ring.reduce(
		(area, point, index) =>
			area + point[0] * ring[(index + 1) % ring.length]![1] - ring[(index + 1) % ring.length]![0] * point[1],
		0
	);
}

function pointInRing(point: Pair, ring: Ring): boolean {
	let inside = false;
	for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
		const current = ring[index]!;
		const prior = ring[previous]!;
		const crosses = current[1] > point[1] !== prior[1] > point[1];
		if (
			crosses &&
			point[0] < ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0]
		) {
			inside = !inside;
		}
	}
	return inside;
}

/** Returns whether every selected object is a closed native path. */
export function canBooleanPathSelection(state: EditorState, shapeIds = state.ui.selectionIds): boolean {
	const selected = shapeIds.map((id) => state.doc.shapes[id]);
	return (
		selected.length >= 2 &&
		selected.every(
			(shape): shape is Shape & { type: 'path' } =>
				shape?.type === 'path' && shape.props.subpaths.every((subpath) => subpath.closed)
		) &&
		new Set(selected.map((shape) => shape?.pageId)).size === 1
	);
}

/** Applies a boolean operation to the current selection when it is eligible. */
export function booleanPathSelection(state: EditorState, operation: BooleanPathOperation): EditorState | null {
	return canBooleanPathSelection(state) ? applyBooleanPathOperation(state, state.ui.selectionIds, operation) : null;
}
