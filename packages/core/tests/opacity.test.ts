import { EditorDocument, EditorPageRecord, EditorShapeRecord, validateDoc } from '../src/editor-model';
import { describe, expect, it } from 'vitest';

describe('shape opacity', () => {
	it('accepts finite values from zero to one and rejects values outside the range', () => {
		const doc = EditorDocument.create();
		const page = EditorPageRecord.create('Page', 'page');
		const shape = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 10, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
			'shape'
		);
		page.shapeIds = [shape.id];
		doc.pages[page.id] = page;
		doc.shapes[shape.id] = { ...shape, fillOpacity: 0, strokeOpacity: 0.5, opacity: 1 };
		expect(validateDoc(doc)).toEqual({ ok: true });

		doc.shapes[shape.id] = { ...shape, fillOpacity: 1.01 };
		expect(validateDoc(doc)).toEqual({
			ok: false,
			errors: ["Shape 'shape' has invalid fill opacity"]
		});
	});
});
