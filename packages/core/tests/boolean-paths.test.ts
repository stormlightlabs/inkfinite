import { describe, expect, it } from 'vitest';
import { applyBooleanPathOperation, canBooleanPathSelection, PageRecord, ShapeRecord } from '../src';
import type { EditorState } from '../src';

function rectangle(pageId: string, x: number, y: number, size: number, id: string) {
	return ShapeRecord.createPath(
		pageId,
		x,
		y,
		{
			subpaths: [
				{
					segments: [
						{ type: 'move', to: { x: 0, y: 0 } },
						{ type: 'line', to: { x: size, y: 0 } },
						{ type: 'line', to: { x: size, y: size } },
						{ type: 'line', to: { x: 0, y: size } }
					],
					closed: true
				}
			],
			fill_rule: 'evenodd',
			fill: '#fff',
			stroke: '#111'
		},
		id
	);
}

function stateFor(paths: ReturnType<typeof rectangle>[]): EditorState {
	const page = PageRecord.create('Boolean paths', 'page:boolean');
	page.shapeIds = paths.map((path) => path.id);
	return {
		doc: {
			pages: { [page.id]: page },
			shapes: Object.fromEntries(paths.map((path) => [path.id, path])),
			bindings: {}
		},
		ui: { currentPageId: page.id, selectionIds: paths.map((path) => path.id), toolId: 'select' },
		camera: { x: 0, y: 0, zoom: 1 }
	};
}

describe('boolean path editing', () => {
	it('unions overlapping paths and keeps the first transform and identity', () => {
		const first = rectangle('page:boolean', 100, 40, 10, 'path:first');
		const second = rectangle('page:boolean', 105, 40, 10, 'path:second');
		const state = stateFor([first, second]);
		const result = applyBooleanPathOperation(state, state.ui.selectionIds, 'union');

		expect(result?.ui.selectionIds).toEqual(['path:first']);
		expect(result?.doc.shapes['path:second']).toBeUndefined();
		const merged = result?.doc.shapes['path:first'];
		expect(merged).toMatchObject({ x: 100, y: 40 });
		if (merged?.type !== 'path') throw new Error('Expected a merged path');
		expect(merged.props.subpaths).toHaveLength(1);
		expect(merged.props.subpaths[0]?.segments).toHaveLength(4);
	});

	it('supports nested subtraction and rejects open paths', () => {
		const outer = rectangle('page:boolean', 0, 0, 20, 'path:outer');
		const inner = rectangle('page:boolean', 5, 5, 10, 'path:inner');
		const state = stateFor([outer, inner]);
		const result = applyBooleanPathOperation(state, state.ui.selectionIds, 'difference');

		const merged = result?.doc.shapes['path:outer'];
		if (merged?.type !== 'path') throw new Error('Expected a merged path');
		expect(merged.props.subpaths).toHaveLength(2);
		const open = {
			...inner,
			props: { ...inner.props, subpaths: [{ ...inner.props.subpaths[0]!, closed: false }] }
		};
		const openState = stateFor([outer, open]);
		expect(canBooleanPathSelection(openState)).toBe(false);
		expect(applyBooleanPathOperation(openState, openState.ui.selectionIds, 'union')).toBeNull();
	});
});
