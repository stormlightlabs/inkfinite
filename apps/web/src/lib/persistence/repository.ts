import {
	EditorBindingRecord as BindingOps,
	createId,
	EditorLayerRecord as LayerOps,
	EditorPageRecord as PageOps,
	EditorShapeRecord as ShapeOps
} from '@inkfinite/core';
import {
	BoardStatsOps,
	fromCanonicalDocumentSnapshot,
	fromEditorProjection
} from '@inkfinite/core/persistence';
import type {
	EditorBindingRecord,
	EditorDocument,
	EditorLayerRecord,
	EditorPageRecord,
	EditorShapeRecord,
	ImportedAsset
} from '@inkfinite/core';
import type {
	BoardExport,
	BoardInspectorData,
	BoardMeta,
	BoardStats,
	CanonicalDocumentState,
	DocOrder,
	DocPatch,
	LoadedDoc,
	PersistenceSink,
	PersistentDocRepo,
	SchemaInfo,
	Timestamp
} from '@inkfinite/core/persistence';
import Dexie from 'dexie';

/** IndexedDB row for a page scoped to its board. */
export type PageRow = EditorPageRecord & { boardId: string; updatedAt: Timestamp };

/** IndexedDB row for a shape scoped to its board. */
export type ShapeRow = EditorShapeRecord & { boardId: string; updatedAt: Timestamp };

/** IndexedDB row for a binding scoped to its board. */
export type BindingRow = EditorBindingRecord & { boardId: string; updatedAt: Timestamp };

/** Canonical Rust document bytes and its derived materialized cache. */
export type CanonicalRow = {
	boardId: string;
	bytes: Uint8Array;
	snapshot: CanonicalDocumentState['snapshot'];
	projection?: CanonicalDocumentState['projection'];
	updatedAt: Timestamp;
};

/** Key-value metadata stored alongside document rows. */
export type MetaRow = { key: string; value: unknown };

/** Debounce configuration for the web persistence sink. */
export type PersistenceSinkOptions = { debounceMs?: number };

/** Clock override used by deterministic repository tests. */
export type WebRepoOptions = { now?: () => Timestamp };

type DexieLike = Pick<Dexie, 'table' | 'transaction'>;

const DEFAULT_BOARD_NAME = 'Untitled Board';
const PAGE_ORDER_META_PREFIX = 'page-order:';
const SHAPE_ORDER_META_PREFIX = 'shape-order:';
const LAYERS_META_PREFIX = 'layers:';
const ASSETS_META_PREFIX = 'assets:';
const BROWSER_STORAGE = { kind: 'browser', label: 'This browser', location: 'IndexedDB' } as const;

const pageOrderKey = (boardId: string) => `${PAGE_ORDER_META_PREFIX}${boardId}`;

const shapeOrderKey = (boardId: string) => `${SHAPE_ORDER_META_PREFIX}${boardId}`;

const layersKey = (boardId: string) => `${LAYERS_META_PREFIX}${boardId}`;

const assetsKey = (boardId: string) => `${ASSETS_META_PREFIX}${boardId}`;

/**
 * Create a Dexie-backed persistent DocRepo used by the web app.
 */
