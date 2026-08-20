import { describe, expect, it } from 'vitest';
import { toCanonicalDocumentSnapshot } from '../src/persistence/canonical';
import { PageRecord, ShapeRecord } from '../src/model';

describe('toCanonicalDocumentSnapshot', () => {
	it('projects browser shapes into the canonical renderer input', () => {
		const page = PageRecord.create('Page 1', 'page:one');
		const rect = ShapeRecord.createRect(
			page.id,
			10,
			20,
			{ w: 40, h: 20, fill: 'red', stroke: 'none', radius: 4 },
			'shape:rect'
		);
		page.shapeIds.push(rect.id);

		const snapshot = toCanonicalDocumentSnapshot(
			{
				board: { id: 'board:one', name: 'Board', createdAt: 0, updatedAt: 0 },
				doc: { pages: { [page.id]: page }, shapes: { [rect.id]: rect }, bindings: {} },
				order: { pageIds: [page.id] }
			},
			{ documentId: 'document:one' }
		);

		expect(snapshot.format).toBe('inkfinite.document');
		expect(snapshot.document.page_ids).toEqual(['page:one']);
		expect(snapshot.document.layers['layer:page:one:default'].shape_ids).toEqual(['shape:rect']);
		expect(snapshot.document.shapes['shape:rect']).toMatchObject({
			kind: 'rect',
			parent: { kind: 'layer', id: 'layer:page:one:default' },
			transform: { translation: { x: 10, y: 20 }, rotation: 0 },
			properties: { w: 40, h: 20, fill: 'red' }
		});
	});
});
