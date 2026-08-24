import { describe, expect, it } from 'vitest';
import { LayerRecord, PageRecord, ShapeRecord } from '../model';
import { fromCanonicalDocumentSnapshot, fromEditorProjection, toCanonicalDocumentSnapshot } from './canonical';
import type { EditorProjection } from '@inkfinite/bindings/editor';

describe('canonical editor projection', () => {
	it('normalizes native property names from the Rust editor projection', () => {
		const projection = {
			pages: {
				'page:one': { id: 'page:one', name: 'Page 1', shape_ids: ['shape:markdown'], layer_ids: ['layer:one'] }
			},
			layers: {
				'layer:one': {
					id: 'layer:one',
					page_id: 'page:one',
					name: 'Default',
					shape_ids: ['shape:markdown'],
					visible: true,
					locked: false,
					opacity: 1
				}
			},
			shapes: {
				'shape:markdown': {
					id: 'shape:markdown',
					type: 'markdown',
					page_id: 'page:one',
					transform: { a: 1, b: 0, c: 0, d: 1, e: 20, f: 30 },
					x: 20,
					y: 30,
					rot: 0,
					group_id: null,
					layer_id: 'layer:one',
					opacity: 1,
					fill_opacity: null,
					stroke_opacity: null,
					locked: false,
					agent_editable: true,
					metadata: {
						name: null,
						title: null,
						role: null,
						description: null,
						body: null,
						tags: [],
						source: null,
						link: null,
						custom_metadata: {},
						locked: false,
						agent_editable: true,
						provenance: { actor_id: 'actor:test', origin: 'system', timestamp: 0, source: null }
					},
					props: {
						width: 320,
						height: 180,
						markdown: '# Notes',
						background: '#ffffff',
						font_size: 16,
						font_family: 'sans-serif'
					}
				}
			},
			bindings: {},
			order: { page_ids: ['page:one'], shape_order: { 'page:one': ['shape:markdown'] }, layers: {} }
		} as unknown as EditorProjection;

		const projected = fromEditorProjection(projection);
		expect(projected.shapes['shape:markdown'].props).toMatchObject({
			w: 320,
			h: 180,
			md: '# Notes',
			bg: '#ffffff',
			fontSize: 16,
			fontFamily: 'sans-serif'
		});
	});

	it('traverses imported root containers and retains independently addressable descendants', () => {
		const pageId = 'page:svg';
		const layerId = 'layer:svg';
		const page = PageRecord.create('SVG', pageId);
		const layer = LayerRecord.create(pageId, 'Imported', layerId);
		page.layerIds = [layerId];
		const root = ShapeRecord.createContainer(pageId, 10, 20, { w: 100, h: 80 }, 'shape:svg:root');
		const group = ShapeRecord.createContainer(pageId, 5, 6, { w: 40, h: 30 }, 'shape:svg:group');
		const child = ShapeRecord.createRect(
			pageId,
			2,
			3,
			{ w: 20, h: 10, fill: '#123456', stroke: 'none', radius: 0 },
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
		if (!projected.layers) throw new Error('Expected projected layers');
		expect(projected.layers[layerId].shapeIds).toEqual([root.id, group.id, child.id]);
		expect(projected.pages[pageId].shapeIds).toEqual([root.id, group.id, child.id]);
		expect(projected.shapes[group.id].groupId).toBe(root.id);
		expect(projected.shapes[child.id].groupId).toBe(group.id);

		delete projected.shapes[child.id];
		projected.layers[layerId].shapeIds = projected.layers[layerId].shapeIds.filter((id) => id !== child.id);
		projected.pages[pageId].shapeIds = projected.pages[pageId].shapeIds.filter((id) => id !== child.id);
		const afterDelete = toCanonicalDocumentSnapshot(
			{
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
