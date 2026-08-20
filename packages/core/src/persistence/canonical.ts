import type {
	AssetRecord as NativeAssetRecord,
	BindingRecord as NativeBindingRecord,
	Document as NativeDocument,
	DocumentSnapshot as NativeDocumentSnapshot,
	LayerRecord as NativeLayerRecord,
	PageRecord as NativePageRecord,
	Provenance,
	SemanticMetadata,
	ShapeRecord as NativeShapeRecord,
	ShapeStyle,
	ShapeProperties
} from '@inkfinite/bindings/model';
import type { BoardExport, DocOrder } from './document';
import { ensureDocumentLayers, type Document, type LayerRecord, type ShapeRecord } from '../model';

const FORMAT_ID = 'inkfinite.document';
const FORMAT_VERSION = 2;
const BROWSER_ACTOR = 'browser';

/** Options used when projecting an editor document into the Rust snapshot shape. */
export type CanonicalSnapshotOptions = { documentId: string; heads?: readonly string[]; order?: DocOrder };

/**
 * Converts the browser editor document into the JSON shape consumed by Rust
 * and the browser WASM renderer.
 *
 * The editor model is intentionally flat today. Each shape therefore becomes
 * a root child of its owning layer; its local transform preserves the editor's
 * position and rotation. The native hierarchy can replace this adapter when
 * browser projection moves into Rust.
 */
export function toCanonicalDocumentSnapshot(
	input: BoardExport | Document,
	options?: CanonicalSnapshotOptions
): NativeDocumentSnapshot {
	const board = isBoardExport(input) ? input : undefined;
	const source: Document = isBoardExport(input) ? input.doc : input;
	const document = ensureDocumentLayers(source);
	const documentId = options?.documentId ?? board?.board.id ?? 'document:browser';
	const order = options?.order ?? board?.order;
	const pageIds = orderedIds(order?.pageIds, Object.keys(document.pages));
	const layers = document.layers ?? {};
	const ownerByShape = layerOwners(layers);

	const nativePages: Record<string, NativePageRecord> = {};
	for (const pageId of pageIds) {
		const page = document.pages[pageId];
		if (!page) continue;
		const layerIds = (page.layerIds ?? []).filter((layerId) => layers[layerId]?.pageId === page.id);
		nativePages[page.id] = { id: page.id, name: page.name, layer_ids: layerIds, version: 1 };
	}

	const nativeLayers: Record<string, NativeLayerRecord> = {};
	for (const layer of Object.values(layers)) {
		nativeLayers[layer.id] = {
			id: layer.id,
			page_id: layer.pageId,
			name: layer.name,
			shape_ids: [...layer.shapeIds],
			visible: layer.visible,
			locked: layer.locked,
			opacity: clampOpacity(layer.opacity),
			version: 1
		};
	}

	const nativeShapes: Record<string, NativeShapeRecord> = {};
	for (const shape of Object.values(document.shapes)) {
		const layerId = shape.layerId ?? ownerByShape.get(shape.id);
		if (!layerId || !nativeLayers[layerId]) continue;
		nativeShapes[shape.id] = nativeShape(shape, layerId);
	}

	const nativeBindings: Record<string, NativeBindingRecord> = {};
	for (const binding of Object.values(document.bindings)) {
		nativeBindings[binding.id] = {
			id: binding.id,
			kind: binding.type,
			source_shape_id: binding.fromShapeId,
			target_shape_id: binding.toShapeId,
			source_handle: binding.handle,
			anchor:
				binding.anchor.kind === 'center'
					? { kind: 'center' }
					: { kind: 'edge', x: binding.anchor.nx, y: binding.anchor.ny },
			version: 1
		};
	}

	const nativeAssets: Record<string, NativeAssetRecord> = {};
	for (const asset of Object.values(document.assets ?? {})) {
		nativeAssets[asset.id] = {
			id: asset.id,
			name: asset.name,
			media_type: asset.mediaType,
			digest: asset.digest,
			source: { kind: 'embedded', bytes: [...asset.bytes] },
			provenance: provenance(),
			version: 1
		};
	}

	const nativeDocument: NativeDocument = {
		pages: nativePages,
		page_ids: Object.keys(nativePages),
		layers: nativeLayers,
		shapes: nativeShapes,
		bindings: nativeBindings,
		assets: nativeAssets
	};
	return {
		format: FORMAT_ID,
		format_version: FORMAT_VERSION,
		document_id: documentId,
		heads: [...(options?.heads ?? [])],
		document: nativeDocument
	};
}

function nativeShape(shape: ShapeRecord, layerId: string): NativeShapeRecord {
	const metadata: SemanticMetadata = {
		name: null,
		role: null,
		description: null,
		tags: [],
		locked: false,
		agent_editable: shape.agentEditable ?? true,
		provenance: provenance()
	};
	const style: ShapeStyle = {
		opacity: clampOpacity(shape.opacity),
		fill_opacity: optionalOpacity(shape.fillOpacity),
		stroke_opacity: optionalOpacity(shape.strokeOpacity)
	};
	return {
		id: shape.id,
		kind: shape.type,
		parent: { kind: 'layer', id: layerId },
		transform: { translation: { x: shape.x, y: shape.y }, rotation: shape.rot, scale_x: 1, scale_y: 1 },
		child_ids: [],
		layout: null,
		properties: JSON.parse(JSON.stringify(shape.props)) as ShapeProperties,
		metadata,
		style,
		version: 1
	};
}

function provenance(): Provenance {
	return { actor_id: BROWSER_ACTOR, origin: 'human', timestamp: 0, source: null };
}

function layerOwners(layers: Record<string, LayerRecord>): Map<string, string> {
	const owners = new Map<string, string>();
	for (const layer of Object.values(layers)) {
		for (const shapeId of layer.shapeIds) owners.set(shapeId, layer.id);
	}
	return owners;
}

function orderedIds(preferred: string[] | undefined, fallback: string[]): string[] {
	const available = new Set(fallback);
	const result = (preferred ?? []).filter((id) => available.has(id));
	for (const id of fallback) if (!result.includes(id)) result.push(id);
	return result;
}

function clampOpacity(value: number | undefined): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value! : 1));
}

function optionalOpacity(value: number | undefined): number | null {
	return value === undefined ? null : clampOpacity(value);
}

function isBoardExport(input: BoardExport | Document): input is BoardExport {
	return 'board' in input && 'doc' in input;
}
