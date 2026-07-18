import {
  type BindingRecord,
  BindingRecord as BindingOps,
  type Document,
  type PageRecord,
  PageRecord as PageOps,
  type ShapeRecord,
  ShapeRecord as ShapeOps,
} from "../model";
import type { BoardMeta, DocRepo } from "./repo";

/** Persisted page and shape ordering for a document. */
export type DocOrder = {
  pageIds: string[];
  /** Optional per-page shape order overrides. */
  shapeOrder?: Record<string, string[]>;
};

/** Incremental document changes accepted by persistent repositories. */
export type DocPatch = {
  upserts?: { pages?: PageRecord[]; shapes?: ShapeRecord[]; bindings?: BindingRecord[] };
  deletes?: { pageIds?: string[]; shapeIds?: string[]; bindingIds?: string[] };
  order?: Partial<DocOrder>;
};

/** A complete document loaded from persistence. */
export type LoadedDoc = {
  pages: Record<string, PageRecord>;
  shapes: Record<string, ShapeRecord>;
  bindings: Record<string, BindingRecord>;
  order: DocOrder;
};

/** Portable board snapshot used by import and export flows. */
export type BoardExport = { board: BoardMeta; doc: Document; order: DocOrder };

/** Receives editor patches and controls when they reach persistence. */
export type PersistenceSink = { enqueueDocPatch(boardId: string, patch: DocPatch): void; flush(): Promise<void> };

/** Platform-neutral document repository implemented by each application adapter. */
export interface PersistentDocRepo extends DocRepo {
  loadDoc(boardId: string): Promise<LoadedDoc>;
  applyDocPatch(boardId: string, patch: DocPatch): Promise<void>;
  exportBoard(boardId: string): Promise<BoardExport>;
  importBoard(snapshot: BoardExport): Promise<string>;
}

/**
 * Compute the persisted patch between two documents.
 *
 * The current format upserts the complete next document while recording removed
 * identifiers explicitly. Repository adapters remain responsible for applying the
 * patch atomically.
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

  patch.order = {
    pageIds: Object.keys(after.pages),
    shapeOrder: Object.fromEntries(Object.values(after.pages).map((page) => [page.id, [...page.shapeIds]])),
  };

  return patch;
}

function difference(before: string[], after: string[]): string[] {
  const afterSet = new Set(after);
  return before.filter((id) => !afterSet.has(id));
}
