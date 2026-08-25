import { describe, expect, it } from 'vitest';
import { Action } from '../src/actions';
import {
	arrowGeometryForShape,
	EditorBindingRecord,
	EditorState,
	SnapshotCommand,
	EditorPageRecord,
	SelectTool,
	EditorShapeRecord,
	Store
} from '../src';

function pointerMove(world: { x: number; y: number }) {
	return Action.pointerMove(
		{ x: 0, y: 0 },
		world,
		{ left: true, middle: false, right: false },
		{ ctrl: false, shift: false, alt: false, meta: false },
		100
	);
}

function pointerUp(world: { x: number; y: number }) {
	return Action.pointerUp(
		{ x: 0, y: 0 },
		world,
		0,
		{ left: false, middle: false, right: false },
		{ ctrl: false, shift: false, alt: false, meta: false },
		200
	);
}

describe('curved arrow bend editing', () => {
	it('stores bend state through the direct manipulation handle', () => {
		const page = EditorPageRecord.create('Curved arrows', 'page:curved');
		const arrow = EditorShapeRecord.createArrow(
			page.id,
			100,
			100,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 100, y: 0 }
				],
				start: { kind: 'free' },
				end: { kind: 'free' },
				style: { stroke: '#000', width: 2 },
				routing: { kind: 'curved', bend: 0 }
			},
			'arrow:curved'
		);
		let state: EditorState = {
			...EditorState.create(),
			doc: {
				...EditorState.create().doc,
				pages: { [page.id]: { ...page, shapeIds: [arrow.id] } },
				shapes: { [arrow.id]: arrow }
			},
			ui: { ...EditorState.create().ui, currentPageId: page.id, selectionIds: [arrow.id] }
		};
		const tool = new SelectTool();
		tool.onEnter(state);

		state = tool.onAction(
			state,
			Action.pointerDown(
				{ x: 0, y: 0 },
				{ x: 150, y: 100 },
				0,
				{ left: true, middle: false, right: false },
				{ ctrl: false, shift: false, alt: false, meta: false },
				0
			)
		);
		state = tool.onAction(state, pointerMove({ x: 150, y: 120 }));
		state = tool.onAction(state, pointerUp({ x: 150, y: 120 }));

		const updated = state.doc.shapes[arrow.id];
		expect(updated.type).toBe('arrow');
		if (updated.type !== 'arrow') return;
		expect(updated.props.routing).toMatchObject({ kind: 'curved', bend: 20 });
		expect(updated.props.points).toEqual([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 }
		]);
	});

	it('keeps bound endpoints resolved while the bend changes', () => {
		const page = EditorPageRecord.create('Bound curve', 'page:bound-curve');
		const target = EditorShapeRecord.createRect(
			page.id,
			200,
			-25,
			{ w: 50, h: 50, fill: '#fff', stroke: '#000', radius: 0 },
			'rect:target'
		);
		const arrow = EditorShapeRecord.createArrow(
			page.id,
			0,
			0,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 200, y: 0 }
				],
				start: { kind: 'free' },
				end: { kind: 'bound', bindingId: 'binding:end' },
				style: { stroke: '#000', width: 2 },
				routing: { kind: 'curved', bend: 0 }
			},
			'arrow:bound-curve'
		);
		const binding = EditorBindingRecord.create(
			arrow.id,
			target.id,
			'end',
			{ kind: 'edge', nx: -1, ny: 0 },
			'binding:end'
		);
		let state: EditorState = {
			...EditorState.create(),
			doc: {
				...EditorState.create().doc,
				pages: { [page.id]: { ...page, shapeIds: [arrow.id, target.id] } },
				shapes: { [arrow.id]: arrow, [target.id]: target },
				bindings: { [binding.id]: binding }
			},
			ui: { ...EditorState.create().ui, currentPageId: page.id, selectionIds: [arrow.id] }
		};
		const tool = new SelectTool();
		tool.onEnter(state);

		state = tool.onAction(
			state,
			Action.pointerDown(
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				0,
				{ left: true, middle: false, right: false },
				{ ctrl: false, shift: false, alt: false, meta: false },
				0
			)
		);
		state = tool.onAction(state, pointerMove({ x: 100, y: 20 }));
		state = tool.onAction(state, pointerUp({ x: 100, y: 20 }));

		const updated = state.doc.shapes[arrow.id];
		expect(updated.type).toBe('arrow');
		if (updated.type !== 'arrow') return;
		expect(updated.props.points).toEqual(arrow.props.points);
		expect(updated.props.end).toEqual(arrow.props.end);
		expect(state.doc.bindings[binding.id]).toEqual(binding);
		const geometry = arrowGeometryForShape(state, updated);
		expect(geometry?.waypoints.at(-1)).toEqual({ x: 198, y: 0 });
		expect(geometry?.path.subpaths[0]?.segments[1]).toMatchObject({ type: 'quadratic', to: { x: 198, y: 0 } });
	});

	it('round-trips curved routing through history and document serialization', () => {
		const page = EditorPageRecord.create('History curve', 'page:history-curve');
		const arrow = EditorShapeRecord.createArrow(
			page.id,
			0,
			0,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 100, y: 0 }
				],
				start: { kind: 'free' },
				end: { kind: 'free' },
				style: { stroke: '#000', width: 2 },
				routing: { kind: 'curved', bend: 24 }
			},
			'arrow:history-curve'
		);
		const initial: EditorState = {
			...EditorState.create(),
			doc: {
				...EditorState.create().doc,
				pages: { [page.id]: { ...page, shapeIds: [arrow.id] } },
				shapes: { [arrow.id]: arrow }
			},
			ui: { ...EditorState.create().ui, currentPageId: page.id }
		};
		const store = new Store(initial);
		const before = store.getState();
		const after: EditorState = {
			...before,
			doc: {
				...before.doc,
				shapes: {
					...before.doc.shapes,
					[arrow.id]: { ...arrow, props: { ...arrow.props, routing: { kind: 'curved', bend: -24 } } }
				}
			}
		};
		store.executeCommand(new SnapshotCommand('Bend curved arrow', 'doc', before, after));
		const committed = store.getState();
		expect(committed.doc.shapes[arrow.id]).toMatchObject({ props: { routing: { kind: 'curved', bend: -24 } } });
		expect(store.undo()).toBe(true);
		expect(store.getState().doc.shapes[arrow.id]).toEqual(before.doc.shapes[arrow.id]);
		expect(store.redo()).toBe(true);
		expect(store.getState().doc.shapes[arrow.id]).toEqual(committed.doc.shapes[arrow.id]);

		const reopened = JSON.parse(JSON.stringify(store.getState().doc));
		expect(reopened.shapes[arrow.id].props.routing).toEqual({ kind: 'curved', bend: -24 });
	});
});