export function createDexieDocRepo(
	database: DexieLike,
	options?: WebRepoOptions
): PersistentDocRepo {
	const now = () => options?.now?.() ?? Date.now();

	const boards = () => database.table<BoardMeta>('boards');
	const pages = () => database.table<PageRow>('pages');
	const shapes = () => database.table<ShapeRow>('shapes');
	const bindings = () => database.table<BindingRow>('bindings');
	const meta = () => database.table<MetaRow>('meta');
	const canonical = () => database.table<CanonicalRow>('canonical');

	async function listBoards(): Promise<BoardMeta[]> {
		const rows = await boards().orderBy('updatedAt').reverse().toArray();
		return rows.map((board) => ({ ...board, storage: board.storage ?? BROWSER_STORAGE }));
	}

	async function createBoard(name: string): Promise<string> {
		const boardId = createId('board');
		const timestamp = now();
		const page = PageOps.create('Page 1');
		const pageRow: PageRow = { ...page, boardId, updatedAt: timestamp };

		await database.transaction('rw', boards(), pages(), meta(), async () => {
			await boards().add({
				id: boardId,
				name: name.trim() || DEFAULT_BOARD_NAME,
				createdAt: timestamp,
				updatedAt: timestamp,
				storage: BROWSER_STORAGE
			});
			await pages().add(pageRow);
			await meta().put({ key: pageOrderKey(boardId), value: [page.id] });
			await meta().put({
				key: shapeOrderKey(boardId),
				value: { [page.id]: [...page.shapeIds] }
			});
		});

		return boardId;
	}

	async function duplicateBoard(boardId: string, name?: string): Promise<string> {
		const source = await exportBoard(boardId);
		const duplicateId = createId('board');
		const timestamp = now();
		const duplicateName = name?.trim() || `Copy of ${source.board.name}`;
		return importBoard({
			...source,
			board: {
				...source.board,
				id: duplicateId,
				name: duplicateName,
				createdAt: timestamp,
				updatedAt: timestamp
			}
		});
	}

	async function renameBoard(boardId: string, name: string): Promise<void> {
		await boards().update(boardId, {
			name: name.trim() || DEFAULT_BOARD_NAME,
			updatedAt: now()
		});
	}

	async function deleteBoard(boardId: string): Promise<void> {
		await database.transaction(
			'rw',
			[boards(), pages(), shapes(), bindings(), meta(), canonical()],
			async () => {
				const pageKeys = (await pages().where('boardId').equals(boardId).toArray()).map(
					(row) => [row.boardId, row.id] as [string, string]
				);
				const shapeKeys = (await shapes().where('boardId').equals(boardId).toArray()).map(
					(row) => [row.boardId, row.id] as [string, string]
				);
				const bindingKeys = (
					await bindings().where('boardId').equals(boardId).toArray()
				).map((row) => [row.boardId, row.id] as [string, string]);

				await boards().delete(boardId);
				if (pageKeys.length > 0) await pages().bulkDelete(pageKeys);
				if (shapeKeys.length > 0) await shapes().bulkDelete(shapeKeys);
				if (bindingKeys.length > 0) await bindings().bulkDelete(bindingKeys);
				await meta().delete(pageOrderKey(boardId));
				await meta().delete(shapeOrderKey(boardId));
				await meta().delete(layersKey(boardId));
				await meta().delete(assetsKey(boardId));
				await meta().delete(`svg-groups:${boardId}`);
				await canonical().delete(boardId);
			}
		);
	}

	async function loadCanonical(boardId: string) {
		const row = await canonical().get(boardId);
		return row
			? {
					bytes: new Uint8Array(row.bytes),
					snapshot: row.snapshot,
					projection: row.projection
				}
			: null;
	}

	async function saveCanonical(boardId: string, state: CanonicalDocumentState): Promise<void> {
		const timestamp = now();
		await database.transaction(
			'rw',
			[boards(), pages(), shapes(), bindings(), meta(), canonical()],
			async () => {
				await canonical().put({
					boardId,
					bytes: new Uint8Array(state.bytes),
					snapshot: state.snapshot,
					projection: state.projection,
					updatedAt: timestamp
				});
				const pageKeys = (await pages().where('boardId').equals(boardId).toArray()).map(
					(row) => [row.boardId, row.id] as [string, string]
				);
				const shapeKeys = (await shapes().where('boardId').equals(boardId).toArray()).map(
					(row) => [row.boardId, row.id] as [string, string]
				);
				const bindingKeys = (
					await bindings().where('boardId').equals(boardId).toArray()
				).map((row) => [row.boardId, row.id] as [string, string]);
				if (pageKeys.length > 0) await pages().bulkDelete(pageKeys);
				if (shapeKeys.length > 0) await shapes().bulkDelete(shapeKeys);
				if (bindingKeys.length > 0) await bindings().bulkDelete(bindingKeys);
				await meta().delete(pageOrderKey(boardId));
				await meta().delete(shapeOrderKey(boardId));
				await meta().delete(layersKey(boardId));
				await meta().delete(assetsKey(boardId));
				await meta().delete(`svg-groups:${boardId}`);
				await boards().update(boardId, { updatedAt: timestamp });
			}
		);
	}

	async function loadDoc(boardId: string): Promise<LoadedDoc> {
		const canonicalRow = await canonical().get(boardId);
		if (canonicalRow) {
			return canonicalRow.projection
				? fromEditorProjection(canonicalRow.projection, canonicalRow.snapshot)
				: fromCanonicalDocumentSnapshot(canonicalRow.snapshot);
		}
		const pageRows = await pages().where('boardId').equals(boardId).toArray();
		const [shapeRows, bindingRows, order, assetsRow] = await Promise.all([
			shapes().where('boardId').equals(boardId).toArray(),
			bindings().where('boardId').equals(boardId).toArray(),
			loadOrder(boardId, pageRows),
			meta().get(assetsKey(boardId))
		]);

		const docPages: Record<string, EditorPageRecord> = {};
		for (const row of pageRows) {
			docPages[row.id] = clonePageRow(row);
		}

		const docShapes: Record<string, EditorShapeRecord> = {};
		for (const row of shapeRows) {
			docShapes[row.id] = cloneShapeRow(row);
		}

		const docBindings: Record<string, EditorBindingRecord> = {};
		for (const row of bindingRows) {
			docBindings[row.id] = cloneBindingRow(row);
		}

		return {
			pages: docPages,
			layers: order.layers,
			shapes: docShapes,
			bindings: docBindings,
			assets: assetsRow?.value as Record<string, ImportedAsset> | undefined,
			order
		};
	}

	async function loadOrder(boardId: string, fallbackPages: PageRow[]): Promise<DocOrder> {
		const pageOrderRow = await meta().get(pageOrderKey(boardId));
		const shapeOrderRow = await meta().get(shapeOrderKey(boardId));
		const layersRow = await meta().get(layersKey(boardId));
		const fallbackPageIds = fallbackPages.map((row) => row.id);
		const fallbackShapeOrder = shapeOrderFromPageRows(fallbackPages);

		return {
			pageIds: (pageOrderRow?.value as string[] | undefined) ?? fallbackPageIds,
			shapeOrder:
				(shapeOrderRow?.value as Record<string, string[]> | undefined) ??
				fallbackShapeOrder,
			layers: layersRow?.value as Record<string, EditorLayerRecord> | undefined
		};
	}

	async function applyDocPatch(boardId: string, patch: DocPatch): Promise<void> {
		const timestamp = now();

		await database.transaction(
			'rw',
			[boards(), pages(), shapes(), bindings(), meta()],
			async () => {
				const pageDeleteKeys =
					patch.deletes?.pageIds?.map((id) => [boardId, id] as [string, string]) ?? [];
				const shapeDeleteKeys =
					patch.deletes?.shapeIds?.map((id) => [boardId, id] as [string, string]) ?? [];
				const bindingDeleteKeys =
					patch.deletes?.bindingIds?.map((id) => [boardId, id] as [string, string]) ??
					[];

				if (pageDeleteKeys.length > 0) await pages().bulkDelete(pageDeleteKeys);
				if (shapeDeleteKeys.length > 0) await shapes().bulkDelete(shapeDeleteKeys);
				if (bindingDeleteKeys.length > 0) await bindings().bulkDelete(bindingDeleteKeys);
				if (patch.deletes?.assetIds?.length) {
					const current = await meta().get(assetsKey(boardId));
					const assets = {
						...((current?.value as Record<string, ImportedAsset> | undefined) ?? {})
					};
					for (const id of patch.deletes.assetIds) delete assets[id];
					await meta().put({ key: assetsKey(boardId), value: assets });
				}

				const upsertPages =
					patch.upserts?.pages?.map((page) => ({
						...PageOps.clone(page),
						boardId,
						updatedAt: timestamp
					})) ?? [];
				const upsertShapes =
					patch.upserts?.shapes?.map((shape) => ({
						...ShapeOps.clone(shape),
						boardId,
						updatedAt: timestamp
					})) ?? [];
				const upsertBindings =
					patch.upserts?.bindings?.map((binding) => ({
						...BindingOps.clone(binding),
						boardId,
						updatedAt: timestamp
					})) ?? [];

				if (upsertPages.length > 0) await pages().bulkPut(upsertPages);
				if (upsertShapes.length > 0) await shapes().bulkPut(upsertShapes);
				if (upsertBindings.length > 0) await bindings().bulkPut(upsertBindings);
				if (patch.upserts?.assets?.length) {
					const current = await meta().get(assetsKey(boardId));
					const assets = {
						...((current?.value as Record<string, ImportedAsset> | undefined) ?? {})
					};
					for (const asset of patch.upserts.assets)
						assets[asset.id] = { ...asset, bytes: [...asset.bytes] };
					await meta().put({ key: assetsKey(boardId), value: assets });
				}

				if (patch.order?.pageIds) {
					await meta().put({
						key: pageOrderKey(boardId),
						value: [...patch.order.pageIds]
					});
				}

				if (patch.order?.shapeOrder) {
					await meta().put({
						key: shapeOrderKey(boardId),
						value: patch.order.shapeOrder
					});
				}
				if (patch.order?.layers) {
					await meta().put({ key: layersKey(boardId), value: patch.order.layers });
				}

				await boards().update(boardId, { updatedAt: timestamp });
			}
		);
	}

	async function exportBoard(boardId: string): Promise<BoardExport> {
		const board = await boards().get(boardId);
		if (!board) {
			throw new Error(`Board ${boardId} not found`);
		}

		const { pages, layers, shapes, bindings, assets, order } = await loadDoc(boardId);
		const doc: EditorDocument = {
			pages,
			...(layers ? { layers } : {}),
			...(assets ? { assets } : {}),
			shapes,
			bindings
		};
		return { board, doc, order };
	}

	async function importBoard(snapshot: BoardExport): Promise<string> {
		const boardId = snapshot.board.id ?? createId('board');
		const timestamp = now();
		const board: BoardMeta = {
			id: boardId,
			name: snapshot.board.name || DEFAULT_BOARD_NAME,
			createdAt: snapshot.board.createdAt ?? timestamp,
			updatedAt: timestamp,
			storage: BROWSER_STORAGE
		};

		await database.transaction(
			'rw',
			[boards(), pages(), shapes(), bindings(), meta(), canonical()],
			async () => {
				await boards().put(board);
				await canonical().delete(boardId);

				const pageRows = Object.values(snapshot.doc.pages).map((page) => ({
					...PageOps.clone(page),
					boardId,
					updatedAt: timestamp
				}));
				const shapeRows = Object.values(snapshot.doc.shapes).map((shape) => ({
					...ShapeOps.clone(shape),
					boardId,
					updatedAt: timestamp
				}));
				const bindingRows = Object.values(snapshot.doc.bindings).map((binding) => ({
					...BindingOps.clone(binding),
					boardId,
					updatedAt: timestamp
				}));

				if (pageRows.length > 0) await pages().bulkPut(pageRows);
				if (shapeRows.length > 0) await shapes().bulkPut(shapeRows);
				if (bindingRows.length > 0) await bindings().bulkPut(bindingRows);

				const order = snapshot.order ?? deriveDocOrderFromDocument(snapshot.doc);
				await meta().put({ key: pageOrderKey(boardId), value: order.pageIds });
				await meta().put({ key: shapeOrderKey(boardId), value: order.shapeOrder ?? {} });
				const importedLayers = snapshot.doc.layers ?? order.layers;
				if (importedLayers && Object.keys(importedLayers).length > 0) {
					await meta().put({ key: layersKey(boardId), value: importedLayers });
				}
				if (snapshot.doc.assets && Object.keys(snapshot.doc.assets).length > 0) {
					await meta().put({ key: assetsKey(boardId), value: snapshot.doc.assets });
				}
			}
		);

		return boardId;
	}

	async function openBoard(boardId: string): Promise<void> {
		const exists = await boards().get(boardId);
		if (!exists) {
			throw new Error(`Board ${boardId} not found`);
		}
	}

	return {
		listBoards,
		createBoard,
		duplicateBoard,
		openBoard,
		renameBoard,
		deleteBoard,
		loadCanonical,
		saveCanonical,
		loadDoc,
		applyDocPatch,
		exportBoard,
		importBoard
	};
}

