import type {
	EditorPatch,
	EditorProjection,
	EditorReconciliationRequest,
	EditorTransform
} from '@inkfinite/bindings/editor';
import type {
	AssetRecord as NativeAssetRecord,
	BindingRecord as NativeBindingRecord,
	Document as NativeDocument,
	DocumentSnapshot as NativeDocumentSnapshot,
	LayerRecord as NativeLayerRecord,
	PageRecord as NativePageRecord,
	Provenance,
	SemanticMetadata,
	ShapeParent,
	ShapeRecord as NativeShapeRecord,
	ShapeStyle,
	ShapeProperties,
	Transform
} from '@inkfinite/bindings/model';
import type { BoardExport, DocOrder, LoadedDoc } from './document';
import {
	ensureDocumentLayers,
	type Document,
	type LayerRecord,
	type PathTopologyEdit,
	type ShapeMetadata,
	type ShapeRecord
} from '../model';

const FORMAT_ID = 'inkfinite.document';
const FORMAT_VERSION = 2;
const BROWSER_ACTOR = 'browser';

/** Options used when projecting an editor document into the Rust snapshot shape. */
export type CanonicalSnapshotOptions = { documentId: string; heads?: readonly string[]; order?: DocOrder };

/**
 * Converts the browser editor document into the JSON shape consumed by Rust
 * and the browser WASM renderer.
 *
 * Legacy flat editor documents are normalized into root children of their
 * owning layers. Active browser sessions use the Rust projection and do not
 * rebuild this hierarchy in TypeScript.
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
			shape_ids: layer.shapeIds.filter((shapeId) => {
				const shape = document.shapes[shapeId];
				return shape?.layerId === layer.id && !shape.groupId;
			}),
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
		nativeShapes[shape.id] = nativeShape(shape, layerId, document);
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
			relation_type: binding.relationType ?? null,
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

/**
 * Hydrates the editor document from the Rust-owned flat projection.
 *
 * `snapshot` is supplied only for assets because the editor projection contains
 * drawable records and ordering, not binary content.
 */
export function fromEditorProjection(projection: EditorProjection, snapshot?: NativeDocumentSnapshot): LoadedDoc {
	const pages: Record<string, import('../model').PageRecord> = {};
	const layers: Record<string, LayerRecord> = {};
	const shapes: Record<string, ShapeRecord> = {};
	const bindings: Record<string, import('../model').BindingRecord> = {};

	for (const pageId of projection.order.page_ids) {
		const page = projection.pages[pageId];
		if (!page) continue;
		pages[page.id] = { id: page.id, name: page.name, shapeIds: [...page.shape_ids], layerIds: [...page.layer_ids] };
	}
	for (const layer of Object.values(projection.layers)) {
		layers[layer.id] = {
			id: layer.id,
			pageId: layer.page_id,
			name: layer.name,
			shapeIds: [...layer.shape_ids],
			visible: layer.visible,
			locked: layer.locked,
			opacity: layer.opacity
		};
	}
	for (const shape of Object.values(projection.shapes)) {
		shapes[shape.id] = {
			id: shape.id,
			type: shape.type as ShapeRecord['type'],
			pageId: shape.page_id,
			x: shape.x,
			y: shape.y,
			rot: shape.rot,
			editorTransform: shape.transform,
			opacity: shape.opacity,
			...(shape.fill_opacity === null ? {} : { fillOpacity: shape.fill_opacity }),
			...(shape.stroke_opacity === null ? {} : { strokeOpacity: shape.stroke_opacity }),
			...(shape.group_id === null ? {} : { groupId: shape.group_id }),
			layerId: shape.layer_id,
			locked: shape.locked,
			agentEditable: shape.agent_editable,
			metadata: fromNativeMetadata(shape.metadata),
			props: editorProperties(shape.props as ShapeProperties) as ShapeRecord['props'],
			...(shape.resolved_geometry ? { resolvedGeometry: shape.resolved_geometry } : {})
		} as ShapeRecord;
	}
	for (const binding of Object.values(projection.bindings)) {
		bindings[binding.id] = {
			id: binding.id,
			type: binding.type as import('../model').BindingType,
			fromShapeId: binding.from_shape_id,
			toShapeId: binding.to_shape_id,
			handle: binding.handle as import('../model').BindingHandle,
			anchor:
				binding.anchor.kind === 'center'
					? { kind: 'center' }
					: { kind: 'edge', nx: binding.anchor.x, ny: binding.anchor.y },
			...(binding.relation_type === null || binding.relation_type === undefined
				? {}
				: { relationType: binding.relation_type })
		};
	}
	const assets = Object.fromEntries(
		Object.values(snapshot?.document.assets ?? {}).flatMap((asset) =>
			asset.source.kind === 'embedded'
				? [
						[
							asset.id,
							{
								id: asset.id,
								name: asset.name,
								mediaType: asset.media_type,
								digest: asset.digest,
								bytes: [...asset.source.bytes]
							}
						]
					]
				: []
		)
	);
	return {
		pages,
		layers,
		shapes,
		bindings,
		...(Object.keys(assets).length > 0 ? { assets } : {}),
		order: {
			pageIds: [...projection.order.page_ids],
			shapeOrder: Object.fromEntries(
				Object.entries(projection.order.shape_order).map(([pageId, shapeIds]) => [pageId, [...shapeIds]])
			),
			layers
		}
	};
}

