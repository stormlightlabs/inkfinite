import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/native/connector-geometry.json';
import {
	arrowBendForPointer,
	arrowBendHandleForShape,
	arrowGeometryForShape,
	EditorState,
	PageRecord,
	ShapeRecord
} from '../src';

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
							: {
									kind: testCase.routing as 'curved' | 'orthogonal',
									...(testCase.bend === undefined ? {} : { bend: testCase.bend }),
									...(testCase.cornerRadius === undefined
										? {}
										: { cornerRadius: testCase.cornerRadius })
								}
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

	it('uses a signed bend with a quadratic zero state at the chord midpoint', () => {
		const page = PageRecord.create('Bend fixture', 'page:bend');
		const arrow = ShapeRecord.createArrow(page.id, 0, 0, {
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 }
			],
			start: { kind: 'free' },
			end: { kind: 'free' },
			style: { stroke: '#000', width: 2 },
			routing: { kind: 'curved', bend: 0 }
		});
		const state = {
			...EditorState.create(),
			doc: {
				...EditorState.create().doc,
				pages: { [page.id]: { ...page, shapeIds: [arrow.id] } },
				shapes: { [arrow.id]: arrow }
			},
			ui: { ...EditorState.create().ui, currentPageId: page.id }
		};

		const handle = arrowBendHandleForShape(state, arrow);
		expect(handle?.position).toEqual({ x: 50, y: 0 });
		expect(arrowBendForPointer(state, arrow, { x: 50, y: 20 })).toBe(20);
		expect(arrowBendForPointer(state, arrow, { x: 50, y: -20 })).toBe(-20);
	});
});
