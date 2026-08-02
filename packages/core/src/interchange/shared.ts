import { createId, LayerRecord, PageRecord, type ArrowShape, type Document, type ShapeRecord as Shape } from '../model';
import type { BoardExport } from '../persistence/document';
import type { InterchangeWarning } from '../interchange';

/** Parsed JSON object consumed by an interchange codec. */
export type JsonObject = Record<string, unknown>;

/** Creates the single-page document that receives imported shapes. */
export function blankSnapshot(fileName: string) {
	const boardId = createId('board');
	const page = PageRecord.create('Page 1');
	const layer = LayerRecord.create(page.id, 'Imported');
	page.layerIds = [layer.id];
	const timestamp = Date.now();
	const doc: Document = { pages: { [page.id]: page }, layers: { [layer.id]: layer }, shapes: {}, bindings: {} };
	const snapshot: BoardExport = {
		board: {
			id: boardId,
			name: fileName.replace(/\.(?:excalidraw|canvas)$/i, '').trim() || 'Imported Board',
			createdAt: timestamp,
			updatedAt: timestamp
		},
		doc,
		order: { pageIds: [page.id], shapeOrder: { [page.id]: [] }, layers: doc.layers }
	};
	return { snapshot, pageId: page.id, layerId: layer.id };
}

/** Adds an imported shape to its document, page, and layer indexes. */
export function addShape(document: Document, pageId: string, layerId: string, shape: Shape) {
	document.shapes[shape.id] = shape;
	document.pages[pageId].shapeIds.push(shape.id);
	document.layers![layerId].shapeIds.push(shape.id);
}

/** Resolves the requested export page and records multi-page loss. */
export function selectPage(
	document: Document,
	pageOrder: string[],
	requestedPageId: string | undefined,
	warnings: WarningCollector
) {
	const pageId = requestedPageId ?? pageOrder[0] ?? Object.keys(document.pages)[0];
	const page = pageId ? document.pages[pageId] : undefined;
	if (!page) throw new Error('The Inkfinite document has no page to export.');
	if (Object.keys(document.pages).length > 1)
		warnings.add('multiple-pages', 'Only the selected Inkfinite page was exported.');
	return page;
}

/** Resolves one bound endpoint from an arrow. */
export function bindingFor(document: Document, arrow: ArrowShape, handle: 'start' | 'end') {
	const endpoint = arrow.props[handle];
	if (endpoint.kind !== 'bound' || !endpoint.bindingId) return undefined;
	return document.bindings[endpoint.bindingId];
}

/** Namespaces a source identifier without making it unstable. */
export function inkId(namespace: string, id: string) {
	return `${namespace}:${id}`;
}

/** Requires a JSON object at a named input location. */
export function object(value: unknown, name: string): JsonObject {
	if (!isObject(value)) throw new Error(`${name} must be a JSON object.`);
	return value;
}

/** Checks whether a value is a non-array JSON object. */
export function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads an optional JSON array, defaulting an absent value to empty. */
export function optionalArray(value: unknown, name: string): unknown[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
	return value;
}

/** Requires a non-empty string at a named input location. */
export function requiredString(value: unknown, name: string) {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
	return value;
}

/** Requires a finite number at a named input location. */
export function finiteNumber(value: unknown, name: string) {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
	return value;
}

/** Aggregates repeated lossy-conversion decisions by stable warning code. */
export class WarningCollector {
	private warnings = new Map<string, InterchangeWarning>();

	add(code: string, message: string, count = 1) {
		const current = this.warnings.get(code);
		this.warnings.set(code, { code, message, count: (current?.count ?? 0) + count });
	}

	values() {
		return [...this.warnings.values()];
	}
}