/**
 * Batch doc patches and flush them with a debounce to cut down on Dexie writes.
 */
export function createPersistenceSink(
	repo: PersistentDocRepo,
	options?: PersistenceSinkOptions
): PersistenceSink {
	const debounceMs = options?.debounceMs ?? 200;
	let pendingBoardId: string | null = null;
	let pendingPatch: DocPatch | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inflight: Promise<void> | null = null;

	const scheduleFlush = () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = null;
			void flush();
		}, debounceMs);
	};

	const resetPending = () => {
		pendingBoardId = null;
		pendingPatch = null;
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	async function flush(): Promise<void> {
		if (inflight) {
			await inflight;
			return;
		}

		if (!pendingBoardId || !pendingPatch || isPatchEmpty(pendingPatch)) {
			resetPending();
			return;
		}

		const boardId = pendingBoardId;
		const patch = pendingPatch;
		resetPending();

		inflight = repo.applyDocPatch(boardId, patch).finally(() => {
			inflight = null;
		});

		await inflight;
	}

	function enqueueDocPatch(boardId: string, patch: DocPatch): void {
		if (!boardId) {
			throw new Error('boardId is required to persist edits');
		}

		if (pendingBoardId && pendingBoardId !== boardId) {
			void flush();
		}

		pendingBoardId = boardId;
		pendingPatch = clonePatch(patch);
		if (!isPatchEmpty(pendingPatch)) {
			scheduleFlush();
		}
	}

	return { enqueueDocPatch, flush };
}

