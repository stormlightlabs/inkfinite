import { computeNormalizedAnchor, shapeCenter } from './geom';
import { BindingRecord, createId, ShapeRecord, type ShapeRecord as ShapeRecordType } from './model';
import type { EditorState } from './reactivity';

/** World-space offset used when a selection is duplicated and connected. */
export type DuplicateConnectOffset = { x: number; y: number };

type DuplicateResult = { state: EditorState; mapping: Map<string, string>; roots: string[] };

/** Shape kinds supported by the selection conversion command. */
export type SelectionConversionTarget = 'rect' | 'ellipse';

/**
 * Converts selected drawable shapes to a rectangle or ellipse in one editor
 * state update. Common shape fields and transforms stay on the existing
 * record; persistence turns the type change into one Rust conversion
 * transaction.
 */
export function convertSelectedShapes(state: EditorState, target: SelectionConversionTarget): EditorState {
	if (state.ui.selectionIds.length === 0) return state;
	const hasBinding = (shapeId: string) =>
		Object.values(state.doc.bindings).some(
			(binding) => binding.fromShapeId === shapeId || binding.toShapeId === shapeId
		);
	const shapes = { ...state.doc.shapes };
	let changed = false;
	for (const shapeId of state.ui.selectionIds) {
		const shape = state.doc.shapes[shapeId];
		if (
			!shape ||
			(shape.type !== 'rect' && shape.type !== 'ellipse') ||
			shape.type === target ||
			hasBinding(shape.id)
		)
			continue;
		const { w, h, fill, stroke } = shape.props;
		const props = target === 'rect' ? { w, h, fill, stroke, radius: 0 } : { w, h, fill, stroke };
		shapes[shape.id] = { ...shape, type: target, props } as ShapeRecordType;
		changed = true;
	}
	return changed ? { ...state, doc: { ...state.doc, shapes } } : state;
}

/**
 * Duplicate the selected roots and their descendants.
 *
 * The returned selection contains the copied roots, while internal bindings are
 * copied to the corresponding duplicate targets. A zero offset is useful for
 * pointer gestures that will move the duplicate after it is created.
 */
export function duplicateSelection(
	state: EditorState,
	offset: DuplicateConnectOffset = { x: 12, y: 12 }
): EditorState | null {
	return duplicateState(state, offset)?.state ?? null;
}

/**
 * Duplicate each selected root, place the copies beside the originals, and
 * connect each original to its copy with a bound arrow.
 */
export function duplicateAndConnectSelection(
	state: EditorState,
	offset: DuplicateConnectOffset = { x: 160, y: 0 }
): EditorState | null {
	const result = duplicateState(state, offset);
	if (!result) return null;

	const shapes = { ...result.state.doc.shapes };
	const bindings = { ...result.state.doc.bindings };
	const pages = { ...result.state.doc.pages };
	const layers = result.state.doc.layers ? { ...result.state.doc.layers } : undefined;

	for (const sourceId of result.roots) {
		const source = state.doc.shapes[sourceId];
		const copyId = result.mapping.get(sourceId);
		const copy = copyId ? shapes[copyId] : undefined;
		if (!source || !copy) continue;

		const sourceCenter = shapeCenter(source);
		const copyCenter = shapeCenter(copy);
		const arrowId = createId('shape');
		const startAnchor = computeNormalizedAnchor(copyCenter, source);
		const startBinding = BindingRecord.create(arrowId, source.id, 'start', { kind: 'edge', ...startAnchor });
		const endAnchor = computeNormalizedAnchor(sourceCenter, copy);
		const endBinding = BindingRecord.create(arrowId, copy.id, 'end', { kind: 'edge', ...endAnchor });
		const style =
			source.type === 'arrow'
				? { ...source.props.style, headStart: false, headEnd: true }
				: { stroke: '#2563eb', width: 2, headEnd: true };
		const arrow = ShapeRecord.createArrow(
			source.pageId,
			0,
			0,
			{
				points: [sourceCenter, copyCenter],
				start: { kind: 'bound', bindingId: startBinding.id },
				end: { kind: 'bound', bindingId: endBinding.id },
				style,
				routing: { kind: 'straight' }
			},
			arrowId
		);
		arrow.layerId = source.layerId;
		shapes[arrow.id] = arrow;
		bindings[startBinding.id] = startBinding;
		bindings[endBinding.id] = endBinding;
		appendShapeToCollections(pages, layers, arrow);
	}

	return { ...result.state, doc: { ...result.state.doc, pages, shapes, bindings, ...(layers ? { layers } : {}) } };
}

