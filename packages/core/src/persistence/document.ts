import {
	type EditorBindingRecord,
	EditorBindingRecord as BindingOps,
	type EditorDocument,
	type EditorLayerRecord,
	type EditorPageRecord,
	EditorPageRecord as PageOps,
	type EditorShapeRecord,
	EditorShapeRecord as ShapeOps,
	type ImportedAsset,
	type PathTopologyEdit
} from '../editor-model';
import type { EditorProjection } from '@inkfinite/bindings/editor';
import type { DocumentSnapshot as NativeDocumentSnapshot } from '@inkfinite/bindings/model';
import type { BoardMeta, DocRepo } from './repo';

/** Persisted page and shape ordering for a document. */
export type DocOrder = {
	pageIds: string[];
	/** Optional per-page shape order overrides. */
	shapeOrder?: Record<string, string[]>;
	/** Complete layer records, stored with ordering metadata by editor adapters. */
	layers?: Record<string, EditorLayerRecord>;
};

/** Incremental document changes accepted by persistent repositories. */
export type DocPatch = {
	upserts?: { pages?: EditorPageRecord[]; shapes?: EditorShapeRecord[]; bindings?: EditorBindingRecord[]; assets?: ImportedAsset[] };
	deletes?: { pageIds?: string[]; shapeIds?: string[]; bindingIds?: string[]; assetIds?: string[] };
	order?: Partial<DocOrder>;
	/** Canonical path operations associated with this document change. */
	topologyEdits?: PathTopologyEdit[];
};

/** A complete document loaded from persistence. */
export type LoadedDoc = {
	pages: Record<string, EditorPageRecord>;
	layers?: Record<string, EditorLayerRecord>;
	shapes: Record<string, EditorShapeRecord>;
	bindings: Record<string, EditorBindingRecord>;
	assets?: Record<string, ImportedAsset>;
	order: DocOrder;
};

/** Portable board snapshot used by import and export flows. */
export type BoardExport = { board: BoardMeta; doc: EditorDocument; order: DocOrder };

/** Canonical bytes and their materialized cache stored by browser adapters. */
export type CanonicalDocumentState = {
	bytes: Uint8Array;
	snapshot: NativeDocumentSnapshot;
	/** Rust-owned editor projection cached with canonical state for hydration. */
	projection?: EditorProjection;
};

/** One editor document change handed to a Rust-backed browser persistence adapter. */
export type EditorDocumentChange = {
	boardId: string;
	before: EditorDocument;
	after: EditorDocument;
	op: 'do' | 'undo' | 'redo';
	description: string;
	topologyEdits?: PathTopologyEdit[];
};

/** Receives editor changes and controls when they reach persistence. */
export type PersistenceSink = {
	enqueueDocPatch(boardId: string, patch: DocPatch): void;
	enqueueEditorChange?(change: EditorDocumentChange): void;
	flush(): Promise<void>;
};

/** Platform-neutral document repository implemented by each application adapter. */
export interface PersistentDocRepo extends DocRepo {
	/** Loads canonical browser state when the adapter supports the Rust engine. */
	loadCanonical?(boardId: string): Promise<CanonicalDocumentState | null>;
	/** Atomically stores canonical bytes and the derived materialized cache. */
	saveCanonical?(boardId: string, state: CanonicalDocumentState): Promise<void>;
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
export function diffDoc(before: EditorDocument, after: EditorDocument): DocPatch {
	const patch: DocPatch = {};
	const deletedPages = difference(Object.keys(before.pages), Object.keys(after.pages));
	const deletedShapes = difference(Object.keys(before.shapes), Object.keys(after.shapes));
	const deletedBindings = difference(Object.keys(before.bindings), Object.keys(after.bindings));
	const deletedAssets = difference(Object.keys(before.assets ?? {}), Object.keys(after.assets ?? {}));

	if (deletedPages.length > 0 || deletedShapes.length > 0 || deletedBindings.length > 0 || deletedAssets.length > 0) {
		patch.deletes = {};
		if (deletedPages.length > 0) patch.deletes.pageIds = deletedPages;
		if (deletedShapes.length > 0) patch.deletes.shapeIds = deletedShapes;
		if (deletedBindings.length > 0) patch.deletes.bindingIds = deletedBindings;
		if (deletedAssets.length > 0) patch.deletes.assetIds = deletedAssets;
	}

	const pageUpserts = Object.values(after.pages).map((page) => PageOps.clone(page));
	const shapeUpserts = Object.values(after.shapes).map((shape) => ShapeOps.clone(shape));
	const bindingUpserts = Object.values(after.bindings).map((binding) => BindingOps.clone(binding));
	const assetUpserts = Object.values(after.assets ?? {}).map((asset) => ({ ...asset, bytes: [...asset.bytes] }));

	if (pageUpserts.length > 0 || shapeUpserts.length > 0 || bindingUpserts.length > 0 || assetUpserts.length > 0) {
		patch.upserts = {};
		if (pageUpserts.length > 0) patch.upserts.pages = pageUpserts;
		if (shapeUpserts.length > 0) patch.upserts.shapes = shapeUpserts;
		if (bindingUpserts.length > 0) patch.upserts.bindings = bindingUpserts;
		if (assetUpserts.length > 0) patch.upserts.assets = assetUpserts;
	}

	patch.order = {
		pageIds: Object.keys(after.pages),
		shapeOrder: Object.fromEntries(Object.values(after.pages).map((page) => [page.id, [...page.shapeIds]])),
		layers: Object.fromEntries(
			Object.entries(after.layers ?? {}).map(([id, layer]) => [id, { ...layer, shapeIds: [...layer.shapeIds] }])
		)
	};

	return patch;
}

function difference(before: string[], after: string[]): string[] {
	const afterSet = new Set(after);
	return before.filter((id) => !afterSet.has(id));
}
