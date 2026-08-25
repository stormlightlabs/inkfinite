import {
	BindingRecord,
	createId,
	ShapeRecord,
	shapeBounds,
	type EditorState,
	type ImportedAsset,
	type ShapeRecord as Shape,
	type Vec2
} from '@inkfinite/core';

export const CLIPBOARD_MIME = 'application/x-inkfinite-selection';
const CLIPBOARD_KIND = 'inkfinite-selection';
let fallbackClipboard: string | null = null;

/** Serialized native selection used by copy, cut, and paste commands. */
export type ClipboardPayload = {
	kind: typeof CLIPBOARD_KIND;
	version: 1 | 2;
	shapes: Shape[];
	bindings: BindingRecord[];
	rootIds: string[];
	assets: ImportedAsset[];
};

/** Content read from the system clipboard, classified before it reaches the editor. */
export type ClipboardContent =
	| { type: 'native'; payload: ClipboardPayload }
	| { type: 'text'; text: string; markdown: boolean }
	| { type: 'svg'; contents: string }
	| { type: 'image'; name: string; mediaType: string; bytes: number[] };

/** Options controlling where a native selection is inserted. */
export type PasteOptions = { offset?: number; position?: Vec2; inPlace?: boolean };

/** Returns the selected shapes and descendants in page draw order. */
export function createClipboardPayload(state: EditorState): ClipboardPayload | null {
	const selectedIds = new Set(state.ui.selectionIds);
	const rootIds = state.ui.selectionIds.filter(
		(id) => !hasSelectedAncestor(state, id, selectedIds)
	);
	if (rootIds.length === 0) return null;

	const includedIds = new Set<string>();
	for (const shape of Object.values(state.doc.shapes)) {
		if (rootIds.some((rootId) => shape.id === rootId || hasAncestor(shape, rootId, state))) {
			includedIds.add(shape.id);
		}
	}
	const page = state.doc.pages[state.ui.currentPageId ?? ''];
	const shapes = (page?.shapeIds ?? [])
		.filter((id) => includedIds.has(id))
		.map((id) => state.doc.shapes[id])
		.filter((shape): shape is Shape => Boolean(shape))
		.map((shape) => ShapeRecord.clone(shape));
	const bindings = Object.values(state.doc.bindings)
		.filter(
			(binding) => includedIds.has(binding.fromShapeId) && includedIds.has(binding.toShapeId)
		)
		.map((binding) => BindingRecord.clone(binding));
	const assetIds = new Set(
		shapes.flatMap((shape) => (shape.type === 'image' ? [shape.props.assetId] : []))
	);
	const assets = [...assetIds]
		.map((id) => state.doc.assets?.[id])
		.filter((asset): asset is ImportedAsset => Boolean(asset))
		.map((asset) => ({ ...asset, bytes: [...asset.bytes] }));
	return { kind: CLIPBOARD_KIND, version: 2, shapes, bindings, rootIds: [...rootIds], assets };
}

/** Result of copying SVG markup to the system clipboard. */
export type SvgClipboardResult = 'rich' | 'text' | 'manual';

/** Result of copying a PNG, including the download fallback. */
export type PngClipboardResult = 'rich' | 'download';

/** Options for rasterizing an SVG export. */
export type PngRenderOptions = { transparentBackground?: boolean };

/**
 * Rasterizes canonical SVG markup without including editor overlays or the canvas grid.
 *
 * The canvas is left transparent when requested. A white background is otherwise
 * painted before the SVG is drawn so clipboard and downloaded PNGs are predictable.
 */
export async function renderSvgToPng(
	svg: string,
	{ transparentBackground = false }: PngRenderOptions = {}
): Promise<Blob> {
	if (!svg) throw new Error('SVG markup must not be empty.');
	if (
		typeof document === 'undefined' ||
		typeof Image === 'undefined' ||
		typeof URL === 'undefined'
	) {
		throw new Error('PNG export is not available in this environment.');
	}

	const image = new Image();
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Could not render the drawing as PNG.'));
			image.src = url;
		});

		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, image.naturalWidth || image.width);
		canvas.height = Math.max(1, image.naturalHeight || image.height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Could not create a PNG rendering context.');
		if (!transparentBackground) {
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, canvas.width, canvas.height);
		}
		context.drawImage(image, 0, 0);

		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) resolve(blob);
				else reject(new Error('Could not encode the drawing as PNG.'));
			}, 'image/png');
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