function duplicateState(state: EditorState, offset: DuplicateConnectOffset): DuplicateResult | null {
	const selectedIds = new Set(state.ui.selectionIds);
	const roots = state.ui.selectionIds.filter((id) => !hasSelectedAncestor(state, id, selectedIds));
	if (roots.length === 0) return null;

	const included = Object.values(state.doc.shapes).filter(
		(shape) => roots.includes(shape.id) || roots.some((root) => hasAncestor(shape, root, state))
	);
	const mapping = new Map(included.map((shape) => [shape.id, createId('shape')]));
	const shapes = { ...state.doc.shapes };

	for (const source of included) {
		const copy = ShapeRecord.clone(source);
		const id = mapping.get(source.id)!;
		const parentId = source.groupId ? mapping.get(source.groupId) : undefined;
		shapes[id] = {
			...copy,
			id,
			x: copy.x + offset.x,
			y: copy.y + offset.y,
			editorTransform: copy.editorTransform
				? {
						...copy.editorTransform,
						e: copy.editorTransform.e + offset.x,
						f: copy.editorTransform.f + offset.y
					}
				: undefined,
			...(parentId ? { groupId: parentId } : { groupId: undefined })
		};
	}

	const pages = { ...state.doc.pages };
	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	const copiedIds = included.map((shape) => mapping.get(shape.id)!);
	for (const page of Object.values(pages)) {
		const added = copiedIds.filter((id) => shapes[id]?.pageId === page.id);
		if (added.length > 0) pages[page.id] = { ...page, shapeIds: [...page.shapeIds, ...added] };
	}
	if (layers) {
		for (const layer of Object.values(layers)) {
			const added = copiedIds.filter((id) => shapes[id]?.layerId === layer.id);
			if (added.length > 0) layers[layer.id] = { ...layer, shapeIds: [...layer.shapeIds, ...added] };
		}
	}

	const bindings = { ...state.doc.bindings };
	for (const binding of Object.values(state.doc.bindings)) {
		const fromShapeId = mapping.get(binding.fromShapeId);
		if (!fromShapeId) continue;
		const id = createId('binding');
		const toShapeId = mapping.get(binding.toShapeId) ?? binding.toShapeId;
		bindings[id] = { ...BindingRecord.clone(binding), id, fromShapeId, toShapeId };
	}
	for (const source of included) {
		const id = mapping.get(source.id);
		const copy = id ? shapes[id] : undefined;
		if (!id || !copy || copy.type !== 'arrow' || source.type !== 'arrow') continue;
		const copiedBindings = Object.values(bindings).filter((binding) => binding.fromShapeId === id);
		const handleBinding = (handle: 'start' | 'end') => {
			const originalBindingId = source.props[handle].bindingId;
			const original = originalBindingId ? state.doc.bindings[originalBindingId] : undefined;
			const copied = copiedBindings.find(
				(binding) =>
					original &&
					binding.toShapeId === (mapping.get(original.toShapeId) ?? original.toShapeId) &&
					binding.handle === handle
			);
			return copied ? { kind: 'bound' as const, bindingId: copied.id } : { kind: 'free' as const };
		};
		shapes[id] = { ...copy, props: { ...copy.props, start: handleBinding('start'), end: handleBinding('end') } };
	}

	const rootCopies = roots.map((id) => mapping.get(id)).filter((id): id is string => Boolean(id));
	return {
		state: {
			...state,
			doc: { ...state.doc, pages, shapes, bindings, ...(layers ? { layers } : {}) },
			ui: { ...state.ui, selectionIds: rootCopies }
		},
		mapping,
		roots
	};
}

function appendShapeToCollections(
	pages: Record<string, { shapeIds: string[] }>,
	layers: Record<string, { shapeIds: string[] }> | undefined,
	shape: ShapeRecordType
): void {
	const page = pages[shape.pageId];
	if (page) pages[shape.pageId] = { ...page, shapeIds: [...page.shapeIds, shape.id] };
	if (layers && shape.layerId && layers[shape.layerId]) {
		layers[shape.layerId] = { ...layers[shape.layerId], shapeIds: [...layers[shape.layerId].shapeIds, shape.id] };
	}
}

function hasSelectedAncestor(state: EditorState, id: string, selected: ReadonlySet<string>): boolean {
	let parentId = state.doc.shapes[id]?.groupId;
	while (parentId) {
		if (selected.has(parentId)) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}

function hasAncestor(shape: ShapeRecordType, ancestorId: string, state: EditorState): boolean {
	let parentId = shape.groupId;
	while (parentId) {
		if (parentId === ancestorId) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}
