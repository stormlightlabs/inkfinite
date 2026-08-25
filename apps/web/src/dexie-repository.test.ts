import 'fake-indexeddb/auto';
import { InkfiniteDB } from '$lib/persistence/database';
import { createDexieDocRepo, createPersistenceSink } from '$lib/persistence/repository';
import {
	CreateShapeCommand,
	EditorDocument as EditorDocumentOps,
	EditorPageRecord,
	SetSelectionCommand,
	EditorShapeRecord,
	Store
} from '@inkfinite/core';
import { diffDoc } from '@inkfinite/core/persistence';
import type { CanonicalDocumentState } from '@inkfinite/core/persistence';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openDbs: Dexie[] = [];

function createTestDb(name = `inkfinite-test-${Math.random().toString(36).slice(2)}`) {
	const database = new InkfiniteDB(name);
	openDbs.push(database);
	return database;
}

afterEach(async () => {
	await Promise.all(
		openDbs.map(async (database) => {
			try {
				await database.delete();
			} catch {
				/* No-op */
			}
		})
	);
	openDbs.length = 0;
	vi.useRealTimers();
});

describe('DocRepo (Dexie)', () => {
	it('createBoard seeds default page + order and rename persists', async () => {
		const db = createTestDb();
		const repo = createDexieDocRepo(db);
		const boardId = await repo.createBoard('Seeded');
		const loaded = await repo.loadDoc(boardId);
		const listed = await repo.listBoards();

		expect(listed[0]).toMatchObject({
			id: boardId,
			storage: { kind: 'browser', label: 'This browser', location: 'IndexedDB' }
		});
		expect(Object.keys(loaded.pages)).toHaveLength(1);
		expect(loaded.order.pageIds).toHaveLength(1);
		expect(loaded.order.shapeOrder?.[loaded.order.pageIds[0]!]).toEqual([]);

		await repo.renameBoard(boardId, 'Renamed');
		const boardRow = await db.table('boards').get(boardId);
		expect(boardRow?.name).toBe('Renamed');
	});

	it('duplicates a board into an independent board with a fresh name and id', async () => {
		const database = createTestDb();
		const repo = createDexieDocRepo(database);
		const sourceId = await repo.createBoard('Source');

		const page = EditorPageRecord.create('Canvas');
		const rect = EditorShapeRecord.createRect(page.id, 0, 0, {
			w: 20,
			h: 20,
			fill: '#000',
			stroke: '#fff',
			radius: 0
		});
		page.shapeIds.push(rect.id);
		const doc = EditorDocumentOps.create();
		doc.pages[page.id] = page;
		doc.shapes[rect.id] = rect;
		await repo.applyDocPatch(sourceId, diffDoc(EditorDocumentOps.create(), doc));

		const duplicateId = await repo.duplicateBoard(sourceId);
		expect(duplicateId).not.toBe(sourceId);
		expect((await repo.listBoards()).map((board) => board.name)).toEqual(
			expect.arrayContaining(['Source', 'Copy of Source'])
		);
		expect((await repo.loadDoc(duplicateId)).shapes[rect.id]).toEqual(rect);
	});

	it('round-trips docs via applyDocPatch + loadDoc', async () => {
		const database = createTestDb();
		const repo = createDexieDocRepo(database);
		const boardId = await repo.createBoard('Round trip');

		const page = EditorPageRecord.create('Canvas');
		const rect = EditorShapeRecord.createRect(page.id, 0, 0, {
			w: 100,
			h: 80,
			fill: '#000',
			stroke: '#fff',
			radius: 8
		});
		page.shapeIds.push(rect.id);

		const doc = EditorDocumentOps.create();
		doc.pages[page.id] = page;
		doc.shapes[rect.id] = rect;

		await repo.applyDocPatch(boardId, diffDoc(EditorDocumentOps.create(), doc));

		const loaded = await repo.loadDoc(boardId);
		expect(loaded.pages[page.id]).toEqual(page);
		expect(loaded.shapes[rect.id]).toEqual(rect);
		expect(loaded.order.pageIds).toContain(page.id);
	});

	it('applyDocPatch performs a single Dexie transaction', async () => {
		const database = createTestDb();
		const repo = createDexieDocRepo(database);
		const boardId = await repo.createBoard('Tx board');

		const page = EditorPageRecord.create('Tx Page');
		const rect = EditorShapeRecord.createRect(page.id, 10, 10, {
			w: 50,
			h: 50,
			fill: '#ccc',
			stroke: '#111',
			radius: 4
		});
		page.shapeIds.push(rect.id);

		const doc = EditorDocumentOps.create();
		doc.pages[page.id] = page;
		doc.shapes[rect.id] = rect;

		const transactionSpy = vi.spyOn(database, 'transaction');
		await repo.applyDocPatch(boardId, diffDoc(EditorDocumentOps.create(), doc));
		expect(transactionSpy).toHaveBeenCalledTimes(1);
	});

	it('deleteBoard removes rows across all tables', async () => {
		const database = createTestDb();
		const repo = createDexieDocRepo(database);
		const boardId = await repo.createBoard('Delete board');

		const page = EditorPageRecord.create('Delete Page');
		const rect = EditorShapeRecord.createRect(page.id, 0, 0, {
			w: 40,
			h: 40,
			fill: '#f00',
			stroke: '#000',
			radius: 2
		});
		page.shapeIds.push(rect.id);

		const doc = EditorDocumentOps.create();
		doc.pages[page.id] = page;
		doc.shapes[rect.id] = rect;

		await repo.applyDocPatch(boardId, diffDoc(EditorDocumentOps.create(), doc));
		await repo.deleteBoard(boardId);

		expect(await database.table('boards').toArray()).toHaveLength(0);
		expect(await database.table('pages').toArray()).toHaveLength(0);
		expect(await database.table('shapes').toArray()).toHaveLength(0);
		expect(await database.table('bindings').toArray()).toHaveLength(0);
	});

	it('canonical state replaces legacy graph rows and round-trips through loadDoc', async () => {
		const database = createTestDb();
		const repo = createDexieDocRepo(database);
		const boardId = await repo.createBoard('Canonical');
		const snapshot = {
			format: 'inkfinite.document',
			format_version: 2,
			document_id: boardId,
			heads: [],
			document: {
				pages: {
					'page:canonical': {
						id: 'page:canonical',
						name: 'Canonical page',
						layer_ids: ['layer:canonical'],
						version: 1
					}
				},
				page_ids: ['page:canonical'],
				layers: {
					'layer:canonical': {
						id: 'layer:canonical',
						page_id: 'page:canonical',
						name: 'Default',
						shape_ids: [],
						visible: true,
						locked: false,
						opacity: 1,
						version: 1
					}
				},
				shapes: {},
				bindings: {},
				assets: {}
			}
		} satisfies CanonicalDocumentState['snapshot'];

		await repo.saveCanonical?.(boardId, { bytes: new Uint8Array([1, 2, 3]), snapshot });
		const loaded = await repo.loadDoc(boardId);

		expect(loaded.pages['page:canonical']?.name).toBe('Canonical page');
		expect(await database.pages.count()).toBe(0);
		expect(await database.canonical.get(boardId)).toMatchObject({ boardId });
		expect([...((await repo.loadCanonical?.(boardId))?.bytes ?? [])]).toEqual([1, 2, 3]);
	});

	it('exportBoard + importBoard round-trip doc + metadata', async () => {
		const db = createTestDb();
		const repo = createDexieDocRepo(db);
		const boardId = await repo.createBoard('Source');

		const page = EditorPageRecord.create('Canvas');
		const rect = EditorShapeRecord.createRect(page.id, 5, 5, {
			w: 20,
			h: 10,
			fill: '#123',
			stroke: '#456',
			radius: 1
		});
		page.shapeIds.push(rect.id);

		const doc = EditorDocumentOps.create();
		doc.pages[page.id] = page;
		doc.shapes[rect.id] = rect;

		await repo.applyDocPatch(boardId, diffDoc(EditorDocumentOps.create(), doc));

		const snapshot = await repo.exportBoard(boardId);
		const importedId = await repo.importBoard({
			...snapshot,
			board: { ...snapshot.board, id: 'board:imported', name: 'Imported' }
		});

		const imported = await repo.loadDoc(importedId);
		expect(imported.pages).toEqual(snapshot.doc.pages);
		expect(imported.shapes).toEqual(snapshot.doc.shapes);
	});
});