/**
 * Writes PNG data to the system clipboard and downloads it when image clipboard
 * support is missing or rejected by the platform.
 */
export async function copyPngBlob(blob: Blob, filename: string): Promise<PngClipboardResult> {
	const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
	if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
		try {
			await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			return 'rich';
		} catch {
			// Permission and platform support errors use the file fallback below.
		}
	}

	downloadBlob(blob, filename);
	return 'download';
}

/** Downloads a blob through the browser's normal save flow. */
export function downloadBlob(blob: Blob, filename: string): void {
	if (typeof document === 'undefined' || typeof URL === 'undefined') return;
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Writes SVG markup with both vector and plain-text clipboard representations.
 *
 * Browsers that do not expose rich clipboard writes receive the markup as plain
 * text. When no clipboard API is available, the caller can show the markup for
 * manual copying.
 */
export async function copySvgMarkup(svg: string): Promise<SvgClipboardResult> {
	if (!svg) throw new Error('SVG markup must not be empty.');

	const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
	if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
		try {
			await clipboard.write([
				new ClipboardItem({
					'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }),
					'text/plain': new Blob([svg], { type: 'text/plain' })
				})
			]);
			return 'rich';
		} catch {
			// Permission and support errors can still allow a plain-text write.
		}
	}

	if (clipboard?.writeText) {
		try {
			await clipboard.writeText(svg);
			return 'text';
		} catch {
			// Try the legacy browser path before asking the user to copy manually.
		}
	}

	if (
		typeof document !== 'undefined' &&
		document.body &&
		typeof document.execCommand === 'function'
	) {
		const textarea = document.createElement('textarea');
		textarea.value = svg;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		try {
			textarea.select();
			if (document.execCommand('copy')) return 'text';
		} catch {
			// The visible manual-copy fallback handles browsers that reject this path.
		} finally {
			textarea.remove();
		}
	}

	return 'manual';
}

/** Writes a native selection to the system clipboard when available. */
export async function copySelection(state: EditorState): Promise<boolean> {
	const payload = createClipboardPayload(state);
	if (!payload) return false;
	const text = JSON.stringify(payload);
	fallbackClipboard = text;
	if (typeof navigator === 'undefined' || !navigator.clipboard) return true;
	if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					[CLIPBOARD_MIME]: new Blob([text], { type: CLIPBOARD_MIME }),
					'text/plain': new Blob([text], { type: 'text/plain' })
				})
			]);
		} catch {
			if (navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
		}
	} else if (navigator.clipboard.writeText) {
		await navigator.clipboard.writeText(text);
	}
	return true;
}

/** Reads a native selection from the system clipboard or this editor session. */
export async function readClipboard(): Promise<ClipboardPayload | null> {
	const content = await readClipboardContent();
	return content?.type === 'native' ? content.payload : null;
}

/** Reads and classifies native, text, SVG, and image clipboard content. */
export async function readClipboardContent(data?: DataTransfer): Promise<ClipboardContent | null> {
	if (data) {
		const native = parsePayload(data.getData(CLIPBOARD_MIME) || data.getData('text/plain'));
		if (native) return { type: 'native', payload: native };
		const svg = data.getData('image/svg+xml');
		if (svg.trim()) return { type: 'svg', contents: svg };
		const markdown = data.getData('text/markdown');
		if (markdown) return { type: 'text', text: markdown, markdown: true };
		for (const file of Array.from(data.files ?? [])) {
			if (file.type.startsWith('image/')) return imageContent(file);
		}
		const text = data.getData('text/plain');
		return text ? { type: 'text', text, markdown: false } : null;
	}

	let text = fallbackClipboard;
	if (typeof navigator === 'undefined' || !navigator.clipboard) {
		return text ? nativeContent(text) : null;
	}
	if (navigator.clipboard.read) {
		try {
			const items = await navigator.clipboard.read();
			for (const item of items) {
				if (item.types.includes(CLIPBOARD_MIME)) {
					const blob = await item.getType(CLIPBOARD_MIME);
					const native = parsePayload(await blob.text());
					if (native) return { type: 'native', payload: native };
				}
				const imageType = item.types.find((type) => type.startsWith('image/'));
				if (imageType) return imageContent(await item.getType(imageType), imageType);
				if (item.types.includes('image/svg+xml')) {
					return {
						type: 'svg',
						contents: await (await item.getType('image/svg+xml')).text()
					};
				}
			}
		} catch {
			// Clipboard read permissions are optional; readText below is the fallback.
		}
	}
	if (navigator.clipboard.readText) {
		try {
			text = (await navigator.clipboard.readText()) || fallbackClipboard;
		} catch (error) {
			if (!fallbackClipboard) throw error;
		}
	}
	return text ? nativeContent(text) : null;
}

