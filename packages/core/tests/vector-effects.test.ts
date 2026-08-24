import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera';
import { clipSelection, removeClipFromSelection } from '../src/vector-effects';
import { EditorState } from '../src/reactivity';
import { PageRecord, ShapeRecord } from '../src/model';

describe('vector effects', () => {
	it('turns a selected path into local clip geometry and removes the source', () => {
		const page = PageRecord.create('Page 1', 'page:effects');
		const target = ShapeRecord.createRect(
			page.id,
			100,
			50,
			{ w: 80, h: 60, fill: 'red', stroke: 'none', radius: 0 },
			'shape:target'
		);
		const source = ShapeRecord.createPath(
			page.id,
			110,
			60,
			{
				subpaths: [
					{
						segments: [
							{ type: 'move', to: { x: 0, y: 0 } },
							{ type: 'line', to: { x: 60, y: 0 } },
							{ type: 'line', to: { x: 30, y: 40 } }
						],
						closed: true
					}
				],
				fill_rule: 'nonzero'
			},
			'shape:clip'
		);
		page.shapeIds = [target.id, source.id];
		const state = EditorState.create();
		state.doc = { pages: { [page.id]: page }, shapes: { [target.id]: target, [source.id]: source }, bindings: {} };
		state.ui = { ...state.ui, currentPageId: page.id, selectionIds: [target.id, source.id] };
		state.camera = Camera.create();

		const clipped = clipSelection(state);
		expect(clipped?.doc.shapes[source.id]).toBeUndefined();
		expect(clipped?.doc.shapes[target.id]?.props.clipPath?.subpaths[0]?.segments[0]).toEqual({
			type: 'move',
			to: { x: 10, y: 10 }
		});
		expect(clipped?.ui.selectionIds).toEqual([target.id]);

		const removed = clipped && removeClipFromSelection(clipped);
		expect(removed?.doc.shapes[target.id]?.props.clipPath).toBeUndefined();
	});
});