function clonePageRow(row: PageRow): EditorPageRecord {
	const { boardId: _boardId, updatedAt: _updatedAt, ...rest } = row;
	return PageOps.clone(rest);
}

function cloneShapeRow(row: ShapeRow): EditorShapeRecord {
	const { boardId: _boardId, updatedAt: _updatedAt, ...rest } = row;
	return ShapeOps.clone(rest as EditorShapeRecord);
}

function cloneBindingRow(row: BindingRow): EditorBindingRecord {
	const { boardId: _boardId, updatedAt: _updatedAt, ...rest } = row;
	return BindingOps.clone(rest);
}

function deriveDocOrderFromDocument(doc: EditorDocument): DocOrder {
	return {
		pageIds: Object.keys(doc.pages),
		shapeOrder: shapeOrderFromPagesRecords(doc.pages),
		layers: doc.layers
	};
}

function shapeOrderFromPagesRecords(
	pages: Record<string, EditorPageRecord>
): Record<string, string[]> {
	return Object.fromEntries(Object.values(pages).map((page) => [page.id, [...page.shapeIds]]));
}

function shapeOrderFromPageRows(rows: PageRow[]): Record<string, string[]> {
	return Object.fromEntries(rows.map((row) => [row.id, [...row.shapeIds]]));
}