/** Pastes a native selection while preserving its hierarchy, bindings, and assets. */
export function pasteClipboard(
	state: EditorState,
	payload: ClipboardPayload,
	options: number | PasteOptions = 24
): EditorState {
	const pageId = state.ui.currentPageId;
	if (!pageId) return state;
	const page = state.doc.pages[pageId];
	if (!page || payload.shapes.length === 0) return state;
	const settings = typeof options === 'number' ? { offset: options } : options;
	const delta = pasteDelta(payload.shapes, settings);
	const activeLayerId = state.ui.activeLayerId ?? page.layerIds?.[0];
	const mapping = new Map<string, string>();
	for (const shape of payload.shapes) mapping.set(shape.id, createId('shape'));
	const shapes = { ...state.doc.shapes };
	const pastedIds: string[] = [];
	for (const source of payload.shapes) {
		const id = mapping.get(source.id);
		if (!id) continue;
		const copy = ShapeRecord.clone(source);
		const translated = copy.editorTransform
			? {
					...copy,
					x: copy.x + delta.x,
					y: copy.y + delta.y,
					editorTransform: {
						...copy.editorTransform,
						e: copy.editorTransform.e + delta.x,
						f: copy.editorTransform.f + delta.y
					}
				}
			: { ...copy, x: copy.x + delta.x, y: copy.y + delta.y };
		const parentId = copy.groupId ? mapping.get(copy.groupId) : undefined;
		shapes[id] = {
			...translated,
			id,
			pageId,
			...(parentId ? { groupId: parentId } : { groupId: undefined }),
			...(activeLayerId ? { layerId: activeLayerId } : {})
		};
		if (translated.type === 'text' && translated.props.textPath) {
			const pathId = mapping.get(translated.props.textPath.pathId);
			if (pathId) {
				shapes[id] = {
					...shapes[id],
					props: {
						...translated.props,
						textPath: { ...translated.props.textPath, pathId }
					}
				} as ShapeRecord;
			}
		}
		if (payload.rootIds.includes(source.id)) pastedIds.push(id);
	}
	const bindings = { ...state.doc.bindings };
	const bindingMapping = new Map<string, string>();
	for (const binding of payload.bindings) {
		const fromShapeId = mapping.get(binding.fromShapeId);
		const toShapeId = mapping.get(binding.toShapeId);
		if (!fromShapeId || !toShapeId) continue;
		const id = createId('binding');
		bindingMapping.set(binding.id, id);
		bindings[id] = { ...BindingRecord.clone(binding), id, fromShapeId, toShapeId };
	}
	for (const source of payload.shapes) {
		const id = mapping.get(source.id);
		const pasted = id ? shapes[id] : undefined;
		if (!id || !pasted || pasted.type !== 'arrow' || source.type !== 'arrow') continue;
		const endpoint = (handle: 'start' | 'end') => {
			const sourceBindingId = source.props[handle].bindingId;
			const pastedBindingId = sourceBindingId
				? bindingMapping.get(sourceBindingId)
				: undefined;
			return pastedBindingId
				? { kind: 'bound' as const, bindingId: pastedBindingId }
				: { kind: 'free' as const };
		};
		shapes[id] = {
			...pasted,
			props: { ...pasted.props, start: endpoint('start'), end: endpoint('end') }
		};
	}
	const assets = { ...(state.doc.assets ?? {}) };
	for (const asset of payload.assets ?? [])
		assets[asset.id] = { ...asset, bytes: [...asset.bytes] };
	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	let pages = { ...state.doc.pages };
	const rootMappedIds = payload.rootIds
		.map((id) => mapping.get(id))
		.filter((id): id is string => Boolean(id));
	const copiedIds = payload.shapes
		.map((shape) => mapping.get(shape.id))
		.filter((id): id is string => Boolean(id));
	if (layers && activeLayerId && layers[activeLayerId]) {
		layers[activeLayerId] = {
			...layers[activeLayerId],
			shapeIds: [...layers[activeLayerId].shapeIds, ...copiedIds]
		};
		pages[pageId] = {
			...page,
			shapeIds: page.layerIds?.flatMap((id) => layers[id]?.shapeIds ?? []) ?? page.shapeIds
		};
	} else {
		pages[pageId] = { ...page, shapeIds: [...page.shapeIds, ...copiedIds] };
	}
	return {
		...state,
		doc: { ...state.doc, pages, shapes, bindings, assets, ...(layers ? { layers } : {}) },
		ui: { ...state.ui, selectionIds: pastedIds, toolId: 'select' }
	};
}

