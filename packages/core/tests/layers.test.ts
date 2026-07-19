import {
	createLayer,
	deleteLayer,
	EditorState,
	getInteractiveShapesOnCurrentPage,
	moveLayer,
	patchLayer,
	reorderShapes,
	ShapeRecord,
	Store,
	ensureDocumentLayers
} from '../src';
import { describe, expect, it } from 'vitest';

function layeredState() {
	const state = EditorState.create();
	state.doc.pages.page = { id: 'page', name: 'Page', shapeIds: ['back', 'front'] };
	state.doc.shapes.back = ShapeRecord.createRect(
		'page',
		0,
		0,
		{ w: 10, h: 10, fill: '#000', stroke: '#000', radius: 0 },
		'back'
	);
	state.doc.shapes.front = ShapeRecord.createRect(
		'page',
		20,
		0,
		{ w: 10, h: 10, fill: '#000', stroke: '#000', radius: 0 },
		'front'
	);
	state.ui.currentPageId = 'page';
	return new Store(state).getState();
}

describe('layers', () => {
	it('assigns one stable default layer without changing order and is idempotent', () => {
		const normalized = layeredState().doc;
		const layerId = normalized.pages.page.layerIds?.[0];
		expect(layerId).toBe('layer:page:default');
		expect(normalized.layers?.[layerId!].shapeIds).toEqual(['back', 'front']);
		expect(ensureDocumentLayers(normalized)).toEqual(normalized);
	});

	it('places new shapes on the active layer and excludes hidden or locked layers from interaction', () => {
		const original = layeredState();
		const withSecond = createLayer(original, 'Foreground');
		const activeLayerId = withSecond.ui.activeLayerId!;
		const shape = ShapeRecord.createRect(
			'page',
			40,
			0,
			{ w: 10, h: 10, fill: '#000', stroke: '#000', radius: 0 },
			'new'
		);
		const store = new Store({
			...withSecond,
			doc: {
				...withSecond.doc,
				pages: {
					...withSecond.doc.pages,
					page: { ...withSecond.doc.pages.page, shapeIds: [...withSecond.doc.pages.page.shapeIds, shape.id] }
				},
				shapes: { ...withSecond.doc.shapes, [shape.id]: shape }
			}
		});
		expect(store.getState().doc.shapes.new.layerId).toBe(activeLayerId);
		const hidden = patchLayer(store.getState(), activeLayerId, { visible: false });
		expect(getInteractiveShapesOnCurrentPage(hidden).map(({ id }) => id)).toEqual(['back', 'front']);
		expect(hidden.ui.activeLayerId).toBe(original.ui.activeLayerId);
		const locked = patchLayer(store.getState(), activeLayerId, { locked: true });
		expect(getInteractiveShapesOnCurrentPage(locked).map(({ id }) => id)).toEqual(['back', 'front']);
		expect(locked.ui.activeLayerId).toBe(original.ui.activeLayerId);
	});

	it('reorders layers and requires explicit handling before deleting non-empty content', () => {
		const original = layeredState();
		const created = createLayer(original, 'Foreground');
		const foreground = created.ui.activeLayerId!;
		expect(moveLayer(created, foreground, 'backward').doc.pages.page.layerIds?.[0]).toBe(foreground);
		expect(deleteLayer(original, original.ui.activeLayerId!)).toBe(original);
		expect(deleteLayer(created, original.ui.activeLayerId!)).toBe(created);
		const deleted = deleteLayer(created, original.ui.activeLayerId!, {
			kind: 'move',
			destinationLayerId: foreground
		});
		expect(deleted.doc.pages.page.layerIds).toEqual([foreground]);
		expect(deleted.doc.layers?.[foreground].shapeIds).toEqual(['back', 'front']);
	});

	it('preserves source-versus-destination stacking when merging layer contents', () => {
		const original = layeredState();
		const foregroundState = createLayer(original, 'Foreground');
		const foreground = foregroundState.ui.activeLayerId!;
		const foregroundShape = ShapeRecord.createRect(
			'page',
			0,
			0,
			{ w: 10, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
			'foreground-shape'
		);
		const populated = new Store({
			...foregroundState,
			doc: {
				...foregroundState.doc,
				shapes: { ...foregroundState.doc.shapes, [foregroundShape.id]: foregroundShape },
				pages: {
					...foregroundState.doc.pages,
					page: {
						...foregroundState.doc.pages.page,
						shapeIds: [...foregroundState.doc.pages.page.shapeIds, foregroundShape.id]
					}
				}
			}
		}).getState();
		const merged = deleteLayer(populated, original.ui.activeLayerId!, {
			kind: 'move',
			destinationLayerId: foreground
		});

		expect(merged.doc.layers?.[foreground].shapeIds).toEqual(['back', 'front', 'foreground-shape']);
		expect(merged.doc.pages.page.shapeIds).toEqual(['back', 'front', 'foreground-shape']);
	});

	it('uses no active destination when every layer is hidden or locked', () => {
		const original = layeredState();
		const layerId = original.ui.activeLayerId!;
		const hidden = new Store(patchLayer(original, layerId, { visible: false })).getState();

		expect(hidden.ui.activeLayerId).toBeNull();
		expect(hidden.ui.selectionIds).toEqual([]);
	});

	it('reorders shapes inside their owning layer and keeps the page projection synchronized', () => {
		const original = layeredState();
		const reordered = reorderShapes(original, ['back'], 'forward');

		expect(reordered.doc.layers?.[original.ui.activeLayerId!].shapeIds).toEqual(['front', 'back']);
		expect(reordered.doc.pages.page.shapeIds).toEqual(['front', 'back']);
		expect(new Store(reordered).getState().doc.pages.page.shapeIds).toEqual(['front', 'back']);
	});
});
