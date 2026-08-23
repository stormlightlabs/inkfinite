import {
	EditorState,
	FileBrowserVM,
	PageRecord,
	ShapeRecord,
	Store,
	type BoardMeta,
	type DocRepo
} from '@inkfinite/core';
import { vi } from 'vitest';

export const testBoards: BoardMeta[] = [
	{ id: 'board:one', name: 'First board', createdAt: 100, updatedAt: 300 },
	{ id: 'board:two', name: 'Second board', createdAt: 200, updatedAt: 400 }
];

/** Creates a repository spy and its bound file-browser view model. */
export function createFileBrowserFixture(boards: BoardMeta[] = testBoards) {
	const repo: DocRepo = {
		listBoards: vi.fn(async () => boards),
		createBoard: vi.fn(async () => 'board:new'),
		duplicateBoard: vi.fn(async () => 'board:copy'),
		openBoard: vi.fn(async () => {}),
		renameBoard: vi.fn(async () => {}),
		deleteBoard: vi.fn(async () => {})
	};

	return { repo, vm: FileBrowserVM.create({ repo, boards }) };
}

/** Creates a store with one selected arrow for editor control tests. */
export function createSelectedArrowStore(): Store {
	const state = EditorState.create();
	const page = PageRecord.create('Test page', 'page:test');
	const arrow = ShapeRecord.createArrow(
		page.id,
		10,
		20,
		{
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 50 }
			],
			start: { kind: 'free' },
			end: { kind: 'free' },
			style: { stroke: '#111111', width: 2, headEnd: true },
			routing: { kind: 'straight' }
		},
		'shape:arrow'
	);

	state.doc.pages[page.id] = { ...page, shapeIds: [arrow.id] };
	state.doc.shapes[arrow.id] = arrow;
	state.ui.currentPageId = page.id;
	state.ui.selectionIds = [arrow.id];
	return new Store(state);
}
