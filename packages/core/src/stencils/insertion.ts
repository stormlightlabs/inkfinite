import { createId, type ShapeRecord } from '../model';
import { canCreateShapeOnActiveLayer, type EditorState } from '../reactivity';
import type { Stencil } from './types';

/** Grid configuration applied to a stencil insertion point. */
export type StencilSnapSettings = { snapEnabled: boolean; gridEnabled: boolean; gridSize: number };

/**
 * Inserts every shape produced by a stencil into the current active layer.
 *
 * Multi-shape stencils receive one group ID. A locked active layer rejects the
 * complete insertion, so callers can commit the returned state as one undoable
 * transaction without partial results.
 */
export function insertStencil(
	state: EditorState,
	definition: Stencil,
	world: { x: number; y: number },
	snap?: StencilSnapSettings
): EditorState {
	const pageId = state.ui.currentPageId;
	const page = pageId ? state.doc.pages[pageId] : undefined;
	if (!pageId || !page) return state;
	if (!canCreateShapeOnActiveLayer(state)) return state;

	const activeLayerId = state.ui.activeLayerId;
	const activeLayer = activeLayerId ? state.doc.layers?.[activeLayerId] : undefined;
	if (activeLayerId && (!activeLayer || activeLayer.pageId !== pageId)) return state;

	const shouldSnap = snap?.snapEnabled && snap.gridEnabled && Number.isFinite(snap.gridSize) && snap.gridSize > 0;
	const at = shouldSnap
		? {
				x: Math.round(world.x / snap.gridSize) * snap.gridSize,
				y: Math.round(world.y / snap.gridSize) * snap.gridSize
			}
		: world;
	const spawned = definition.spawn(at);
	if (spawned.length === 0) return state;

	const groupId = spawned.length > 1 ? createId('group') : undefined;
	const shapes = { ...state.doc.shapes };
	const selectionIds: string[] = [];
	for (const spawnedShape of spawned) {
		const shape: ShapeRecord = {
			...spawnedShape,
			pageId,
			...(activeLayerId ? { layerId: activeLayerId } : {}),
			...(groupId ? { groupId } : {})
		};
		shapes[shape.id] = shape;
		selectionIds.push(shape.id);
	}

	return {
		...state,
		doc: {
			...state.doc,
			shapes,
			pages: { ...state.doc.pages, [pageId]: { ...page, shapeIds: [...page.shapeIds, ...selectionIds] } },
			...(activeLayer
				? {
						layers: {
							...state.doc.layers,
							[activeLayer.id]: { ...activeLayer, shapeIds: [...activeLayer.shapeIds, ...selectionIds] }
						}
					}
				: {})
		},
		ui: { ...state.ui, selectionIds }
	};
}
