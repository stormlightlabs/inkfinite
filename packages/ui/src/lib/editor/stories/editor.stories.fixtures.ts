import {
	CursorStore,
	contentObjectToCard,
	EditorState,
	EditorPageRecord,
	EditorShapeRecord,
	Store,
	type EditorState as EditorStateType
} from '@inkfinite/core';
import { FileBrowserVM } from '../filebrowser/model';
import type { BoardMeta, DocRepo } from '@inkfinite/core/persistence';

import type { EditorPlatformAdapter } from '../platform';
import { createBrushStore, createSnapStore, createStatusStore } from '../status';
import { getSelectionInspectorState, type SelectionInspectorState } from '../selection-inspector';

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
export type InspectorStoryVariant = 'appearance' | 'text' | 'image' | 'card' | 'layout';

/** Creates a small selected document for focused inspector stories. */
export function createStoryInspectorStore(variant: InspectorStoryVariant): Store {
	const state = EditorState.create();
	const page = EditorPageRecord.create('Inspector story', `page:inspector-${variant}`);
	state.doc.pages[page.id] = page;
	state.ui.currentPageId = page.id;

	if (variant === 'text') {
		const text = EditorShapeRecord.createText(
			page.id,
			24,
			24,
			{
				text: 'Inspector headline',
				fontSize: 28,
				fontFamily: 'Newsreader Variable',
				color: '#302c2a'
			},
			'shape:inspector-text'
		);
		page.shapeIds = [text.id];
		state.doc.shapes[text.id] = text;
		state.ui.selectionIds = [text.id];
	} else if (variant === 'image') {
		const image = EditorShapeRecord.createImage(
			page.id,
			24,
			24,
			{ w: 240, h: 160, assetId: 'asset:inspector', caption: 'Sample asset' },
			'shape:inspector-image'
		);
		page.shapeIds = [image.id];
		state.doc.shapes[image.id] = image;
		state.doc.assets = {
			'asset:inspector': {
				id: 'asset:inspector',
				name: 'Inspector image',
				mediaType: 'image/png',
				digest: 'sha256:inspector',
				bytes: [0]
			}
		};
		state.ui.selectionIds = [image.id];
	} else if (variant === 'card') {
		const card = contentObjectToCard(
			page.id,
			{ x: 24, y: 24 },
			{ title: 'Inspector card', body: 'Card body', role: 'note' }
		);
		page.shapeIds = card.map((shape) => shape.id);
		for (const shape of card) state.doc.shapes[shape.id] = shape;
		state.ui.selectionIds = [card[0].id];
	} else {
		const first = EditorShapeRecord.createRect(
			page.id,
			24,
			24,
			{ w: 120, h: 80, fill: '#e7d9ff', stroke: '#6f42c1', radius: 12 },
			'shape:inspector-first'
		);
		const second = EditorShapeRecord.createRect(
			page.id,
			190,
			24,
			{ w: 120, h: 80, fill: '#d8f1e8', stroke: '#347a5a', radius: 12 },
			'shape:inspector-second'
		);
		page.shapeIds = [first.id, second.id];
		state.doc.shapes[first.id] = first;
		state.doc.shapes[second.id] = second;
		state.ui.selectionIds = variant === 'layout' ? [first.id, second.id] : [first.id];
	}

	return new Store(state);
}

/** Creates the derived selection data passed to focused inspector stories. */
export function createStoryInspectorSelection(variant: InspectorStoryVariant): {
	store: Store;
	selection: SelectionInspectorState;
} {
	const store = createStoryInspectorStore(variant);
	return { store, selection: getSelectionInspectorState(store.getState()) };
}

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
