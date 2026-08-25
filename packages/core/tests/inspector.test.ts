import { describe, expect, it } from 'vitest';
import {
	EditorPageRecord,
	EditorShapeRecord,
	cardMetadata,
	type EditorShapeRecord as Shape,
	EditorState,
	enterSelectedFrame,
	setSelectedFillPaint,
	setSelectedImageSquareCrop,
	setSelectedTypography
} from '../src';

function stateWithShapes(shapes: Shape[]) {
	const page = EditorPageRecord.create('Inspector test', 'page:inspector');
	const state = EditorState.create();
	state.doc.pages[page.id] = { ...page, shapeIds: shapes.map((shape) => shape.id) };
	for (const shape of shapes) state.doc.shapes[shape.id] = shape;
	state.ui.currentPageId = page.id;
	state.ui.selectionIds = shapes.map((shape) => shape.id);
	return state;
}

describe('selection inspector operations', () => {
	it('updates selected paints and leaves an empty selection untouched', () => {
		const page = EditorPageRecord.create('Inspector test', 'page:inspector');
		const rect = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 20, h: 20, fill: '#fff', stroke: '#000', radius: 0 },
			'rect'
		);
		const state = stateWithShapes([rect]);
		const empty = { ...state, ui: { ...state.ui, selectionIds: [] } };
		expect(setSelectedFillPaint(empty, '#f00')).toBe(empty);
		const next = setSelectedFillPaint(state, '#f00');
		expect(next.doc.shapes.rect?.type === 'rect' ? next.doc.shapes.rect.props.fill : null).toBe('#f00');
	});

	it('updates typography for selected cards and their text children', () => {
		const page = EditorPageRecord.create('Inspector test', 'page:inspector');
		const card = EditorShapeRecord.createContainer(page.id, 0, 0, { w: 100, h: 80, title: 'Title' }, 'card');
		card.metadata = cardMetadata({ title: 'Title', body: '' });
		const title = EditorShapeRecord.createText(
			page.id,
			8,
			8,
			{ text: 'Title', fontSize: 16, fontFamily: 'Inter', color: '#000' },
			'title'
		);
		const state = stateWithShapes([card, title]);
		state.doc.shapes.title = { ...title, groupId: card.id };
		state.ui.selectionIds = [card.id];
		const next = setSelectedTypography(state, 'fontSize', 22);
		expect(next.doc.shapes.title?.type === 'text' ? next.doc.shapes.title.props.fontSize : null).toBe(22);
	});

	it('projects frame entry and square image crop as separate state operations', () => {
		const page = EditorPageRecord.create('Inspector test', 'page:inspector');
		const frame = EditorShapeRecord.createContainer(page.id, 0, 0, { w: 100, h: 80 }, 'frame');
		const entered = enterSelectedFrame(stateWithShapes([frame]), frame.id);
		expect(entered.ui.containerPath).toEqual([frame.id]);
		const image = EditorShapeRecord.createImage(page.id, 0, 0, { w: 200, h: 100, assetId: 'asset' }, 'image');
		const cropped = setSelectedImageSquareCrop(stateWithShapes([image]), true);
		expect(cropped.doc.shapes.image?.type === 'image' ? cropped.doc.shapes.image.props.crop : undefined).toEqual({
			top: 0,
			right: 0.25,
			bottom: 0,
			left: 0.25
		});
	});
});
