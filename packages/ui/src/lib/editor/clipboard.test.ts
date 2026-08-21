import { describe, expect, it } from 'vitest';
import {
	BindingRecord,
	LayerRecord,
	PageRecord,
	ShapeRecord,
	type EditorState
} from '@inkfinite/core';
import { createClipboardPayload, pasteClipboard, pasteText } from './clipboard';

function state(): EditorState {
	const page = PageRecord.create('Page 1', 'page:test');
	const layer = LayerRecord.create(page.id, 'Default', 'layer:test');
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
	it('keeps hierarchy, assets, bindings, and root selection on paste', () => {
		const before = state();
		const pageId = before.ui.currentPageId!;
		const group = ShapeRecord.createContainer(
			pageId,
			10,
			20,
			{ w: 100, h: 80 },
			'shape:group'
		);
		const image = ShapeRecord.createImage(
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
		const target = ShapeRecord.createRect(
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
		const binding = BindingRecord.create(
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