function clonePatch(patch: DocPatch): DocPatch {
	const cloned: DocPatch = {};
	if (patch.topologyEdits) {
		cloned.topologyEdits = patch.topologyEdits.map((edit) => ({
			shapeId: edit.shapeId,
			operations: edit.operations.map((operation) => ({ ...operation }))
		}));
	}

	if (patch.upserts) {
		cloned.upserts = {};
		if (patch.upserts.pages)
			cloned.upserts.pages = patch.upserts.pages.map((page) => PageOps.clone(page));
		if (patch.upserts.shapes)
			cloned.upserts.shapes = patch.upserts.shapes.map((shape) => ShapeOps.clone(shape));
		if (patch.upserts.bindings) {
			cloned.upserts.bindings = patch.upserts.bindings.map((binding) =>
				BindingOps.clone(binding)
			);
		}
		if (patch.upserts.assets) {
			cloned.upserts.assets = patch.upserts.assets.map((asset) => ({
				...asset,
				bytes: [...asset.bytes]
			}));
		}
		if (
			!cloned.upserts.pages &&
			!cloned.upserts.shapes &&
			!cloned.upserts.bindings &&
			!cloned.upserts.assets
		) {
			delete cloned.upserts;
		}
	}

	if (patch.deletes) {
		cloned.deletes = {};
		if (patch.deletes.pageIds) cloned.deletes.pageIds = [...patch.deletes.pageIds];
		if (patch.deletes.shapeIds) cloned.deletes.shapeIds = [...patch.deletes.shapeIds];
		if (patch.deletes.bindingIds) cloned.deletes.bindingIds = [...patch.deletes.bindingIds];
		if (patch.deletes.assetIds) cloned.deletes.assetIds = [...patch.deletes.assetIds];
		if (
			!cloned.deletes.pageIds?.length &&
			!cloned.deletes.shapeIds?.length &&
			!cloned.deletes.bindingIds?.length &&
			!cloned.deletes.assetIds?.length
		) {
			delete cloned.deletes;
		}
	}

	if (patch.order) {
		const pageIds = patch.order.pageIds ? [...patch.order.pageIds] : undefined;
		const shapeOrder = cloneShapeOrderMap(patch.order.shapeOrder);
		const layers = patch.order.layers
			? Object.fromEntries(
					Object.entries(patch.order.layers).map(([id, layer]) => [
						id,
						LayerOps.clone(layer)
					])
				)
			: undefined;
		if (pageIds || shapeOrder || layers) {
			cloned.order = {};
			if (pageIds) {
				cloned.order.pageIds = pageIds;
			}
			if (shapeOrder) {
				cloned.order.shapeOrder = shapeOrder;
			}
			if (layers) cloned.order.layers = layers;
		}
	}

	return cloned;
}