export function fromCanonicalDocumentSnapshot(snapshot: NativeDocumentSnapshot): LoadedDoc {
	const pages: Record<string, import('../model').PageRecord> = {};
	const layers: Record<string, LayerRecord> = {};
	const shapes: Record<string, ShapeRecord> = {};
	const bindings: Record<string, import('../model').BindingRecord> = {};

	for (const pageId of snapshot.document.page_ids) {
		const page = snapshot.document.pages[pageId];
		if (!page) continue;
		pages[page.id] = { id: page.id, name: page.name, shapeIds: [], layerIds: [...page.layer_ids] };
		for (const layerId of page.layer_ids) {
			const layer = snapshot.document.layers[layerId];
			if (!layer) continue;
			const layerShapeIds: string[] = [];
			const walk = (shapeId: string, parent: string | undefined, transform: Affine) => {
				const native = snapshot.document.shapes[shapeId];
				if (!native) return;
				const world = multiplyAffine(transform, transformFromNative(native.transform));
				const shape = editorShape(native, page.id, layer.id, parent, world);
				shapes[shape.id] = shape;
				layerShapeIds.push(shape.id);
				pages[page.id]!.shapeIds.push(shape.id);
				for (const childId of native.child_ids)
					walk(childId, native.kind === 'container' ? native.id : parent, world);
			};
			for (const shapeId of layer.shape_ids) walk(shapeId, undefined, identityAffine());
			layers[layer.id] = {
				id: layer.id,
				pageId: layer.page_id,
				name: layer.name,
				shapeIds: layerShapeIds,
				visible: layer.visible,
				locked: layer.locked,
				opacity: layer.opacity
			};
		}
	}

	for (const binding of Object.values(snapshot.document.bindings)) {
		bindings[binding.id] = {
			id: binding.id,
			type: binding.kind as import('../model').BindingType,
			fromShapeId: binding.source_shape_id,
			toShapeId: binding.target_shape_id,
			handle: binding.source_handle as import('../model').BindingHandle,
			anchor:
				binding.anchor.kind === 'center'
					? { kind: 'center' }
					: { kind: 'edge', nx: binding.anchor.x, ny: binding.anchor.y },
			...(binding.relation_type === null || binding.relation_type === undefined
				? {}
				: { relationType: binding.relation_type })
		};
	}

	const assets = Object.fromEntries(
		Object.values(snapshot.document.assets).flatMap((asset) =>
			asset.source.kind === 'embedded'
				? [
						[
							asset.id,
							{
								id: asset.id,
								name: asset.name,
								mediaType: asset.media_type,
								digest: asset.digest,
								bytes: [...asset.source.bytes]
							}
						]
					]
				: []
		)
	);
	const order: DocOrder = {
		pageIds: [...snapshot.document.page_ids],
		shapeOrder: Object.fromEntries(Object.values(pages).map((page) => [page.id, [...page.shapeIds]])),
		layers
	};
	return { pages, layers, shapes, bindings, ...(Object.keys(assets).length > 0 ? { assets } : {}), order };
}

