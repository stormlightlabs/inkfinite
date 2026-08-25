import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	EditorBindingRecord,
	EditorLayerRecord,
	EditorPageRecord,
	EditorShapeRecord,
	type EditorState
} from '@inkfinite/core';
import {
	copyPngBlob,
	copySvgMarkup,
	createClipboardPayload,
	pasteClipboard,
	pasteText
} from '../clipboard';

function state(): EditorState {
	const page = EditorPageRecord.create('Page 1', 'page:test');
	const layer = EditorLayerRecord.create(page.id, 'Default', 'layer:test');
	page.layerIds = [layer.id];
	return {
		doc: {
			pages: { [page.id]: page },
			layers: { [layer.id]: layer },
			shapes: {},
			bindings: {},
			assets: {
				'asset:test': {
					id: 'asset:test',
					name: 'pixel.png',
					mediaType: 'image/png',
					digest: 'sha256:test',
					bytes: [1, 2, 3]
				}
			}
		},
		ui: {
			currentPageId: page.id,
			activeLayerId: layer.id,
			selectionIds: [],
			toolId: 'select'
		},
		camera: { x: 0, y: 0, zoom: 1 }
	};
}

describe('clipboard selections', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('writes SVG as rich clipboard data for vector tools and text editors', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		class TestClipboardItem {
			constructor(readonly data: Record<string, Blob>) {}
		}
		vi.stubGlobal('navigator', { clipboard: { write } });
		vi.stubGlobal('ClipboardItem', TestClipboardItem);

		const result = await copySvgMarkup('<svg><rect /></svg>');

		expect(result).toBe('rich');
		expect(write).toHaveBeenCalledOnce();
		const item = write.mock.calls[0][0][0] as TestClipboardItem;
		expect(Object.keys(item.data)).toEqual(['image/svg+xml', 'text/plain']);
		expect(await item.data['image/svg+xml'].text()).toContain('<rect');
		expect(await item.data['text/plain'].text()).toContain('<rect');
	});

	it('reports the plain-text fallback when rich clipboard writes are unavailable', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		vi.stubGlobal('ClipboardItem', undefined);

		const result = await copySvgMarkup('<svg />');

		expect(result).toBe('text');
		expect(writeText).toHaveBeenCalledWith('<svg />');
	});

	it('returns a manual-copy result when no clipboard API is available', async () => {
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('ClipboardItem', undefined);

		expect(await copySvgMarkup('<svg />')).toBe('manual');
	});

	it('writes PNG data as an image clipboard item', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		class TestClipboardItem {
			constructor(readonly data: Record<string, Blob>) {}
		}
		vi.stubGlobal('navigator', { clipboard: { write } });
		vi.stubGlobal('ClipboardItem', TestClipboardItem);

		const result = await copyPngBlob(
			new Blob(['png'], { type: 'image/png' }),
			'selection.png'
		);

		expect(result).toBe('rich');
		expect(write).toHaveBeenCalledOnce();
		const item = write.mock.calls[0][0][0] as TestClipboardItem;
		expect(Object.keys(item.data)).toEqual(['image/png']);
		expect(item.data['image/png'].type).toBe('image/png');
	});

	it('downloads PNG data when image clipboard writes are unavailable', async () => {
		const click = vi.fn();
		const remove = vi.fn();
		const anchor = { href: '', download: '', hidden: false, click, remove };
		const append = vi.fn();
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('ClipboardItem', undefined);
		vi.stubGlobal('document', {
			body: { appendChild: append },
			createElement: vi.fn(() => anchor)
		});
		vi.stubGlobal('URL', {
			createObjectURL: vi.fn(() => 'blob:test'),
			revokeObjectURL: vi.fn()
		});

		const result = await copyPngBlob(new Blob(['png'], { type: 'image/png' }), 'drawing.png');

		expect(result).toBe('download');
		expect(anchor.download).toBe('drawing.png');
		expect(click).toHaveBeenCalledOnce();
		expect(append).toHaveBeenCalledWith(anchor);
		expect(remove).toHaveBeenCalledOnce();
	});

	it('keeps hierarchy, assets, bindings, and root selection on paste', () => {
		const before = state();
		const pageId = before.ui.currentPageId!;
		const group = EditorShapeRecord.createContainer(
			pageId,
			10,
			20,
			{ w: 100, h: 80 },
			'shape:group'
		);
		const image = EditorShapeRecord.createImage(
			pageId,
			20,
			30,
			{ w: 40, h: 20, assetId: 'asset:test' },
			'shape:image'
		);
		group.layerId = image.layerId = 'layer:test';
		image.groupId = group.id;
		before.doc.shapes[group.id] = group;
		before.doc.shapes[image.id] = image;
		before.doc.pages[pageId].shapeIds = [group.id, image.id];
		before.doc.layers!['layer:test'].shapeIds = [group.id];
		const target = EditorShapeRecord.createRect(
			pageId,
			200,
			0,
			{ w: 20, h: 20, fill: '', stroke: '', radius: 0 },
			'shape:target'
		);
		target.layerId = 'layer:test';
		before.doc.shapes[target.id] = target;
		before.doc.pages[pageId].shapeIds.push(target.id);
		before.doc.layers!['layer:test'].shapeIds.push(target.id);
		const binding = EditorBindingRecord.create(
			'shape:target',
			'shape:group',
			'end',
			undefined,
			'binding:test'
		);
		before.doc.bindings[binding.id] = binding;
		before.ui.selectionIds = [group.id, target.id];

		const payload = createClipboardPayload(before)!;
		expect(payload.rootIds).toEqual([group.id, target.id]);
		expect(payload.assets).toHaveLength(1);
		const pasted = pasteClipboard(before, payload, { inPlace: true });
		expect(pasted.ui.selectionIds).toHaveLength(2);
		const pastedGroup = pasted.doc.shapes[pasted.ui.selectionIds[0]];
		expect(pastedGroup.type).toBe('container');
		const pastedChild = Object.values(pasted.doc.shapes).find(
			(shape) => shape.groupId === pastedGroup.id
		);
		expect(pastedChild?.type).toBe('image');
		expect(Object.keys(pasted.doc.bindings)).toHaveLength(2);
	});

	it('inserts plain text as an editable text object', () => {
		const next = pasteText(state(), 'hello', false, { x: 40, y: 50 });
		const shape = Object.values(next.doc.shapes)[0];
		expect(shape.type).toBe('text');
		expect(shape.x).toBe(40);
		expect(shape.y).toBe(50);
	});
});