function cloneShapeOrderMap(
	shapeOrder?: Record<string, string[]>
): Record<string, string[]> | undefined {
	if (!shapeOrder) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(shapeOrder).map(([pageId, shapeIds]) => [pageId, [...shapeIds]])
	);
}

function isPatchEmpty(patch: DocPatch): boolean {
	const hasUpserts =
		Boolean(patch.upserts?.pages?.length) ||
		Boolean(patch.upserts?.shapes?.length) ||
		Boolean(patch.upserts?.bindings?.length) ||
		Boolean(patch.upserts?.assets?.length);

	const hasDeletes =
		Boolean(patch.deletes?.pageIds?.length) ||
		Boolean(patch.deletes?.shapeIds?.length) ||
		Boolean(patch.deletes?.bindingIds?.length) ||
		Boolean(patch.deletes?.assetIds?.length);

	const hasOrder =
		Boolean(patch.order?.pageIds?.length) ||
		Boolean(patch.order?.shapeOrder && Object.keys(patch.order.shapeOrder).length > 0) ||
		Boolean(patch.order?.layers && Object.keys(patch.order.layers).length > 0);
	const hasTopology = Boolean(patch.topologyEdits?.length);

	return !(hasUpserts || hasDeletes || hasOrder || hasTopology);
}

/**
 * Fetch board statistics for a given board.
 */
export async function getBoardStats(database: DexieLike, boardId: string): Promise<BoardStats> {
	const pages = database.table<PageRow>('pages');
	const shapes = database.table<ShapeRow>('shapes');
	const bindings = database.table<BindingRow>('bindings');
	const boards = database.table<BoardMeta>('boards');
	const canonical = database.table<CanonicalRow>('canonical');
	const meta = database.table<MetaRow>('meta');

	const [board, canonicalRow] = await Promise.all([boards.get(boardId), canonical.get(boardId)]);
	if (canonicalRow) {
		const document = canonicalRow.snapshot.document;
		return BoardStatsOps.create({
			pageCount: Object.keys(document.pages).length,
			shapeCount: Object.keys(document.shapes).length,
			bindingCount: Object.keys(document.bindings).length,
			layerCount: Object.keys(document.layers).length,
			assetCount: Object.keys(document.assets).length,
			docSizeBytes: canonicalRow.bytes.byteLength,
			lastUpdated: board?.updatedAt ?? canonicalRow.updatedAt
		});
	}

	const [pageRows, shapeRows, bindingRows, layersRow, assetsRow] = await Promise.all([
		pages.where('boardId').equals(boardId).toArray(),
		shapes.where('boardId').equals(boardId).toArray(),
		bindings.where('boardId').equals(boardId).toArray(),
		meta.get(layersKey(boardId)),
		meta.get(assetsKey(boardId))
	]);

	const docSizeBytes = JSON.stringify({
		pages: pageRows,
		shapes: shapeRows,
		bindings: bindingRows,
		layers: layersRow?.value,
		assets: assetsRow?.value
	}).length;

	return BoardStatsOps.create({
		pageCount: pageRows.length,
		shapeCount: shapeRows.length,
		bindingCount: bindingRows.length,
		layerCount: layersRow?.value
			? Object.keys(layersRow.value as Record<string, unknown>).length
			: undefined,
		assetCount: assetsRow?.value
			? Object.keys(assetsRow.value as Record<string, unknown>).length
			: undefined,
		docSizeBytes,
		lastUpdated: board?.updatedAt ?? 0
	});
}

/**
 * Fetch schema information from the database.
 */
export async function getSchemaInfo(database: Dexie): Promise<SchemaInfo> {
	return { declaredVersion: database.verno, installedVersion: database.verno };
}

/** Fetch complete inspector data for a board. */
export async function getBoardInspectorData(
	database: Dexie,
	boardId: string
): Promise<BoardInspectorData> {
	const [stats, schema, canonicalRow] = await Promise.all([
		getBoardStats(database, boardId),
		getSchemaInfo(database),
		database.table<CanonicalRow>('canonical').get(boardId)
	]);
	return {
		storageType: 'IndexedDB (Dexie)',
		stats,
		schema,
		document: canonicalRow
			? {
					documentId: canonicalRow.snapshot.document_id,
					formatVersion: canonicalRow.snapshot.format_version,
					canonical: true
				}
			: { canonical: false }
	};
}
