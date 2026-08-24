import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/native/connector-geometry.json';
import { arrowGeometryForShape, EditorState, PageRecord, ShapeRecord } from '../src';

describe('shared connector geometry fixtures', () => {
	it('resolves the same native path shape used by interactive geometry', () => {
		for (const testCase of fixture.cases) {
			const page = PageRecord.create('Connector fixture', `page:${testCase.name}`);
			const arrow = ShapeRecord.createArrow(
				page.id,
				0,
				0,
				{
					points: testCase.points,
					start: { kind: 'free' },
					end: { kind: 'free' },
					style: { stroke: '#000000', width: 2 },
					routing:
						testCase.routing === 'straight'
							? undefined
							: { kind: testCase.routing as 'curved' | 'orthogonal' }
				},
				`shape:${testCase.name}`
			);
			const state = {
				...EditorState.create(),
				doc: {
					...EditorState.create().doc,
					pages: { [page.id]: { ...page, shapeIds: [arrow.id] } },
					shapes: { [arrow.id]: arrow }
				},
				ui: { ...EditorState.create().ui, currentPageId: page.id }
			};
			const geometry = arrowGeometryForShape(state, arrow);
			expect(geometry).not.toBeNull();
			expect(geometry).toEqual(testCase.expected);
		}
	});
});
