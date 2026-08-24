import { describe, expect, it } from 'vitest';
import { LayerRecord, PageRecord, ShapeRecord } from '../model';
import { fromCanonicalDocumentSnapshot, toCanonicalDocumentSnapshot } from './canonical';

describe('canonical editor projection', () => {
	it('traverses imported root containers and retains independently addressable descendants', () => {
		const pageId = 'page:svg';
		const layerId = 'layer:svg';
		const page = PageRecord.create('SVG', pageId);
		const layer = LayerRecord.create(pageId, 'Imported', layerId);
		page.layerIds = [layerId];
		const root = ShapeRecord.createContainer(pageId, 10, 20, { width: 100, height: 80 }, 'shape:svg:root');
		const group = ShapeRecord.createContainer(pageId, 5, 6, { width: 40, height: 30 }, 'shape:svg:group');
		const child = ShapeRecord.createRect(
			pageId,
			2,
			3,
			{ w: 20, h: 10, fill: '#123456', stroke: null, radius: 0 },
			'shape:svg:child'
		);
		root.layerId = layerId;
		group.layerId = layerId;
		group.groupId = root.id;
		child.layerId = layerId;
		child.groupId = group.id;
		page.shapeIds = [root.id, group.id, child.id];
		layer.shapeIds = [root.id, group.id, child.id];
		const document = {
			id: 'document:svg',
			name: 'SVG',
			pages: { [pageId]: page },
			layers: { [layerId]: layer },
			shapes: { [root.id]: root, [group.id]: group, [child.id]: child },
			bindings: {}
		};

		const canonical = toCanonicalDocumentSnapshot(document, { documentId: 'document:svg' });
		expect(canonical.document.layers[layerId].shape_ids).toEqual([root.id]);
		expect(canonical.document.shapes[root.id].child_ids).toEqual([group.id]);
		expect(canonical.document.shapes[group.id].child_ids).toEqual([child.id]);

		const projected = fromCanonicalDocumentSnapshot(canonical);
		expect(projected.layers[layerId].shapeIds).toEqual([root.id, group.id, child.id]);
		expect(projected.pages[pageId].shapeIds).toEqual([root.id, group.id, child.id]);
		expect(projected.shapes[group.id].groupId).toBe(root.id);
		expect(projected.shapes[child.id].groupId).toBe(group.id);

		delete projected.shapes[child.id];
		projected.layers[layerId].shapeIds = projected.layers[layerId].shapeIds.filter((id) => id !== child.id);
		projected.pages[pageId].shapeIds = projected.pages[pageId].shapeIds.filter((id) => id !== child.id);
		const afterDelete = toCanonicalDocumentSnapshot(
			{
				id: 'document:svg',
				name: 'SVG',
				pages: projected.pages,
				layers: projected.layers,
				shapes: projected.shapes,
				bindings: projected.bindings
			},
			{ documentId: 'document:svg' }
		);
		expect(afterDelete.document.shapes[child.id]).toBeUndefined();
	});
});