describe('History persistence sink', () => {
	let repo: ReturnType<typeof createDexieDocRepo>;
	let boardId: string;

	beforeEach(async () => {
		const database = createTestDb();
		repo = createDexieDocRepo(database);
		boardId = await repo.createBoard('Persisted');
	});

	it('doc command triggers exactly one persistence flush', async () => {
		const { store, sink, applySpy, pageId } = await createStoreWithSink(repo, boardId);

		const rect = EditorShapeRecord.createRect(pageId, 0, 0, {
			w: 10,
			h: 10,
			fill: '#222',
			stroke: '#fff',
			radius: 0
		});

		store.executeCommand(new CreateShapeCommand(rect, pageId));
		expect(applySpy).toHaveBeenCalledTimes(0);

		await sink.flush();

		expect(applySpy).toHaveBeenCalledTimes(1);
		const loaded = await repo.loadDoc(boardId);
		expect(loaded.shapes[rect.id]).toBeDefined();
	});

	it('undo and redo both persist document changes', async () => {
		const { store, sink, applySpy, pageId } = await createStoreWithSink(repo, boardId);

		const rect = EditorShapeRecord.createRect(pageId, 0, 0, {
			w: 25,
			h: 25,
			fill: '#0f0',
			stroke: '#090',
			radius: 0
		});

		store.executeCommand(new CreateShapeCommand(rect, pageId));
		await sink.flush();
		applySpy.mockClear();

		store.undo();
		await sink.flush();
		expect(applySpy).toHaveBeenCalledTimes(1);
		let loaded = await repo.loadDoc(boardId);
		expect(loaded.shapes[rect.id]).toBeUndefined();

		applySpy.mockClear();
		store.redo();
		await sink.flush();
		expect(applySpy).toHaveBeenCalledTimes(1);
		loaded = await repo.loadDoc(boardId);
		expect(loaded.shapes[rect.id]).toBeDefined();
	});

	it('ui-only commands never hit persistence', async () => {
		const { store, sink, applySpy, pageId } = await createStoreWithSink(repo, boardId);

		const rect = EditorShapeRecord.createRect(pageId, 0, 0, {
			w: 15,
			h: 15,
			fill: '#aaa',
			stroke: '#bbb',
			radius: 0
		});

		store.executeCommand(new CreateShapeCommand(rect, pageId));
		await sink.flush();
		applySpy.mockClear();

		store.executeCommand(new SetSelectionCommand([], [rect.id]));
		await sink.flush();

		expect(applySpy).toHaveBeenCalledTimes(0);
	});

	it('batches rapid doc commands into one flush', async () => {
		const { store, sink, applySpy, pageId } = await createStoreWithSink(repo, boardId);

		for (let i = 0; i < 10; i++) {
			const rect = EditorShapeRecord.createRect(pageId, i * 5, 0, {
				w: 5,
				h: 5,
				fill: '#444',
				stroke: '#111',
				radius: 0
			});
			store.executeCommand(new CreateShapeCommand(rect, pageId));
		}

		await sink.flush();

		expect(applySpy).toHaveBeenCalledTimes(1);
		const loaded = await repo.loadDoc(boardId);
		expect(Object.keys(loaded.shapes).length).toBeGreaterThanOrEqual(10);
	});
});

async function createStoreWithSink(repo: ReturnType<typeof createDexieDocRepo>, boardId: string) {
	const sink = createPersistenceSink(repo, { debounceMs: 10 });
	const applySpy = vi.spyOn(repo, 'applyDocPatch');
	const store = new Store(undefined, {
		onHistoryEvent: (event) => {
			if (event.kind !== 'doc') {
				return;
			}
			const patch = diffDoc(event.beforeState.doc, event.afterState.doc);
			sink.enqueueDocPatch(boardId, patch);
		}
	});

	const pageId = await hydrateStoreFromRepo(store, repo, boardId);
	return { store, sink, applySpy, pageId };
}

async function hydrateStoreFromRepo(
	store: Store,
	repo: ReturnType<typeof createDexieDocRepo>,
	boardId: string
) {
	const loaded = await repo.loadDoc(boardId);
	const firstPageId = loaded.order.pageIds[0] ?? Object.keys(loaded.pages)[0];

	store.setState((state) => ({
		...state,
		doc: { pages: loaded.pages, shapes: loaded.shapes, bindings: loaded.bindings },
		ui: { ...state.ui, currentPageId: firstPageId ?? null }
	}));

	return firstPageId!;
}