/** Builds one semantic Rust reconciliation request from an editor document change. */
export function createEditorReconciliationRequest(
	before: Document,
	after: Document,
	options: Omit<EditorReconciliationRequest, 'patches'> & { topologyEdits?: PathTopologyEdit[] }
): EditorReconciliationRequest {
	const { topologyEdits = [], ...requestOptions } = options;
	const previous = ensureDocumentLayers(before);
	const next = ensureDocumentLayers(after);
	const patches: EditorPatch[] = [];
	const previousShapes = previous.shapes;
	const nextShapes = next.shapes;
	const deletedPages = new Set(Object.keys(previous.pages).filter((id) => !next.pages[id]));
	const deletedLayerDestinations = deletedLayerMoves(previous, next);
	const topologyShapeIds = new Set(topologyEdits.map((edit) => edit.shapeId));

	for (const page of Object.values(next.pages)) {
		if (!previous.pages[page.id]) {
			patches.push({
				type: 'create_page',
				page: { id: page.id, name: page.name, layer_ids: [], version: 1 },
				anchor: orderAnchorFor(page.id, Object.keys(next.pages))
			});
		}
	}
	for (const layer of Object.values(next.layers ?? {})) {
		if (!previous.layers?.[layer.id]) {
			patches.push({
				type: 'create_layer',
				layer: nativeLayer(layer),
				anchor: orderAnchorFor(layer.id, next.pages[layer.pageId]?.layerIds ?? [])
			});
		}
	}

	for (const shapeId of Object.keys(previousShapes)) {
		if (!nextShapes[shapeId] && !deletedPages.has(previousShapes[shapeId]!.pageId)) {
			patches.push({ type: 'delete_shape', shape_id: shapeId });
		}
	}
	for (const asset of Object.values(next.assets ?? {})) {
		if (!previous.assets?.[asset.id]) patches.push({ type: 'create_asset', asset: nativeAsset(asset) });
	}
	for (const assetId of Object.keys(previous.assets ?? {})) {
		if (!next.assets?.[assetId]) patches.push({ type: 'delete_asset', asset_id: assetId });
	}
	for (const edit of topologyEdits) {
		if (previousShapes[edit.shapeId] && nextShapes[edit.shapeId]) {
			patches.push({ type: 'path_topology', shape_id: edit.shapeId, operations: edit.operations });
		}
	}
	for (const shape of Object.values(nextShapes)) {
		const old = previousShapes[shape.id];
		if (!old) {
			patches.push({
				type: 'create_shape',
				shape: {
					id: shape.id,
					kind: shape.type,
					properties: cloneProperties(shape.props),
					metadata: shape.metadata ? toNativeMetadata(shape.metadata) : null,
					style: shapeStyle(shape),
					layout: null
				},
				parent: shapeParent(shape, next),
				transform: editorTransform(shape),
				anchor: { position: 'last' }
			});
			continue;
		}
		const patch = shapePatch(
			old,
			shape,
			previous,
			next,
			deletedLayerDestinations.has(old.layerId ?? ''),
			topologyShapeIds.has(shape.id)
		);
		if (patch) patches.push(patch);
	}

	for (const page of Object.values(next.pages)) {
		const old = previous.pages[page.id];
		if (old && old.name !== page.name) patches.push({ type: 'rename_page', page_id: page.id, name: page.name });
	}
	for (const layer of Object.values(next.layers ?? {})) {
		const old = previous.layers?.[layer.id];
		if (!old) continue;
		const patch = {
			name: old.name === layer.name ? null : layer.name,
			visible: old.visible === layer.visible ? null : layer.visible,
			locked: old.locked === layer.locked ? null : layer.locked,
			opacity: old.opacity === layer.opacity ? null : clampOpacity(layer.opacity)
		};
		if (patch.name !== null || patch.visible !== null || patch.locked !== null || patch.opacity !== null) {
			patches.push({ type: 'patch_layer', layer_id: layer.id, patch });
		}
		if (old && JSON.stringify(old.pageId) === JSON.stringify(layer.pageId)) {
			const beforeIds = previous.pages[layer.pageId]?.layerIds ?? [];
			const afterIds = next.pages[layer.pageId]?.layerIds ?? [];
			if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds) && beforeIds.includes(layer.id)) {
				patches.push({ type: 'reorder_layer', layer_id: layer.id, anchor: orderAnchorFor(layer.id, afterIds) });
			}
		}
	}
	for (const layerId of Object.keys(previous.layers ?? {})) {
		const layer = previous.layers![layerId]!;
		if (!deletedPages.has(layer.pageId) && !next.layers?.[layerId]) {
			const destination = deletedLayerDestinations.get(layerId);
			patches.push({
				type: 'delete_layer',
				layer_id: layerId,
				contents: destination ? { kind: 'move_to', destination_layer_id: destination } : { kind: 'delete' }
			});
		}
	}
	for (const pageId of Object.keys(previous.pages)) {
		if (deletedPages.has(pageId)) patches.push({ type: 'delete_page', page_id: pageId });
	}

	for (const binding of Object.values(previous.bindings)) {
		if (!next.bindings[binding.id] && next.shapes[binding.fromShapeId] && next.shapes[binding.toShapeId]) {
			patches.push({ type: 'delete_binding', binding_id: binding.id });
		}
	}
	for (const binding of Object.values(next.bindings)) {
		const old = previous.bindings[binding.id];
		if (!old) {
			patches.push({ type: 'create_binding', binding: nativeBinding(binding) });
		} else if (JSON.stringify(old) !== JSON.stringify(binding)) {
			patches.push({ type: 'delete_binding', binding_id: binding.id });
			patches.push({ type: 'create_binding', binding: nativeBinding(binding) });
		}
	}
	return { ...requestOptions, patches };
}

