import Dexie from "dexie";
import {
  type BindingRecord,
  BindingRecord as BindingOps,
  createId,
  type Document,
  type PageRecord,
  PageRecord as PageOps,
  type ShapeRecord,
  ShapeRecord as ShapeOps,
} from "../model";
import type { BoardMeta, DocRepo, Timestamp } from "./repo";
import type { BoardInspectorData, BoardStats, MigrationInfo, SchemaInfo } from "./stats";
import { BoardStatsOps, getPendingMigrations } from "./stats";

export type PageRow = PageRecord & { boardId: string; updatedAt: Timestamp };

export type ShapeRow = ShapeRecord & { boardId: string; updatedAt: Timestamp };

export type BindingRow = BindingRecord & { boardId: string; updatedAt: Timestamp };

export type MetaRow = { key: string; value: unknown };

export type MigrationRow = { id: string; appliedAt: Timestamp };

export type DocOrder = {
  pageIds: string[];
  /** Optional per-page shape order overrides */
  shapeOrder?: Record<string, string[]>;
};

export type DocPatch = {
  upserts?: { pages?: PageRecord[]; shapes?: ShapeRecord[]; bindings?: BindingRecord[] };
  deletes?: { pageIds?: string[]; shapeIds?: string[]; bindingIds?: string[] };
  order?: Partial<DocOrder>;
};

export type LoadedDoc = {
  pages: Record<string, PageRecord>;
  shapes: Record<string, ShapeRecord>;
  bindings: Record<string, BindingRecord>;
  order: DocOrder;
};

export type BoardExport = { board: BoardMeta; doc: Document; order: DocOrder };

export type PersistenceSink = { enqueueDocPatch(boardId: string, patch: DocPatch): void; flush(): Promise<void> };

export type PersistenceSinkOptions = { debounceMs?: number };

export interface PersistentDocRepo extends DocRepo {
  loadDoc(boardId: string): Promise<LoadedDoc>;
  applyDocPatch(boardId: string, patch: DocPatch): Promise<void>;
  exportBoard(boardId: string): Promise<BoardExport>;
  importBoard(snapshot: BoardExport): Promise<string>;
}

export type WebRepoOptions = { now?: () => Timestamp };

type DexieLike = Pick<Dexie, "table" | "transaction">;

const DEFAULT_BOARD_NAME = "Untitled Board";

const PAGE_ORDER_META_PREFIX = "page-order:";
const SHAPE_ORDER_META_PREFIX = "shape-order:";

const pageOrderKey = (boardId: string) => `${PAGE_ORDER_META_PREFIX}${boardId}`;
const shapeOrderKey = (boardId: string) => `${SHAPE_ORDER_META_PREFIX}${boardId}`;

/**
 * Create a Dexie-backed persistent DocRepo used by the web app.
 */
