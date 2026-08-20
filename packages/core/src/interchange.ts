import type { BoardExport } from './persistence/document';
import { exportExcalidraw, importExcalidraw } from './interchange/excalidraw';
import { exportJsonCanvas, importJsonCanvas } from './interchange/json-canvas';
import { object } from './interchange/shared';

/** External editable document formats supported by Inkfinite. */
export type InterchangeFormat = 'excalidraw' | 'json-canvas';

/** Formats accepted by the import boundary. */
export type InterchangeImportFormat = InterchangeFormat;

/** A non-fatal loss or compatibility decision made during conversion. */
export type InterchangeWarning = { code: string; message: string; count: number };

/** A converted document and the losses encountered while reading it. */
export type InterchangeImport = {
	format: InterchangeImportFormat;
	snapshot: BoardExport;
	warnings: InterchangeWarning[];
};

/** Serialized external content and the losses encountered while writing it. */
export type InterchangeExport = {
	format: InterchangeFormat;
	contents: string;
	extension: 'canvas' | 'excalidraw';
	mimeType: 'application/json';
	warnings: InterchangeWarning[];
};

/** Selection and page options for browser Rust/WASM SVG rendering. */
export type SvgExportOptions = {
	pageId?: string;
	selectionIds?: string[];
	/** Preserve selected-only semantics when no shape is selected. */
	selectionOnly?: boolean;
};

/** Deterministic SVG output returned by a browser platform adapter. */
export type SvgExport = {
	format: 'svg';
	contents: string;
	extension: 'svg';
	mimeType: 'image/svg+xml';
	warnings: InterchangeWarning[];
};

const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/** Detects and imports a supported editable canvas document synchronously. */
export function importInterchange(contents: string, fileName: string): InterchangeImport {
	if (byteLength(contents) > MAX_IMPORT_BYTES) {
		throw new Error('The selected file is larger than the 16 MB import limit.');
	}
	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch {
		throw new Error('The selected file does not contain valid JSON.');
	}
	const root = object(value, 'document');
	if (root.type === 'excalidraw' || fileName.toLowerCase().endsWith('.excalidraw')) {
		return importExcalidraw(root, fileName);
	}
	if (Array.isArray(root.nodes) || Array.isArray(root.edges) || fileName.toLowerCase().endsWith('.canvas')) {
		return importJsonCanvas(root, fileName);
	}
	throw new Error('Choose an Excalidraw (.excalidraw) or Obsidian Canvas (.canvas) file.');
}

function byteLength(contents: string) {
	return new TextEncoder().encode(contents).byteLength;
}

/** Exports one Inkfinite page to a supported editable canvas format. */
export function exportInterchange(
	snapshot: BoardExport,
	format: InterchangeFormat,
	pageId?: string
): InterchangeExport {
	return format === 'excalidraw' ? exportExcalidraw(snapshot, pageId) : exportJsonCanvas(snapshot, pageId);
}
