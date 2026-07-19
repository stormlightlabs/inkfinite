import type { BoardMeta } from "@inkfinite/core";
import Dexie from "dexie";
import type { BindingRow, MetaRow, PageRow, ShapeRow } from "./repository";

/** Default IndexedDB database name for the static web application. */
export const DB_NAME = "inkfinite";

/**
 * Dexie database owned by the static web application's persistence adapter.
 */
export class InkfiniteDB extends Dexie {
  boards!: Dexie.Table<BoardMeta, string>;
  pages!: Dexie.Table<PageRow, [string, string]>;
  shapes!: Dexie.Table<ShapeRow, [string, string]>;
  bindings!: Dexie.Table<BindingRow, [string, string]>;
  meta!: Dexie.Table<MetaRow, string>;

  constructor(name = DB_NAME) {
    super(name);

    this.version(2).stores({
      boards: "id, name, createdAt, updatedAt",
      pages: "[boardId+id], boardId, updatedAt",
      shapes: "[boardId+id], boardId, type, updatedAt",
      bindings: "[boardId+id], boardId, type, updatedAt",
      meta: "key",
    });
  }
}
