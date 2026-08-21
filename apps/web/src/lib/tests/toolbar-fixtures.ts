import { EditorState, ShapeRecord, Store } from '@inkfinite/core';

export function createStoreWithRect(): Store {
	const store = new Store();
	const base = EditorState.create();
	const pageId = 'page:rect';
	const rect = ShapeRecord.createRect(
		pageId,
		0,
		0,
		{ w: 100, h: 50, fill: '#4a90e2', stroke: '#2e5c8a', radius: 4 },
		'shape:rect'
	);
	store.setState(() => ({
		doc: {
			pages: { [pageId]: { id: pageId, name: 'Page', shapeIds: [rect.id] } },
			shapes: { [rect.id]: rect },
			bindings: {}
		},
		ui: { currentPageId: pageId, selectionIds: [rect.id], toolId: 'select' },
		camera: base.camera
	}));
	return store;
}

export function createStoreWithLine(): Store {
	const store = new Store();
	const base = EditorState.create();
	const pageId = 'page:line';
	const line = ShapeRecord.createLine(
		pageId,
		0,
		0,
		{ a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, stroke: '#495057', width: 2 },
		'shape:line'
	);
	store.setState(() => ({
		doc: {
			pages: { [pageId]: { id: pageId, name: 'Page', shapeIds: [line.id] } },
			shapes: { [line.id]: line },
			bindings: {}
		},
		ui: { currentPageId: pageId, selectionIds: [line.id], toolId: 'select' },
		camera: base.camera
	}));
	return store;
}
