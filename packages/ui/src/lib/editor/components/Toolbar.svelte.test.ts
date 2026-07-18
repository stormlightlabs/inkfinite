import { Store } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createBrushStore } from '../status';
import Toolbar from './Toolbar.svelte';

describe('Editor Toolbar', () => {
	it('selects tools and opens the zoom menu through accessible controls', async () => {
		const onToolChange = vi.fn();
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange,
			store: new Store(),
			getViewport: () => ({ width: 1024, height: 768 }),
			brushStore: createBrushStore()
		});

		await screen.getByRole('button', { name: 'Rectangle' }).click();
		expect(onToolChange).toHaveBeenCalledWith('rect');

		(
			screen.getByRole('button', { name: 'Zoom level' }).element() as HTMLButtonElement
		).click();
		await expect
			.element(screen.getByRole('menu', { name: 'Zoom options' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Zoom to 100%' }))
			.toBeInTheDocument();
	});
});
