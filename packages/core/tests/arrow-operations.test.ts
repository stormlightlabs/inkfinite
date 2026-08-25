import { describe, expect, it } from 'vitest';
import {
	EditorBindingRecord,
	EditorPageRecord,
	EditorShapeRecord,
	EditorState,
	disconnectSelectedArrowEndpoints,
	getArrowInspectorState,
	setSelectedArrowLabel,
	setSelectedArrowRouting
} from '../src';

describe('arrow inspector operations', () => {
	it('derives mixed values and updates selected routing and labels', () => {
		const page = EditorPageRecord.create('Arrow test', 'page:arrows');
		const first = EditorShapeRecord.createArrow(
			page.id,
			0,
			0,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 40, y: 0 }
				],
				start: { kind: 'free' },
				end: { kind: 'free' },
				style: { stroke: '#000', width: 2 }
			},
			'first'
		);
		const second = EditorShapeRecord.createArrow(
			page.id,
			0,
			20,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 40, y: 0 }
				],
				start: { kind: 'free' },
				end: { kind: 'free' },
				style: { stroke: '#000', width: 4 }
			},
			'second'
		);
		const state = EditorState.create();
		state.doc.pages[page.id] = { ...page, shapeIds: [first.id, second.id] };
		state.doc.shapes[first.id] = first;
		state.doc.shapes[second.id] = second;
		state.ui.currentPageId = page.id;
		state.ui.selectionIds = [first.id, second.id];
		expect(getArrowInspectorState(state).strokeWidth.mixed).toBe(true);
		const routed = setSelectedArrowRouting(state, 'orthogonal');
		const labelled = setSelectedArrowLabel(routed, 'Depends on');
		expect(labelled.doc.shapes.first?.type === 'arrow' ? labelled.doc.shapes.first.props.routing?.kind : null).toBe(
			'orthogonal'
		);
		expect(labelled.doc.shapes.second?.type === 'arrow' ? labelled.doc.shapes.second.props.label?.text : null).toBe(
			'Depends on'
		);
	});

	it('disconnects endpoints and removes their binding', () => {
		const page = EditorPageRecord.create('Arrow test', 'page:arrows');
		const arrow = EditorShapeRecord.createArrow(
			page.id,
			0,
			0,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 40, y: 0 }
				],
				start: { kind: 'bound', bindingId: 'binding:start' },
				end: { kind: 'free' },
				style: { stroke: '#000', width: 2 }
			},
			'arrow'
		);
		const state = EditorState.create();
		state.doc.pages[page.id] = { ...page, shapeIds: [arrow.id] };
		state.doc.shapes[arrow.id] = arrow;
		state.doc.bindings['binding:start'] = EditorBindingRecord.create(
			arrow.id,
			'target',
			'start',
			undefined,
			'binding:start'
		);
		state.ui.currentPageId = page.id;
		state.ui.selectionIds = [arrow.id];
		const next = disconnectSelectedArrowEndpoints(state, 'start');
		expect(next.doc.bindings['binding:start']).toBeUndefined();
		expect(next.doc.shapes.arrow?.type === 'arrow' ? next.doc.shapes.arrow.props.start.kind : null).toBe('free');
	});
});