export function createWebDocRepo(database: DexieLike, options?: WebRepoOptions): PersistentDocRepo {
  const now = () => options?.now?.() ?? Date.now();

  const boards = () => database.table<BoardMeta>("boards");
  const pages = () => database.table<PageRow>("pages");
  const shapes = () => database.table<ShapeRow>("shapes");
  const bindings = () => database.table<BindingRow>("bindings");
  const meta = () => database.table<MetaRow>("meta");

  async function listBoards(): Promise<BoardMeta[]> {
    return boards().orderBy("updatedAt").reverse().toArray();
  }

  async function createBoard(name: string): Promise<string> {
    const boardId = createId("board");
    const timestamp = now();
    const page = PageOps.create("Page 1");
    const pageRow: PageRow = { ...page, boardId, updatedAt: timestamp };

    await database.transaction("rw", boards(), pages(), meta(), async () => {
      await boards().add({ id: boardId, name: name || DEFAULT_BOARD_NAME, createdAt: timestamp, updatedAt: timestamp });
      await pages().add(pageRow);
      await meta().put({ key: pageOrderKey(boardId), value: [page.id] });
      await meta().put({ key: shapeOrderKey(boardId), value: { [page.id]: [...page.shapeIds] } });
    });

    return boardId;
  }

  async function renameBoard(boardId: string, name: string): Promise<void> {
    await boards().update(boardId, { name, updatedAt: now() });
  }

  async function deleteBoard(boardId: string): Promise<void> {
    await database.transaction("rw", [boards(), pages(), shapes(), bindings(), meta()], async () => {
      const pageKeys = (await pages().where("boardId").equals(boardId).toArray()).map((row) =>
        [row.boardId, row.id] as [string, string]
      );
      const shapeKeys = (await shapes().where("boardId").equals(boardId).toArray()).map((row) =>
        [row.boardId, row.id] as [string, string]
      );
      const bindingKeys = (await bindings().where("boardId").equals(boardId).toArray()).map((row) =>
        [row.boardId, row.id] as [string, string]
      );

      await boards().delete(boardId);
      if (pageKeys.length > 0) await pages().bulkDelete(pageKeys);
      if (shapeKeys.length > 0) await shapes().bulkDelete(shapeKeys);
      if (bindingKeys.length > 0) await bindings().bulkDelete(bindingKeys);
      await meta().delete(pageOrderKey(boardId));
      await meta().delete(shapeOrderKey(boardId));
    });
  }

  async function loadDoc(boardId: string): Promise<LoadedDoc> {
    const pageRows = await pages().where("boardId").equals(boardId).toArray();
    const [shapeRows, bindingRows, order] = await Promise.all([
      shapes().where("boardId").equals(boardId).toArray(),
      bindings().where("boardId").equals(boardId).toArray(),
      loadOrder(boardId, pageRows),
    ]);

    const docPages: Record<string, PageRecord> = {};
    for (const row of pageRows) {
      docPages[row.id] = clonePageRow(row);
    }

    const docShapes: Record<string, ShapeRecord> = {};
    for (const row of shapeRows) {
      docShapes[row.id] = cloneShapeRow(row);
    }

    const docBindings: Record<string, BindingRecord> = {};
    for (const row of bindingRows) {
      docBindings[row.id] = cloneBindingRow(row);
    }

    return { pages: docPages, shapes: docShapes, bindings: docBindings, order };
  }

  async function loadOrder(boardId: string, fallbackPages: PageRow[]): Promise<DocOrder> {
    const pageOrderRow = await meta().get(pageOrderKey(boardId));
    const shapeOrderRow = await meta().get(shapeOrderKey(boardId));
    const fallbackPageIds = fallbackPages.map((row) => row.id);
    const fallbackShapeOrder = shapeOrderFromPageRows(fallbackPages);

    return {
      pageIds: (pageOrderRow?.value as string[] | undefined) ?? fallbackPageIds,
      shapeOrder: (shapeOrderRow?.value as Record<string, string[]> | undefined) ?? fallbackShapeOrder,
    };
  }

  async function applyDocPatch(boardId: string, patch: DocPatch): Promise<void> {
    const timestamp = now();

    await database.transaction("rw", [boards(), pages(), shapes(), bindings(), meta()], async () => {
      const pageDeleteKeys = patch.deletes?.pageIds?.map((id) => [boardId, id] as [string, string]) ?? [];
      const shapeDeleteKeys = patch.deletes?.shapeIds?.map((id) => [boardId, id] as [string, string]) ?? [];
      const bindingDeleteKeys = patch.deletes?.bindingIds?.map((id) => [boardId, id] as [string, string]) ?? [];

      if (pageDeleteKeys.length > 0) await pages().bulkDelete(pageDeleteKeys);
      if (shapeDeleteKeys.length > 0) await shapes().bulkDelete(shapeDeleteKeys);
      if (bindingDeleteKeys.length > 0) await bindings().bulkDelete(bindingDeleteKeys);

      const upsertPages =
        patch.upserts?.pages?.map((page) => ({ ...PageOps.clone(page), boardId, updatedAt: timestamp })) ?? [];
      const upsertShapes =
        patch.upserts?.shapes?.map((shape) => ({ ...ShapeOps.clone(shape), boardId, updatedAt: timestamp })) ?? [];
      const upsertBindings =
        patch.upserts?.bindings?.map((binding) => ({ ...BindingOps.clone(binding), boardId, updatedAt: timestamp }))
          ?? [];

      if (upsertPages.length > 0) await pages().bulkPut(upsertPages);
      if (upsertShapes.length > 0) await shapes().bulkPut(upsertShapes);
      if (upsertBindings.length > 0) await bindings().bulkPut(upsertBindings);

      if (patch.order?.pageIds) {
        await meta().put({ key: pageOrderKey(boardId), value: [...patch.order.pageIds] });
      }

      if (patch.order?.shapeOrder) {
        await meta().put({ key: shapeOrderKey(boardId), value: patch.order.shapeOrder });
      }

      await boards().update(boardId, { updatedAt: timestamp });
    });
  }

  async function exportBoard(boardId: string): Promise<BoardExport> {
    const board = await boards().get(boardId);
    if (!board) {
      throw new Error(`Board ${boardId} not found`);
    }

    const { pages, shapes, bindings, order } = await loadDoc(boardId);
    const doc: Document = { pages, shapes, bindings };
    return { board, doc, order };
  }

  async function importBoard(snapshot: BoardExport): Promise<string> {
    const boardId = snapshot.board.id ?? createId("board");
    const timestamp = now();
    const board: BoardMeta = {
      id: boardId,
      name: snapshot.board.name || DEFAULT_BOARD_NAME,
      createdAt: snapshot.board.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    await database.transaction("rw", [boards(), pages(), shapes(), bindings(), meta()], async () => {
      await boards().put(board);

      const pageRows = Object.values(snapshot.doc.pages).map((page) => ({
        ...PageOps.clone(page),
        boardId,
        updatedAt: timestamp,
      }));
      const shapeRows = Object.values(snapshot.doc.shapes).map((shape) => ({
        ...ShapeOps.clone(shape),
        boardId,
        updatedAt: timestamp,
      }));
      const bindingRows = Object.values(snapshot.doc.bindings).map((binding) => ({
        ...BindingOps.clone(binding),
        boardId,
        updatedAt: timestamp,
      }));

      if (pageRows.length > 0) await pages().bulkPut(pageRows);
      if (shapeRows.length > 0) await shapes().bulkPut(shapeRows);
      if (bindingRows.length > 0) await bindings().bulkPut(bindingRows);

      const order = snapshot.order ?? deriveDocOrderFromDocument(snapshot.doc);
      await meta().put({ key: pageOrderKey(boardId), value: order.pageIds });
      await meta().put({ key: shapeOrderKey(boardId), value: order.shapeOrder ?? {} });
    });

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
    openBoard,
    renameBoard,
    deleteBoard,
    loadDoc,
    applyDocPatch,
    exportBoard,
    importBoard,
  };
}

/**
 * Compute a patch between two documents. Current implementation sends the full snapshot (upsert all rows).
 */
export function diffDoc(before: Document, after: Document): DocPatch {
  const patch: DocPatch = {};

  const deletedPages = difference(Object.keys(before.pages), Object.keys(after.pages));
  const deletedShapes = difference(Object.keys(before.shapes), Object.keys(after.shapes));
  const deletedBindings = difference(Object.keys(before.bindings), Object.keys(after.bindings));

  if (deletedPages.length > 0 || deletedShapes.length > 0 || deletedBindings.length > 0) {
    patch.deletes = {};
    if (deletedPages.length > 0) patch.deletes.pageIds = deletedPages;
    if (deletedShapes.length > 0) patch.deletes.shapeIds = deletedShapes;
    if (deletedBindings.length > 0) patch.deletes.bindingIds = deletedBindings;
  }

  const pageUpserts = Object.values(after.pages).map((page) => PageOps.clone(page));
  const shapeUpserts = Object.values(after.shapes).map((shape) => ShapeOps.clone(shape));
  const bindingUpserts = Object.values(after.bindings).map((binding) => BindingOps.clone(binding));

  if (pageUpserts.length > 0 || shapeUpserts.length > 0 || bindingUpserts.length > 0) {
    patch.upserts = {};
    if (pageUpserts.length > 0) patch.upserts.pages = pageUpserts;
    if (shapeUpserts.length > 0) patch.upserts.shapes = shapeUpserts;
    if (bindingUpserts.length > 0) patch.upserts.bindings = bindingUpserts;
  }

  patch.order = deriveDocOrderFromDocument(after);

  return patch;
}

/**
 * Batch doc patches and flush them with a debounce to cut down on Dexie writes.
 */
export function createPersistenceSink(repo: PersistentDocRepo, options?: PersistenceSinkOptions): PersistenceSink {
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
      throw new Error("boardId is required to persist edits");
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

function clonePageRow(row: PageRow): PageRecord {
  const { boardId: _boardId, updatedAt: _updatedAt, ...rest } = row;
  return PageOps.clone(rest);
}

function cloneShapeRow(row: ShapeRow): ShapeRecord {
  const { boardId: _boardId, updatedAt: _updatedAt, ...rest } = row;
  return ShapeOps.clone(rest as ShapeRecord);
}

function cloneBindingRow(row: BindingRow): BindingRecord {
  const { boardId: _boardId, updatedAt: _updatedAt, ...rest } = row;
  return BindingOps.clone(rest);
}

function difference(before: string[], after: string[]): string[] {
  const afterSet = new Set(after);
  return before.filter((id) => !afterSet.has(id));
}

function deriveDocOrderFromDocument(doc: Document): DocOrder {
  return { pageIds: Object.keys(doc.pages), shapeOrder: shapeOrderFromPagesRecords(doc.pages) };
}

function shapeOrderFromPagesRecords(pages: Record<string, PageRecord>): Record<string, string[]> {
  return Object.fromEntries(Object.values(pages).map((page) => [page.id, [...page.shapeIds]]));
}

function shapeOrderFromPageRows(rows: PageRow[]): Record<string, string[]> {
  return Object.fromEntries(rows.map((row) => [row.id, [...row.shapeIds]]));
}

function clonePatch(patch: DocPatch): DocPatch {
  const cloned: DocPatch = {};

  if (patch.upserts) {
    cloned.upserts = {};
    if (patch.upserts.pages) cloned.upserts.pages = patch.upserts.pages.map((page) => PageOps.clone(page));
    if (patch.upserts.shapes) cloned.upserts.shapes = patch.upserts.shapes.map((shape) => ShapeOps.clone(shape));
    if (patch.upserts.bindings) {
      cloned.upserts.bindings = patch.upserts.bindings.map((binding) => BindingOps.clone(binding));
    }
    if (!cloned.upserts.pages && !cloned.upserts.shapes && !cloned.upserts.bindings) {
      delete cloned.upserts;
    }
  }

  if (patch.deletes) {
    cloned.deletes = {};
    if (patch.deletes.pageIds) cloned.deletes.pageIds = [...patch.deletes.pageIds];
    if (patch.deletes.shapeIds) cloned.deletes.shapeIds = [...patch.deletes.shapeIds];
    if (patch.deletes.bindingIds) cloned.deletes.bindingIds = [...patch.deletes.bindingIds];
    if (!cloned.deletes.pageIds?.length && !cloned.deletes.shapeIds?.length && !cloned.deletes.bindingIds?.length) {
      delete cloned.deletes;
    }
  }

  if (patch.order) {
    const pageIds = patch.order.pageIds ? [...patch.order.pageIds] : undefined;
    const shapeOrder = cloneShapeOrderMap(patch.order.shapeOrder);
    if (pageIds || shapeOrder) {
      cloned.order = {};
      if (pageIds) {
        cloned.order.pageIds = pageIds;
      }
      if (shapeOrder) {
        cloned.order.shapeOrder = shapeOrder;
      }
    }
  }

  return cloned;
}

function cloneShapeOrderMap(shapeOrder?: Record<string, string[]>): Record<string, string[]> | undefined {
  if (!shapeOrder) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(shapeOrder).map(([pageId, shapeIds]) => [pageId, [...shapeIds]]));
}

function isPatchEmpty(patch: DocPatch): boolean {
  const hasUpserts = Boolean(patch.upserts?.pages?.length)
    || Boolean(patch.upserts?.shapes?.length)
    || Boolean(patch.upserts?.bindings?.length);

  const hasDeletes = Boolean(patch.deletes?.pageIds?.length)
    || Boolean(patch.deletes?.shapeIds?.length)
    || Boolean(patch.deletes?.bindingIds?.length);

  const hasOrder = Boolean(patch.order?.pageIds?.length)
    || Boolean(patch.order?.shapeOrder && Object.keys(patch.order.shapeOrder).length > 0);

  return !(hasUpserts || hasDeletes || hasOrder);
}

/**
 * Fetch board statistics for a given board.
 */
export async function getBoardStats(database: DexieLike, boardId: string): Promise<BoardStats> {
  const pages = database.table<PageRow>("pages");
  const shapes = database.table<ShapeRow>("shapes");
  const bindings = database.table<BindingRow>("bindings");
  const boards = database.table<BoardMeta>("boards");

  const [pageCount, shapeCount, bindingCount, board] = await Promise.all([
    pages.where("boardId").equals(boardId).count(),
    shapes.where("boardId").equals(boardId).count(),
    bindings.where("boardId").equals(boardId).count(),
    boards.get(boardId),
  ]);

  const allRows = await Promise.all([
    pages.where("boardId").equals(boardId).toArray(),
    shapes.where("boardId").equals(boardId).toArray(),
    bindings.where("boardId").equals(boardId).toArray(),
  ]);

  const docSizeBytes = JSON.stringify({ pages: allRows[0], shapes: allRows[1], bindings: allRows[2] }).length;

  return BoardStatsOps.create({
    pageCount,
    shapeCount,
    bindingCount,
    docSizeBytes,
    lastUpdated: board?.updatedAt ?? 0,
  });
}

/**
 * Fetch schema information from the database.
 */
export async function getSchemaInfo(database: Dexie): Promise<SchemaInfo> {
  return { declaredVersion: database.verno, installedVersion: database.verno };
}

/**
 * Fetch applied migrations from the migrations table.
 */
export async function getAppliedMigrations(database: DexieLike): Promise<MigrationInfo[]> {
  const migrations = database.table<MigrationRow>("migrations");
  return migrations.orderBy("appliedAt").toArray();
}

/**
 * Fetch complete inspector data for a board including stats, schema, and migrations.
 */
export async function getBoardInspectorData(
  database: Dexie,
  boardId: string,
  knownMigrationIds: string[],
): Promise<BoardInspectorData> {
  const [stats, schema, migrations] = await Promise.all([
    getBoardStats(database, boardId),
    getSchemaInfo(database),
    getAppliedMigrations(database),
  ]);

  const pendingMigrations = getPendingMigrations(knownMigrationIds, migrations);

  return { stats, schema, migrations, pendingMigrations };
}