/** Inserts ordinary text as a native text or Markdown object. */
export function pasteText(
	state: EditorState,
	text: string,
	markdown: boolean,
	position?: Vec2
): EditorState {
	const pageId = state.ui.currentPageId;
	const page = pageId ? state.doc.pages[pageId] : undefined;
	if (!pageId || !page || !text) return state;
	const point = position ?? { x: 0, y: 0 };
	const shape = markdown
		? ShapeRecord.createMarkdown(pageId, point.x, point.y, {
				md: text,
				w: 320,
				fontSize: 16,
				fontFamily: 'Instrument Sans Variable',
				color: '#1e1e1e'
			})
		: ShapeRecord.createText(pageId, point.x, point.y, {
				text,
				fontSize: 20,
				fontFamily: 'Instrument Sans Variable',
				color: '#1e1e1e',
				w: Math.min(480, Math.max(120, text.split('\n')[0]?.length * 10 || 120))
			});
	return appendShape(state, shape);
}

/** Creates an image object from clipboard or dropped file bytes. */
export async function imageContent(file: Blob, mediaType = file.type): Promise<ClipboardContent> {
	const buffer = await file.arrayBuffer();
	return {
		type: 'image',
		name:
			typeof File !== 'undefined' && file instanceof File && file.name
				? file.name
				: 'Pasted image',
		mediaType: mediaType || 'image/png',
		bytes: [...new Uint8Array(buffer)]
	};
}

/** Inserts an embedded image at a world-space point and preserves its native aspect ratio. */
export async function pasteImage(
	state: EditorState,
	content: { name: string; mediaType: string; bytes: number[] },
	position?: Vec2
): Promise<EditorState> {
	const pageId = state.ui.currentPageId;
	if (!pageId || !state.doc.pages[pageId]) return state;
	const asset = await createImageAsset(content.name, content.mediaType, content.bytes);
	const size = await imageSize(content.mediaType, content.bytes);
	const scale = Math.min(480 / Math.max(size.width, size.height), 1);
	const width = Math.max(1, size.width * scale);
	const height = Math.max(1, size.height * scale);
	const point = position ?? { x: 0, y: 0 };
	const image = ShapeRecord.createImage(pageId, point.x, point.y, {
		w: width,
		h: height,
		assetId: asset.id
	});
	return appendShape(
		{
			...state,
			doc: { ...state.doc, assets: { ...(state.doc.assets ?? {}), [asset.id]: asset } }
		},
		image
	);
}

