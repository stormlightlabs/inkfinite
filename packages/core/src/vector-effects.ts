import { localToWorld, worldToLocal } from './geom';
import type { EditorState } from './reactivity';
import type { PathGeometry, PathSegment, EditorShapeRecord } from './editor-model';
import type { Vec2 } from './math';

/** Returns whether the current selection can make one path clip another shape. */
export function canClipSelection(state: EditorState): boolean {
	const selected = state.ui.selectionIds.map((id) => state.doc.shapes[id]).filter(Boolean);
	return (
		selected.length === 2 &&
		selected.some((shape) => shape.type === 'path') &&
		selected.some((shape) => shape.type !== 'path')
	);
}

/**
 * Uses the selected path as a local, editable clip path on the other selected
 * shape. The source path is removed because it becomes effect geometry rather
 * than an independently painted object.
 */
export function clipSelection(state: EditorState): EditorState | null {
	if (!canClipSelection(state)) return null;
	const selected = state.ui.selectionIds.map((id) => state.doc.shapes[id]).filter(Boolean) as EditorShapeRecord[];
	const source = selected.find((shape) => shape.type === 'path');
	const target = selected.find((shape) => shape.type !== 'path');
	if (!source || source.type !== 'path' || !target) return null;

	const clipPath = transformGeometry(source.props, (point) => worldToLocal(localToWorld(source, point), target));
	const shapes = { ...state.doc.shapes };
	shapes[target.id] = { ...target, props: { ...target.props, clipPath } } as EditorShapeRecord;
	delete shapes[source.id];
	const pages = Object.fromEntries(
		Object.entries(state.doc.pages).map(([id, page]) => [
			id,
			{ ...page, shapeIds: page.shapeIds.filter((shapeId) => shapeId !== source.id) }
		])
	);
	const layers = Object.fromEntries(
		Object.entries(state.doc.layers ?? {}).map(([id, layer]) => [
			id,
			{ ...layer, shapeIds: layer.shapeIds.filter((shapeId) => shapeId !== source.id) }
		])
	);
	const bindings = Object.fromEntries(
		Object.entries(state.doc.bindings).filter(
			([, binding]) => binding.fromShapeId !== source.id && binding.toShapeId !== source.id
		)
	);
	return {
		...state,
		doc: { ...state.doc, shapes, pages, layers, bindings },
		ui: { ...state.ui, selectionIds: [target.id], pathSelection: undefined }
	};
}

/** Removes the editable clip path from every selected shape. */
export function removeClipFromSelection(state: EditorState): EditorState | null {
	const targets = state.ui.selectionIds
		.map((id) => state.doc.shapes[id])
		.filter((shape): shape is EditorShapeRecord =>
			Boolean(shape?.props && 'clipPath' in shape.props && shape.props.clipPath)
		);
	if (targets.length === 0) return null;
	const targetIds = new Set(targets.map((shape) => shape.id));
	const shapes = { ...state.doc.shapes };
	for (const target of targets) {
		const props = { ...target.props } as Record<string, unknown>;
		delete props.clipPath;
		shapes[target.id] = { ...target, props } as EditorShapeRecord;
	}
	return { ...state, doc: { ...state.doc, shapes }, ui: { ...state.ui, selectionIds: [...targetIds] } };
}

function transformGeometry(geometry: PathGeometry, transform: (point: Vec2) => Vec2): PathGeometry {
	return {
		fill_rule: geometry.fill_rule,
		subpaths: geometry.subpaths.map((subpath) => ({
			...subpath,
			segments: subpath.segments.map((segment) => transformSegment(segment, transform)),
			handle_modes: subpath.handle_modes ? [...subpath.handle_modes] : subpath.handle_modes
		}))
	};
}

function transformSegment(segment: PathSegment, transform: (point: Vec2) => Vec2): PathSegment {
	switch (segment.type) {
		case 'move':
		case 'line':
			return { ...segment, to: transform(segment.to) };
		case 'quadratic':
			return { ...segment, control: transform(segment.control), to: transform(segment.to) };
		case 'cubic':
			return {
				...segment,
				control_1: transform(segment.control_1),
				control_2: transform(segment.control_2),
				to: transform(segment.to)
			};
	}
}
