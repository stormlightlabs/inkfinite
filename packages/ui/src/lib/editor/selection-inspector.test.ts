import { describe, expect, it } from 'vitest';
import { EditorPageRecord, EditorShapeRecord, EditorState } from '@inkfinite/core';
import { getSelectionInspectorState } from './selection-inspector';

describe('selection inspector model', () => {
	it('derives shared and mixed appearance values', () => {
		const page = EditorPageRecord.create('Inspector test', 'page:inspector');
		const first = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 20, h: 20, fill: '#fff', stroke: '#000', radius: 0 },
			'first'
		);
		const second = EditorShapeRecord.createRect(
			page.id,
			30,
			0,
			{ w: 20, h: 20, fill: '#000', stroke: '#000', radius: 0 },
			'second'
		);
		const state = EditorState.create();
		state.doc.pages[page.id] = { ...page, shapeIds: [first.id, second.id] };
		state.doc.shapes[first.id] = first;
		state.doc.shapes[second.id] = second;
		state.ui.currentPageId = page.id;
		state.ui.selectionIds = [first.id, second.id];
		const model = getSelectionInspectorState(state);
		expect(model.selectionCount).toBe(2);
		expect(model.fillColorState.mixed).toBe(true);
		expect(model.strokeColorState.value).toBe('#000');
		expect(model.allSelectedLocked).toBe(false);
	});
});
