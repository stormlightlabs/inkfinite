import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import KeyboardShortcuts from '../KeyboardShortcuts.svelte';

describe('KeyboardShortcuts', () => {
	it('filters the searchable shortcut list and closes accessibly', async () => {
		const screen = render(KeyboardShortcuts, { open: true });

		await expect
			.element(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }))
			.toBeInTheDocument();
		const search = screen.getByRole('searchbox', { name: 'Search shortcuts' });
		await search.fill('group');
		await expect.element(screen.getByText(/Editing\s+Group selection/)).toBeInTheDocument();
		await expect.element(screen.getByText('Zoom in / out')).not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Close shortcuts' }).click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }))
			.not.toBeInTheDocument();
	});
});
