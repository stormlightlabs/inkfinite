import {
	BindingRecord,
	createId,
	ShapeRecord,
	type BindingRecord as Binding,
	type EditorState,
	type ShapeRecord as Shape
} from '@inkfinite/core';

const CLIPBOARD_KIND = 'inkfinite-selection';
let fallbackClipboard: string | null = null;

/** Serialized native selection used by copy, cut, and paste commands. */
export type ClipboardPayload = {
	kind: typeof CLIPBOARD_KIND;
	version: 1;
	shapes: Shape[];
	bindings: Binding[];
	rootIds: string[];
};

/** Returns the selected shapes and descendants in page draw order. */
export function createClipboardPayload(state: EditorState): ClipboardPayload | null {
	const selectedIds = new Set(state.ui.selectionIds);
	const rootIds = state.ui.selectionIds.filter(
		(id) => !hasSelectedAncestor(state, id, selectedIds)
	);
	if (rootIds.length === 0) return null;
	const includedIds = new Set<string>();
	for (const shape of Object.values(state.doc.shapes)) {
		if (rootIds.some((rootId) => shape.id === rootId || hasAncestor(shape, rootId, state)))
			includedIds.add(shape.id);
	}
	const shapes = (state.doc.pages[state.ui.currentPageId ?? '']?.shapeIds ?? [])
		.filter((id) => includedIds.has(id))
		.map((id) => state.doc.shapes[id])
		.filter((shape): shape is Shape => Boolean(shape))
		.map((shape) => ShapeRecord.clone(shape));
	const bindings = Object.values(state.doc.bindings)
		.filter(
			(binding) => includedIds.has(binding.fromShapeId) && includedIds.has(binding.toShapeId)
		)
		.map((binding) => BindingRecord.clone(binding));
	return { kind: CLIPBOARD_KIND, version: 1, shapes, bindings, rootIds: [...rootIds] };
}

/** Writes a native selection to the system clipboard when available. */
export async function copySelection(state: EditorState): Promise<boolean> {
	const payload = createClipboardPayload(state);
	if (!payload) return false;
	const text = JSON.stringify(payload);
	fallbackClipboard = text;
	if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
	}
	return true;
}

/** Reads a native selection from the system clipboard or this editor session. */
export async function readClipboard(): Promise<ClipboardPayload | null> {
	let text = fallbackClipboard;
	if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
		try {
			text = (await navigator.clipboard.readText()) || fallbackClipboard;
		} catch (error) {
			if (!fallbackClipboard) throw error;
		}
	}
	if (!text) return null;
	try {
		const value = JSON.parse(text) as Partial<ClipboardPayload>;
		if (value.kind !== CLIPBOARD_KIND || value.version !== 1 || !Array.isArray(value.shapes))
			return null;
		return {
			kind: CLIPBOARD_KIND,
			version: 1,
			shapes: value.shapes as Shape[],
			bindings: Array.isArray(value.bindings) ? (value.bindings as Binding[]) : [],
			rootIds: Array.isArray(value.rootIds) ? value.rootIds : []
		};
	} catch {
		return null;
	}
}

/** Pastes a native selection into the active layer with a small offset. */
export function pasteClipboard(
	state: EditorState,
	payload: ClipboardPayload,
	offset = 24
): EditorState {
	const pageId = state.ui.currentPageId;
	if (!pageId) return state;
	const page = state.doc.pages[pageId];
	if (!page || payload.shapes.length === 0) return state;
	const activeLayerId = state.ui.activeLayerId ?? page.layerIds?.[0];
	const mapping = new Map<string, string>();
	for (const shape of payload.shapes) mapping.set(shape.id, createId('shape'));
	const shapes = { ...state.doc.shapes };
	const pastedIds: string[] = [];
	for (const source of payload.shapes) {
		const id = mapping.get(source.id);
		if (!id) continue;
		const copy = ShapeRecord.clone(source);
		const translated = copy.editorTransform
			? {
					...copy,
					x: copy.x + offset,
					y: copy.y + offset,
					editorTransform: {
						...copy.editorTransform,
						e: copy.editorTransform.e + offset,
						f: copy.editorTransform.f + offset
					}
				}
			: { ...copy, x: copy.x + offset, y: copy.y + offset };
		const parentId = copy.groupId ? mapping.get(copy.groupId) : undefined;
		shapes[id] = {
			...translated,
			id,
			pageId,
			...(parentId ? { groupId: parentId } : { groupId: undefined }),
			...(activeLayerId ? { layerId: activeLayerId } : {})
		};
		if (payload.rootIds.includes(source.id)) pastedIds.push(id);
	}
	const bindings = { ...state.doc.bindings };
	for (const binding of payload.bindings) {
		const fromShapeId = mapping.get(binding.fromShapeId);
		const toShapeId = mapping.get(binding.toShapeId);
		if (!fromShapeId || !toShapeId) continue;
		const id = createId('binding');
		bindings[id] = { ...BindingRecord.clone(binding), id, fromShapeId, toShapeId };
	}
	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	let pages = { ...state.doc.pages };
	if (layers && activeLayerId && layers[activeLayerId]) {
		layers[activeLayerId] = {
			...layers[activeLayerId],
			shapeIds: [...layers[activeLayerId].shapeIds, ...mapping.values()]
		};
		pages[pageId] = {
			...page,
			shapeIds: page.layerIds?.flatMap((id) => layers[id]?.shapeIds ?? []) ?? page.shapeIds
		};
	} else {
		pages[pageId] = { ...page, shapeIds: [...page.shapeIds, ...mapping.values()] };
	}
	return {
		...state,
		doc: { ...state.doc, pages, shapes, bindings, ...(layers ? { layers } : {}) },
		ui: { ...state.ui, selectionIds: pastedIds, toolId: 'select' }
	};
}

function hasSelectedAncestor(
	state: EditorState,
	id: string,
	selectedIds: ReadonlySet<string>
): boolean {
	let parentId = state.doc.shapes[id]?.groupId;
	while (parentId) {
		if (selectedIds.has(parentId)) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}

function hasAncestor(shape: Shape, ancestorId: string, state: EditorState): boolean {
	let parentId = shape.groupId;
	while (parentId) {
		if (parentId === ancestorId) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}