type Affine = EditorTransform;

function identityAffine(): Affine {
	return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function transformFromNative(transform: Transform): Affine {
	const cos = Math.cos(transform.rotation);
	const sin = Math.sin(transform.rotation);
	return {
		a: cos * transform.scale_x,
		b: sin * transform.scale_x,
		c: -sin * transform.scale_y,
		d: cos * transform.scale_y,
		e: transform.translation.x,
		f: transform.translation.y
	};
}

function multiplyAffine(parent: Affine, child: Affine): Affine {
	return {
		a: parent.a * child.a + parent.c * child.b,
		b: parent.b * child.a + parent.d * child.b,
		c: parent.a * child.c + parent.c * child.d,
		d: parent.b * child.c + parent.d * child.d,
		e: parent.a * child.e + parent.c * child.f + parent.e,
		f: parent.b * child.e + parent.d * child.f + parent.f
	};
}

function editorShape(
	native: NativeShapeRecord,
	pageId: string,
	layerId: string,
	groupId: string | undefined,
	transform: Affine
): ShapeRecord {
	return {
		id: native.id,
		type: native.kind as ShapeRecord['type'],
		pageId,
		x: transform.e,
		y: transform.f,
		rot: Math.atan2(transform.b, transform.a),
		editorTransform: transform,
		groupId,
		layerId,
		opacity: native.style.opacity,
		...(native.style.fill_opacity === null ? {} : { fillOpacity: native.style.fill_opacity }),
		...(native.style.stroke_opacity === null ? {} : { strokeOpacity: native.style.stroke_opacity }),
		locked: native.metadata.locked,
		agentEditable: native.metadata.agent_editable,
		metadata: fromNativeMetadata(native.metadata),
		props: editorProperties(native.properties)
	} as ShapeRecord;
}

function fromNativeMetadata(metadata: SemanticMetadata): ShapeMetadata {
	return {
		name: metadata.name,
		title: metadata.title,
		role: metadata.role,
		description: metadata.description,
		body: metadata.body,
		tags: [...metadata.tags],
		source: metadata.source,
		link: metadata.link,
		customMetadata: JSON.parse(JSON.stringify(metadata.custom_metadata)) as Record<string, unknown>,
		locked: metadata.locked,
		agentEditable: metadata.agent_editable,
		provenance: {
			actorId: metadata.provenance.actor_id,
			origin: metadata.provenance.origin,
			timestamp: metadata.provenance.timestamp,
			source: metadata.provenance.source
		}
	};
}

function shapeMetadata(shape: ShapeRecord): ShapeMetadata {
	if (shape.metadata) {
		return {
			...shape.metadata,
			locked: shape.locked ?? shape.metadata.locked,
			agentEditable: shape.agentEditable ?? shape.metadata.agentEditable,
			tags: [...shape.metadata.tags],
			customMetadata: { ...shape.metadata.customMetadata }
		};
	}
	return {
		name: null,
		title: null,
		role: null,
		description: null,
		body: null,
		tags: [],
		source: null,
		link: null,
		customMetadata: {},
		locked: shape.locked ?? false,
		agentEditable: shape.agentEditable !== false
	};
}

function toNativeMetadata(
	metadata: ShapeMetadata | undefined,
	overrides: { locked?: boolean; agentEditable?: boolean } = {}
): SemanticMetadata {
	const value = metadata ?? {
		name: null,
		title: null,
		role: null,
		description: null,
		body: null,
		tags: [],
		source: null,
		link: null,
		customMetadata: {},
		locked: false,
		agentEditable: true
	};
	return {
		name: value.name,
		title: value.title,
		role: value.role,
		description: value.description,
		body: value.body,
		tags: [...value.tags],
		source: value.source,
		link: value.link,
		custom_metadata: JSON.parse(JSON.stringify(value.customMetadata)),
		locked: overrides.locked ?? value.locked,
		agent_editable: overrides.agentEditable ?? value.agentEditable,
		provenance: value.provenance
			? {
					actor_id: value.provenance.actorId,
					origin: value.provenance.origin,
					timestamp: value.provenance.timestamp,
					source: value.provenance.source
				}
			: provenance()
	};
}

function editorProperties(properties: ShapeProperties): ShapeProperties {
	const result = JSON.parse(JSON.stringify(properties)) as ShapeProperties;
	for (const [native, editor] of [
		['width', 'w'],
		['height', 'h'],
		['markdown', 'md'],
		['background', 'bg'],
		['font_size', 'fontSize'],
		['font_family', 'fontFamily'],
		['asset_id', 'assetId'],
		['reference_type', 'referenceType'],
		['clip_path', 'clipPath'],
		['mask_effect', 'maskEffect'],
		['text_path', 'textPath'],
		['width_profile', 'widthProfile']
	] as const) {
		if (native in result && !(editor in result)) result[editor] = result[native];
		delete result[native];
	}
	return result;
}

function cloneProperties(properties: ShapeRecord['props']): ShapeProperties {
	return JSON.parse(JSON.stringify(properties)) as ShapeProperties;
}

function shapeStyle(shape: ShapeRecord): ShapeStyle {
	return {
		opacity: clampOpacity(shape.opacity),
		fill_opacity: shape.fillOpacity === undefined ? null : clampOpacity(shape.fillOpacity),
		stroke_opacity: shape.strokeOpacity === undefined ? null : clampOpacity(shape.strokeOpacity)
	};
}

function shapeParent(shape: ShapeRecord, document: Document): ShapeParent {
	return shape.groupId
		? { kind: 'shape', id: shape.groupId }
		: { kind: 'layer', id: shape.layerId ?? findShapeLayer(shape.id, document) };
}

function findShapeLayer(shapeId: string, document: Document): string {
	for (const layer of Object.values(document.layers ?? {})) {
		if (layer.shapeIds.includes(shapeId)) return layer.id;
	}
	throw new Error(`Shape ${shapeId} has no owning layer`);
}

function nativeLayer(layer: LayerRecord): NativeLayerRecord {
	return {
		id: layer.id,
		page_id: layer.pageId,
		name: layer.name,
		shape_ids: [],
		visible: layer.visible,
		locked: layer.locked,
		opacity: clampOpacity(layer.opacity),
		version: 1
	};
}

function deletedLayerMoves(before: Document, after: Document): Map<string, string> {
	const destinations = new Map<string, string>();
	for (const layer of Object.values(before.layers ?? {})) {
		if (after.layers?.[layer.id]) continue;
		const movedShapes = layer.shapeIds
			.map((shapeId) => after.shapes[shapeId]?.layerId)
			.filter((layerId): layerId is string => Boolean(layerId));
		if (movedShapes.length === layer.shapeIds.length && movedShapes.length > 0 && new Set(movedShapes).size === 1) {
			destinations.set(layer.id, movedShapes[0]!);
		}
	}
	return destinations;
}

function orderAnchorFor(id: string, ids: string[]) {
	const index = ids.indexOf(id);
	return index <= 0
		? ({ position: 'first' } as const)
		: ({ position: 'after', sibling_id: ids[index - 1]! } as const);
}

function shapePatch(
	before: ShapeRecord,
	after: ShapeRecord,
	beforeDocument: Document,
	afterDocument: Document,
	skipDeletedLayerParent: boolean,
	skipProperties: boolean
): EditorPatch | null {
	if (before.type !== after.type) {
		const styleChanged = JSON.stringify(shapeStyle(before)) !== JSON.stringify(shapeStyle(after));
		return {
			type: 'convert_shape',
			shape_id: after.id,
			kind: after.type,
			properties: cloneProperties(after.props),
			style: styleChanged ? shapeStyle(after) : null
		};
	}
	const parentBefore = shapeParent(before, beforeDocument);
	const parentAfter = shapeParent(after, afterDocument);
	let transformChanged =
		JSON.stringify(editorTransform(before, before)) !== JSON.stringify(editorTransform(after, before));
	if (transformChanged && parentBefore.kind === 'shape' && parentAfter.kind === 'shape') {
		const beforeParent = beforeDocument.shapes[parentBefore.id];
		const afterParent = afterDocument.shapes[parentAfter.id];
		if (beforeParent && afterParent) {
			const beforeLocal = multiplyAffine(
				inverseAffine(editorTransform(beforeParent)),
				editorTransform(before, before)
			);
			const afterLocal = multiplyAffine(
				inverseAffine(editorTransform(afterParent)),
				editorTransform(after, before)
			);
			transformChanged = !sameAffine(beforeLocal, afterLocal);
		}
	}
	const propertiesChanged = !skipProperties && JSON.stringify(before.props) !== JSON.stringify(after.props);
	const metadataChanged = JSON.stringify(shapeMetadata(before)) !== JSON.stringify(shapeMetadata(after));
	const styleChanged = JSON.stringify(shapeStyle(before)) !== JSON.stringify(shapeStyle(after));
	const orderChanged = skipDeletedLayerParent
		? false
		: siblingOrderChanged(before.id, parentBefore, parentAfter, beforeDocument, afterDocument);
	const parentChanged = JSON.stringify(parentBefore) !== JSON.stringify(parentAfter);
	if (
		!transformChanged &&
		!propertiesChanged &&
		!metadataChanged &&
		!styleChanged &&
		(!parentChanged || skipDeletedLayerParent) &&
		!orderChanged
	)
		return null;
	return {
		type: 'shape',
		shape_id: after.id,
		transform: transformChanged ? editorTransform(after, before) : null,
		properties: propertiesChanged ? cloneProperties(after.props) : null,
		metadata: metadataChanged
			? toNativeMetadata(after.metadata, {
					locked: after.locked ?? false,
					agentEditable: after.agentEditable ?? true
				})
			: null,
		style: styleChanged ? shapeStyle(after) : null,
		parent: !parentChanged || skipDeletedLayerParent ? null : parentAfter,
		anchor: orderChanged ? orderAnchor(after.id, parentAfter, afterDocument) : null
	};
}

function editorTransform(shape: ShapeRecord, previous?: ShapeRecord): EditorTransform {
	const current = shape.editorTransform ? { ...shape.editorTransform } : transformFromRotation(shape.rot, 1, 1);
	if (previous && !shape.editorTransform && Math.abs(shape.rot - previous.rot) > 1e-9) {
		const previousTransform = previous.editorTransform ?? transformFromRotation(previous.rot, 1, 1);
		const scaleX = Math.hypot(previousTransform.a, previousTransform.b);
		const determinant = previousTransform.a * previousTransform.d - previousTransform.b * previousTransform.c;
		const scaleY = scaleX > Number.EPSILON ? determinant / scaleX : 1;
		const cos = Math.cos(shape.rot);
		const sin = Math.sin(shape.rot);
		return { a: cos * scaleX, b: sin * scaleX, c: -sin * scaleY, d: cos * scaleY, e: shape.x, f: shape.y };
	}
	return { ...current, e: shape.x, f: shape.y };
}

function transformFromRotation(rotation: number, scaleX: number, scaleY: number): EditorTransform {
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return { a: cos * scaleX, b: sin * scaleX, c: -sin * scaleY, d: cos * scaleY, e: 0, f: 0 };
}

function siblingOrderChanged(
	shapeId: string,
	beforeParent: ShapeParent,
	afterParent: ShapeParent,
	before: Document,
	after: Document
): boolean {
	if (JSON.stringify(beforeParent) !== JSON.stringify(afterParent)) return true;
	const beforeSiblings = siblings(beforeParent, before);
	const afterSiblings = siblings(afterParent, after);
	return JSON.stringify(beforeSiblings) !== JSON.stringify(afterSiblings) && afterSiblings.includes(shapeId);
}

function siblings(parent: ShapeParent, document: Document): string[] {
	if (parent.kind === 'layer') return document.layers?.[parent.id]?.shapeIds ?? [];
	return Object.values(document.shapes)
		.filter((shape) => shape.groupId === parent.id)
		.map((shape) => shape.id);
}

function orderAnchor(shapeId: string, parent: ShapeParent, document: Document) {
	const ids = siblings(parent, document).filter((id) => id !== shapeId);
	const index = siblings(parent, document).indexOf(shapeId);
	return index <= 0
		? { position: 'first' as const }
		: { position: 'after' as const, sibling_id: ids[index - 1] ?? ids.at(-1)! };
}

function nativePropertiesForShape(shape: ShapeRecord): ShapeProperties {
	const properties = JSON.parse(JSON.stringify(shape.props)) as ShapeProperties;
	if ('clipPath' in properties) {
		properties.clip_path = properties.clipPath;
		delete properties.clipPath;
	}
	if ('maskEffect' in properties) {
		properties.mask_effect = properties.maskEffect;
		delete properties.maskEffect;
	}
	if ('textPath' in properties) {
		properties.text_path = properties.textPath;
		delete properties.textPath;
	}
	if (shape.type !== 'container' && !shape.groupId) return properties;
	if ('w' in properties) {
		properties.width = properties.w;
		delete properties.w;
	}
	if ('h' in properties) {
		properties.height = properties.h;
		delete properties.h;
	}
	return properties;
}

function nativeTransform(shape: ShapeRecord, document: Document): Transform {
	const world = editorTransform(shape);
	const parent = shape.groupId ? document.shapes[shape.groupId] : undefined;
	const parentWorld = parent ? editorTransform(parent) : identityAffine();
	const local = multiplyAffine(inverseAffine(parentWorld), world);
	const scaleX = Math.hypot(local.a, local.b);
	const determinant = local.a * local.d - local.b * local.c;
	const scaleY = scaleX > Number.EPSILON ? determinant / scaleX : 1;
	return {
		translation: { x: local.e, y: local.f },
		rotation: Math.atan2(local.b, local.a),
		scale_x: scaleX,
		scale_y: scaleY
	};
}

function inverseAffine(value: Affine): Affine {
	const determinant = value.a * value.d - value.b * value.c;
	if (Math.abs(determinant) <= Number.EPSILON) return identityAffine();
	return {
		a: value.d / determinant,
		b: -value.b / determinant,
		c: -value.c / determinant,
		d: value.a / determinant,
		e: (value.c * value.f - value.d * value.e) / determinant,
		f: (value.b * value.e - value.a * value.f) / determinant
	};
}

function sameAffine(left: Affine, right: Affine): boolean {
	return [
		[left.a, right.a],
		[left.b, right.b],
		[left.c, right.c],
		[left.d, right.d],
		[left.e, right.e],
		[left.f, right.f]
	].every(([a, b]) => Math.abs(a - b) <= 1e-9 * (1 + Math.max(Math.abs(a), Math.abs(b))));
}

function orderedChildren(shape: ShapeRecord, document: Document): string[] {
	const layer = shape.layerId ? document.layers?.[shape.layerId] : undefined;
	const order = layer?.shapeIds ?? document.pages[shape.pageId]?.shapeIds ?? [];
	const children = order.filter((id) => document.shapes[id]?.groupId === shape.id);
	if (children.length > 0) return children;
	return Object.values(document.shapes)
		.filter((candidate) => candidate.groupId === shape.id)
		.map((candidate) => candidate.id);
}

function nativeAsset(asset: import('../model').ImportedAsset): NativeAssetRecord {
	return {
		id: asset.id,
		name: asset.name,
		media_type: asset.mediaType,
		digest: asset.digest,
		source: { kind: 'embedded', bytes: [...asset.bytes] },
		provenance: provenance(),
		version: 1
	};
}

function nativeBinding(binding: import('../model').BindingRecord): NativeBindingRecord {
	return {
		id: binding.id,
		kind: binding.type,
		source_shape_id: binding.fromShapeId,
		target_shape_id: binding.toShapeId,
		source_handle: binding.handle,
		anchor:
			binding.anchor.kind === 'center'
				? { kind: 'center' }
				: { kind: 'edge', x: binding.anchor.nx, y: binding.anchor.ny },
		relation_type: binding.relationType ?? null,
		version: 1
	};
}

function nativeShape(shape: ShapeRecord, layerId: string, document: Document): NativeShapeRecord {
	const metadata = toNativeMetadata(shape.metadata, {
		locked: shape.locked ?? false,
		agentEditable: shape.agentEditable ?? true
	});
	const style: ShapeStyle = {
		opacity: clampOpacity(shape.opacity),
		fill_opacity: optionalOpacity(shape.fillOpacity),
		stroke_opacity: optionalOpacity(shape.strokeOpacity)
	};
	return {
		id: shape.id,
		kind: shape.type,
		parent: shapeParent(shape, document),
		transform: nativeTransform(shape, document),
		child_ids: orderedChildren(shape, document),
		layout: null,
		properties: nativePropertiesForShape(shape),
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
