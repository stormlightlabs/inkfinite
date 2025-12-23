import Dexie, { type Transaction } from "dexie";
import { PageRecord as PageOps } from "../model";
import type { BoardMeta, Timestamp } from "./repo";
import type { BindingRow, MetaRow, MigrationRow, PageRow, ShapeRow } from "./web";

export const DB_NAME = "inkfinite";

type Migration = { id: string; apply(tx: Transaction): Promise<void> };

const PAGE_ORDER_META_PREFIX = "page-order:";
const SHAPE_ORDER_META_PREFIX = "shape-order:";

const pageOrderKey = (boardId: string) => `${PAGE_ORDER_META_PREFIX}${boardId}`;
const shapeOrderKey = (boardId: string) => `${SHAPE_ORDER_META_PREFIX}${boardId}`;

/**
 * Dexie wrapper for Inkfinite persistence
 */
export class InkfiniteDB extends Dexie {
  boards!: Dexie.Table<BoardMeta, string>;
  pages!: Dexie.Table<PageRow, [string, string]>;
  shapes!: Dexie.Table<ShapeRow, [string, string]>;
  bindings!: Dexie.Table<BindingRow, [string, string]>;
  meta!: Dexie.Table<MetaRow, string>;
  migrations!: Dexie.Table<MigrationRow, string>;

  constructor(name = DB_NAME) {
    super(name);

    this.version(1).stores({
      boards: "id, name, createdAt, updatedAt",
      pages: "[boardId+id], boardId, updatedAt",
      shapes: "[boardId+id], boardId, type, updatedAt",
      bindings: "[boardId+id], boardId, type, updatedAt",
      meta: "key",
      migrations: "id, appliedAt",
    }).upgrade(async (tx) => {
      await runMigrations(tx);
    });
  }
}

const MIGRATIONS: Migration[] = [{
  id: "MIG-0001",
  async apply(tx) {
    const boards = tx.table<BoardMeta>("boards");
    const rows = await boards.toArray();
    const timestamp = Date.now();

    for (const row of rows) {
      const patch: Partial<BoardMeta> = {};
      if (!row.createdAt) {
        patch.createdAt = timestamp;
      }
      if (!row.updatedAt) {
        patch.updatedAt = timestamp;
      }

      if (Object.keys(patch).length > 0) {
        await boards.update(row.id, patch);
      }
    }
  },
}, {
  id: "MIG-0002",
  async apply(tx) {
    const boards = tx.table<BoardMeta>("boards");
    const pages = tx.table<PageRow>("pages");
    const meta = tx.table<MetaRow>("meta");
    const rows = await boards.toArray();
    const timestamp = Date.now();

    for (const row of rows) {
      const pageCount = await pages.where("boardId").equals(row.id).count();
      if (pageCount > 0) {
        continue;
      }

      const defaultPage = PageOps.create("Page 1");
      await pages.add({ ...defaultPage, boardId: row.id, updatedAt: timestamp });
      await meta.put({ key: pageOrderKey(row.id), value: [defaultPage.id] });
      await meta.put({ key: shapeOrderKey(row.id), value: { [defaultPage.id]: [...defaultPage.shapeIds] } });
      await boards.update(row.id, { updatedAt: timestamp });
    }
  },
}];

/**
 * Known migration IDs for tracking pending migrations in the inspector.
 */
export const KNOWN_MIGRATION_IDS = MIGRATIONS.map((m) => m.id);

/**
 * Run pending logical migrations during schema upgrades
 */
export async function runMigrations(tx: Transaction): Promise<void> {
  const migrations = tx.table<MigrationRow>("migrations");
  const applied = await migrations.toArray();
  const appliedIds = new Set(applied.map((row) => row.id));

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    await migration.apply(tx);
    await migrations.put({ id: migration.id, appliedAt: Date.now() as Timestamp });
  }
}
