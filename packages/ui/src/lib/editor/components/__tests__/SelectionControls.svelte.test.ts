import {
	EditorState,
	PageRecord,
	ShapeRecord,
	Store,
	type ShapeRecord as Shape
} from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import SelectionControls from '../SelectionControls.svelte';

function createSelectionStore(shapes: Shape[], selectionIds = shapes.map((shape) => shape.id)) {
	const state = EditorState.create();
	const page = PageRecord.create('Test page', 'page:test');
	state.doc.pages[page.id] = { ...page, shapeIds: shapes.map((shape) => shape.id) };
	for (const shape of shapes) state.doc.shapes[shape.id] = shape;
	state.ui.currentPageId = page.id;
	state.ui.selectionIds = selectionIds;
	return new Store(state);
}

describe('SelectionControls', () => {
	it('shows only appearance controls for a selected rectangle', async () => {
		const page = PageRecord.create('Test page', 'page:test');
		const rect = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 80, h: 50, fill: '#ffffff', stroke: '#111111', radius: 4 },
			'rect'
		);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store: createSelectionStore([rect])
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Appearance' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('heading', { name: 'Typography' }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Arrow settings' }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Align' }))
			.not.toBeInTheDocument();
	});

	it('shows focused typography controls for text and Markdown selections', async () => {
		const page = PageRecord.create('Test page', 'page:test');
		const text = ShapeRecord.createText(
			page.id,
			0,
			0,
			{ text: 'Title', fontSize: 24, fontFamily: 'Inter', color: '#111111' },
			'text'
		);
		const markdown = ShapeRecord.createMarkdown(
			page.id,
			0,
			50,
			{ md: '**Body**', w: 200, fontSize: 16, fontFamily: 'Inter', color: '#222222' },
			'markdown'
		);
		const store = createSelectionStore([text, markdown]);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Typography' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('textbox', { name: 'Font family' }))
			.toHaveValue('Inter');
		await expect
			.element(screen.getByRole('spinbutton', { name: 'Font size' }))
			.toHaveAttribute('placeholder', 'Mixed');

		const size = screen
			.getByRole('spinbutton', { name: 'Font size' })
			.element() as HTMLInputElement;
		size.value = '18';
		size.dispatchEvent(new Event('change', { bubbles: true }));
		const updatedText = store.getState().doc.shapes.text;
		const updatedMarkdown = store.getState().doc.shapes.markdown;
		if (updatedText.type !== 'text' || updatedMarkdown.type !== 'markdown') {
			throw new Error('Expected text and Markdown selections');
		}
		expect(updatedText.props.fontSize).toBe(18);
		expect(updatedMarkdown.props.fontSize).toBe(18);
	});

	it('shows mixed values and multi-selection layout actions', async () => {
		const page = PageRecord.create('Test page', 'page:test');
		const first = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 40, h: 40, fill: '#ffffff', stroke: '#111111', radius: 0 },
			'first'
		);
		const second = ShapeRecord.createRect(
			page.id,
			60,
			0,
			{ w: 40, h: 40, fill: '#000000', stroke: '#111111', radius: 0 },
			'second'
		);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store: createSelectionStore([first, second])
		});

		await expect
			.element(screen.getByRole('button', { name: 'Fill color, mixed values' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Align' })).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Arrange' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Group selected objects' }))
			.toBeInTheDocument();

		await screen.getByRole('button', { name: 'Align' }).click();
		await expect
			.element(screen.getByRole('menu', { name: 'Alignment commands' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Align Left' }))
			.toBeInTheDocument();
		await screen.getByRole('menuitem', { name: 'Align Left' }).click();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Align' }).element()
		);
	});

	it('keeps agent controls opt-in for desktop callers', async () => {
		const page = PageRecord.create('Test page', 'page:test');
		const rect = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 20, h: 20, fill: '#fff', stroke: '#000', radius: 0 },
			'rect'
		);
		const store = createSelectionStore([rect]);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store,
			showAgentControl: true
		});

		await expect
			.element(screen.getByRole('checkbox', { name: 'Agent editable' }))
			.toBeChecked();
		await screen.getByRole('checkbox', { name: 'Agent editable' }).click();
		expect(store.getState().doc.shapes.rect.agentEditable).toBe(false);
	});
});
