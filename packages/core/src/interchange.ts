import type { BoardExport } from './persistence/document';
import { exportExcalidraw, importExcalidraw } from './interchange/excalidraw';
import { exportJsonCanvas, importJsonCanvas } from './interchange/json-canvas';
import { importD2, importMermaid } from './interchange/diagram';
import { object } from './interchange/shared';

export { importD2, importMermaid } from './interchange/diagram';
export type { DiagramFormat } from './interchange/diagram';

/** External editable document formats supported by Inkfinite. */
export type InterchangeFormat = 'excalidraw' | 'json-canvas';

/** Formats accepted by the import boundary. */
export type InterchangeImportFormat = InterchangeFormat | 'mermaid' | 'd2';

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
	const lowerName = fileName.toLowerCase();
	if (lowerName.endsWith('.mmd') || lowerName.endsWith('.mermaid')) return importMermaid(contents, fileName);
	if (lowerName.endsWith('.d2')) return importD2(contents, fileName);

	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch {
		if (/^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\b/i.test(contents)) return importMermaid(contents, fileName);
		throw new Error('The selected file does not contain valid JSON or a supported Mermaid diagram.');
	}
	const root = object(value, 'document');
	if (root.type === 'excalidraw' || lowerName.endsWith('.excalidraw')) {
		return importExcalidraw(root, fileName);
	}
	if (Array.isArray(root.nodes) || Array.isArray(root.edges) || lowerName.endsWith('.canvas')) {
		return importJsonCanvas(root, fileName);
	}
	throw new Error('Choose an Excalidraw (.excalidraw), Obsidian Canvas (.canvas), Mermaid (.mmd), or D2 (.d2) file.');
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
