import type { EditorState } from './reactivity';
import { createId, type LayerRecord } from './model';

/** Required handling for shapes when deleting a non-empty layer. */
export type LayerDeleteDisposition = { kind: 'move'; destinationLayerId: string } | { kind: 'delete' };

/** Creates and activates a layer at the front of the current page. */
export function createLayer(state: EditorState, name = 'Layer'): EditorState {
	const pageId = state.ui.currentPageId;
	if (!pageId) return state;
	const page = state.doc.pages[pageId];
	if (!page) return state;
	const layer: LayerRecord = {
		id: createId('layer'),
		pageId,
		name: name.trim() || 'Layer',
		shapeIds: [],
		visible: true,
		locked: false,
		opacity: 1
	};
	return {
		...state,
		doc: {
			...state.doc,
			pages: { ...state.doc.pages, [pageId]: { ...page, layerIds: [...(page.layerIds ?? []), layer.id] } },
			layers: { ...(state.doc.layers ?? {}), [layer.id]: layer }
		},
		ui: { ...state.ui, activeLayerId: layer.id, selectionIds: [] }
	};
}

/** Changes mutable layer presentation fields. */
export function patchLayer(
	state: EditorState,
	layerId: string,
	patch: Partial<Pick<LayerRecord, 'name' | 'visible' | 'locked' | 'opacity'>>
): EditorState {
	const layer = state.doc.layers?.[layerId];
	if (!layer) return state;
	const name = patch.name === undefined ? layer.name : patch.name.trim();
	if (!name) return state;
	const opacity = patch.opacity === undefined ? layer.opacity : Math.max(0, Math.min(1, patch.opacity));
	const nextLayer = { ...layer, ...patch, name, opacity };
	const hiddenOrLocked = !nextLayer.visible || nextLayer.locked;
	const selectionIds = hiddenOrLocked
		? state.ui.selectionIds.filter((id) => !nextLayer.shapeIds.includes(id))
		: state.ui.selectionIds;
	return {
		...state,
		doc: { ...state.doc, layers: { ...state.doc.layers, [layerId]: nextLayer } },
		ui: { ...state.ui, selectionIds }
	};
}

/** Moves a layer by one position in its page's draw order. */
export function moveLayer(state: EditorState, layerId: string, direction: 'forward' | 'backward'): EditorState {
	const layer = state.doc.layers?.[layerId];
	const page = layer ? state.doc.pages[layer.pageId] : undefined;
	if (!layer || !page?.layerIds) return state;
	const layerIds = [...page.layerIds];
	const index = layerIds.indexOf(layerId);
	const destination = index + (direction === 'forward' ? 1 : -1);
	if (index < 0 || destination < 0 || destination >= layerIds.length) return state;
	[layerIds[index], layerIds[destination]] = [layerIds[destination], layerIds[index]];
	const shapeIds = layerIds.flatMap((id) => state.doc.layers?.[id]?.shapeIds ?? []);
	return {
		...state,
		doc: { ...state.doc, pages: { ...state.doc.pages, [page.id]: { ...page, layerIds, shapeIds } } }
	};
}

/** Deletes a layer after the caller explicitly handles any contained shapes. */
export function deleteLayer(state: EditorState, layerId: string, disposition?: LayerDeleteDisposition): EditorState {
	const layer = state.doc.layers?.[layerId];
	const page = layer ? state.doc.pages[layer.pageId] : undefined;
	if (!layer || !page?.layerIds || page.layerIds.length === 1) return state;
	if (layer.shapeIds.length > 0 && !disposition) return state;

	const layers = { ...(state.doc.layers ?? {}) };
	const shapes = { ...state.doc.shapes };
	const bindings = { ...state.doc.bindings };
	if (disposition?.kind === 'move') {
		const destination = layers[disposition.destinationLayerId];
		if (!destination || destination.pageId !== page.id || destination.id === layerId || destination.locked)
			return state;
		layers[destination.id] = { ...destination, shapeIds: [...destination.shapeIds, ...layer.shapeIds] };
		for (const shapeId of layer.shapeIds) shapes[shapeId] = { ...shapes[shapeId], layerId: destination.id };
	} else if (disposition?.kind === 'delete') {
		const deletedIds = new Set(layer.shapeIds);
		for (const shapeId of deletedIds) delete shapes[shapeId];
		for (const [bindingId, binding] of Object.entries(bindings)) {
			if (deletedIds.has(binding.fromShapeId) || deletedIds.has(binding.toShapeId)) delete bindings[bindingId];
		}
	}
	delete layers[layerId];
	const layerIds = page.layerIds.filter((id) => id !== layerId);
	const shapeIds = layerIds.flatMap((id) => layers[id]?.shapeIds ?? []);
	const selectionIds = state.ui.selectionIds.filter((id) => Boolean(shapes[id]));
	return {
		...state,
		doc: {
			...state.doc,
			layers,
			shapes,
			bindings,
			pages: { ...state.doc.pages, [page.id]: { ...page, layerIds, shapeIds } }
		},
		ui: {
			...state.ui,
			activeLayerId: state.ui.activeLayerId === layerId ? layerIds.at(-1) : state.ui.activeLayerId,
			selectionIds
		}
	};
}