function appendShape(state: EditorState, shape: Shape): EditorState {
	const page = state.doc.pages[shape.pageId];
	if (!page) return state;
	const layerId = state.ui.activeLayerId ?? page.layerIds?.[0];
	const nextShape = layerId ? { ...shape, layerId } : shape;
	const layers = state.doc.layers ? { ...state.doc.layers } : undefined;
	if (layers && layerId && layers[layerId]) {
		layers[layerId] = {
			...layers[layerId],
			shapeIds: [...layers[layerId].shapeIds, shape.id]
		};
	}
	const pages = {
		...state.doc.pages,
		[shape.pageId]: {
			...page,
			shapeIds:
				layers && page.layerIds
					? page.layerIds.flatMap((id) => layers[id]?.shapeIds ?? [])
					: [...page.shapeIds, shape.id]
		}
	};
	return {
		...state,
		doc: {
			...state.doc,
			pages,
			shapes: { ...state.doc.shapes, [shape.id]: nextShape },
			...(layers ? { layers } : {})
		},
		ui: { ...state.ui, selectionIds: [shape.id], toolId: 'select' }
	};
}

function pasteDelta(shapes: Shape[], options: PasteOptions): Vec2 {
	if (options.inPlace) return { x: 0, y: 0 };
	if (options.position) {
		const bounds = shapes.map(shapeBounds);
		const minX = Math.min(...bounds.map((bound) => bound.min.x));
		const minY = Math.min(...bounds.map((bound) => bound.min.y));
		return { x: options.position.x - minX, y: options.position.y - minY };
	}
	const offset = options.offset ?? 24;
	return { x: offset, y: offset };
}

function hasSelectedAncestor(
	state: EditorState,
	id: string,
	selectedIds: ReadonlySet<string>
): boolean {
	let parentId = state.doc.shapes[id]?.groupId;
	while (parentId) {
		if (selectedIds.has(parentId)) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}

function hasAncestor(shape: Shape, ancestorId: string, state: EditorState): boolean {
	let parentId = shape.groupId;
	while (parentId) {
		if (parentId === ancestorId) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}

function parsePayload(text: string): ClipboardPayload | null {
	try {
		const value = JSON.parse(text) as Partial<ClipboardPayload>;
		if (
			value.kind !== CLIPBOARD_KIND ||
			(value.version !== 1 && value.version !== 2) ||
			!Array.isArray(value.shapes)
		)
			return null;
		return {
			kind: CLIPBOARD_KIND,
			version: value.version,
			shapes: value.shapes as Shape[],
			bindings: Array.isArray(value.bindings) ? (value.bindings as BindingRecord[]) : [],
			rootIds: Array.isArray(value.rootIds) ? value.rootIds : [],
			assets: Array.isArray(value.assets) ? (value.assets as ImportedAsset[]) : []
		};
	} catch {
		return null;
	}
}

function nativeContent(text: string): ClipboardContent | null {
	const native = parsePayload(text);
	if (native) return { type: 'native', payload: native };
	if (/^\s*<svg(?:\s|>)/i.test(text)) return { type: 'svg', contents: text };
	return { type: 'text', text, markdown: false };
}

/** Creates the content-addressed asset record used by pasted and dropped images. */
export async function createImageAsset(
	name: string,
	mediaType: string,
	bytes: number[]
): Promise<ImportedAsset> {
	const digest = await digestBytes(bytes);
	return {
		id: `asset:sha256:${digest}`,
		name: name || 'Pasted image',
		mediaType,
		digest: `sha256:${digest}`,
		bytes: [...bytes]
	};
}

async function digestBytes(bytes: number[]): Promise<string> {
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
		return [...new Uint8Array(digest)]
			.map((value) => value.toString(16).padStart(2, '0'))
			.join('');
	}
	let hash = 2166136261;
	for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
	return (hash >>> 0).toString(16).padStart(8, '0');
}

async function imageSize(
	mediaType: string,
	bytes: number[]
): Promise<{ width: number; height: number }> {
	if (
		typeof Image === 'undefined' ||
		typeof Blob === 'undefined' ||
		typeof URL === 'undefined'
	) {
		return { width: 320, height: 200 };
	}
	const image = new Image();
	const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
	try {
		await new Promise<void>((resolve) => {
			image.onload = () => resolve();
			image.onerror = () => resolve();
			image.src = url;
		});
		return { width: image.naturalWidth || 320, height: image.naturalHeight || 200 };
	} finally {
		URL.revokeObjectURL(url);
	}
}
