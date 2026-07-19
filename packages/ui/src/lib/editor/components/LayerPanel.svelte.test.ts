import { EditorState, ShapeRecord, Store } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import LayerPanel from './LayerPanel.svelte';

function editorStore() {
	const state = EditorState.create();
	state.doc.pages.page = { id: 'page', name: 'Page', shapeIds: ['shape'] };
	state.doc.shapes.shape = ShapeRecord.createRect(
		'page',
		0,
		0,
		{ w: 10, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
		'shape'
	);
	state.ui.currentPageId = 'page';
	return new Store(state);
}

function renderPanel(store = editorStore()) {
	return {
		store,
		screen: render(LayerPanel, {
			store,
			onCommit: (_name, next) => store.setState(() => next)
		})
	};
}

describe('LayerPanel', () => {
	it('provides compact accessible controls for visibility, locking, and activation', async () => {
		const { screen, store } = renderPanel();

		await expect
			.element(screen.getByRole('complementary', { name: 'Layers' }))
			.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Add layer' }).click();
		expect(Object.keys(store.getState().doc.layers ?? {})).toHaveLength(2);
		expect(store.getState().doc.layers?.[store.getState().ui.activeLayerId!].name).toBe(
			'Layer'
		);

		await screen.getByRole('button', { name: 'Hide Layer' }).click();
		expect(
			Object.values(store.getState().doc.layers ?? {}).find(
				(layer) => layer.name === 'Layer'
			)?.visible
		).toBe(false);
		expect(store.getState().doc.layers?.[store.getState().ui.activeLayerId!].name).toBe(
			'Default'
		);
		await screen.getByRole('button', { name: 'Show Layer' }).click();
		await screen.getByRole('button', { name: 'Lock Layer' }).click();
		expect(
			Object.values(store.getState().doc.layers ?? {}).find(
				(layer) => layer.name === 'Layer'
			)?.locked
		).toBe(true);
	});

	it('opens the layer context menu and supports inline rename', async () => {
		const { screen, store } = renderPanel();
		await screen.getByRole('button', { name: 'Add layer' }).click();
		await screen.getByRole('button', { name: 'More actions for Layer' }).click();
		await expect
			.element(screen.getByRole('menu', { name: 'Actions for Layer' }))
			.toBeInTheDocument();
		await screen.getByRole('menuitem', { name: 'Rename layer' }).click();

		const input = screen.getByLabelText('Name for Layer').element() as HTMLInputElement;
		input.value = 'Notes';
		input.dispatchEvent(new Event('change', { bubbles: true }));
		input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(
			Object.values(store.getState().doc.layers ?? {}).some(
				(layer) => layer.name === 'Notes'
			)
		).toBe(true);
	});

	it('collapses to a small toolbar and restores the layer list', async () => {
		const { screen } = renderPanel();
		await screen.getByRole('button', { name: 'Collapse layers' }).click();
		await expect.element(screen.getByRole('heading', { name: 'Layers' })).toBeInTheDocument();
		const panel = screen.getByRole('complementary', { name: 'Layers' }).element();
		expect(panel.querySelector('.layer-panel__title svg')).toBeNull();
		await expect
			.element(screen.getByRole('list', { name: 'Page layers' }))
			.not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Expand layers' }).click();
		await expect
			.element(screen.getByRole('list', { name: 'Page layers' }))
			.toBeInTheDocument();
	});
});
