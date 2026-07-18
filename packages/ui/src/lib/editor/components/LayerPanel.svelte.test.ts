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

describe('LayerPanel', () => {
	it('provides accessible controls for the complete layer lifecycle', async () => {
		const store = editorStore();
		const screen = render(LayerPanel, {
			store,
			onCommit: (_name, next) => store.setState(() => next)
		});

		await expect
			.element(screen.getByRole('complementary', { name: 'Layers' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Delete Default' }))
			.toBeDisabled();
		await screen.getByRole('button', { name: 'Add layer' }).click();
		await expect.element(screen.getByRole('button', { name: 'Delete Default' })).toBeEnabled();
		await screen.getByRole('button', { name: 'Hide Layer' }).click();
		expect(
			Object.values(store.getState().doc.layers ?? {}).find(
				(layer) => layer.name === 'Layer'
			)?.visible
		).toBe(false);
		await screen.getByRole('button', { name: 'Show Layer' }).click();
		await screen.getByRole('button', { name: 'Lock Layer' }).click();
		expect(
			Object.values(store.getState().doc.layers ?? {}).find(
				(layer) => layer.name === 'Layer'
			)?.locked
		).toBe(true);
	});
});
