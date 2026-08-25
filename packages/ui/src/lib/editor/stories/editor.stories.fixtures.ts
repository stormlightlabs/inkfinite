import {
	CursorStore,
	EditorState,
	FileBrowserVM,
	EditorPageRecord,
	EditorShapeRecord,
	Store,
	type BoardMeta,
	type DocRepo,
	type EditorState as EditorStateType
} from '@inkfinite/core';

import type { EditorPlatformAdapter } from '../platform';
import { createBrushStore, createSnapStore, createStatusStore } from '../status';

export const storyBoards: BoardMeta[] = [
	{
		id: 'board:ideas',
		name: 'Launch ideas',
		createdAt: 1_710_000_000_000,
		updatedAt: 1_720_000_000_000
	},
	{
		id: 'board:flows',
		name: 'Checkout flow',
		createdAt: 1_715_000_000_000,
		updatedAt: 1_725_000_000_000
	}
];

/** Creates a no-network board browser model for component stories. */
export function createStoryFileBrowser(boards: BoardMeta[] = storyBoards) {
	const repo: DocRepo = {
		listBoards: async () => storyBoards,
		createBoard: async (name) => `board:${name.toLowerCase().replaceAll(' ', '-')}`,
		duplicateBoard: async () => 'board:copy',
		openBoard: async () => {},
		renameBoard: async () => {},
		deleteBoard: async () => {}
	};

	return FileBrowserVM.create({ repo, boards });
}

/** Creates an editor store with a selected arrow so arrow controls are visible. */
export function createStoryStore(): Store {
	const state = EditorState.create();
	const page = EditorPageRecord.create('Sketch', 'page:story');
	const arrow = EditorShapeRecord.createArrow(
		page.id,
		120,
		90,
		{
			points: [
				{ x: 0, y: 0 },
				{ x: 180, y: 80 }
			],
			start: { kind: 'free' },
			end: { kind: 'free' },
			style: { stroke: '#302c2a', width: 2, headEnd: true },
			routing: { kind: 'straight' },
			label: { text: 'A useful connection', align: 'center', offset: 0 }
		},
		'shape:story-arrow'
	);

	state.doc.pages[page.id] = { ...page, shapeIds: [arrow.id] };
	state.doc.shapes[arrow.id] = arrow;
	state.ui.currentPageId = page.id;
	state.ui.selectionIds = [arrow.id];
	return new Store(state);
}

/** Props shared by editor toolbar and status stories. */
export function createStoryEditorControls() {
	return {
		store: createStoryStore(),
		brushStore: createBrushStore(),
		cursor: new CursorStore(),
		persistence: createStatusStore({ backend: 'indexeddb', state: 'saved', pendingWrites: 0 }),
		snap: createSnapStore()
	};
}

/** In-memory adapter used to render the complete editor in Storybook. */
export function createStoryPlatform(): EditorPlatformAdapter {
	const initial = createEditorDocument();
	const board = storyBoards[0];

	return {
		kind: 'web',
		async connect() {
			return {
				repo: {
					listBoards: async () => [board],
					createBoard: async () => board.id,
					duplicateBoard: async () => 'board:copy',
					openBoard: async () => {},
					renameBoard: async () => {},
					deleteBoard: async () => {},
					loadDoc: async () => ({
						pages: initial.doc.pages,
						shapes: initial.doc.shapes,
						bindings: initial.doc.bindings,
						order: { pageIds: Object.keys(initial.doc.pages) }
					}),
					applyDocPatch: async () => {},
					exportBoard: async () => ({
						board,
						doc: initial.doc,
						order: { pageIds: Object.keys(initial.doc.pages) }
					}),
					importBoard: async () => board.id
				},
				sink: { enqueueDocPatch: () => {}, flush: async () => {} },
				status: createStatusStore({
					backend: 'indexeddb',
					state: 'saved',
					pendingWrites: 0
				})
			};
		}
	};
}

function createEditorDocument(): EditorStateType {
	const state = EditorState.create();
	const page = EditorPageRecord.create('Untitled', 'page:story-editor');
	state.doc.pages[page.id] = page;
	state.ui.currentPageId = page.id;
	return state;
}
