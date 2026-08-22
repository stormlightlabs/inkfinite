import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import CommandPalette from '../CommandPalette.svelte';

describe('CommandPalette', () => {
	it('filters commands and executes the selected action', async () => {
		const onSelect = vi.fn();
		const screen = render(CommandPalette, {
			open: true,
			commands: [
				{ id: 'align-left', label: 'Align Left', group: 'Selection' },
				{ id: 'zoom-fit', label: 'Zoom to fit drawing', group: 'Viewport' }
			],
			onSelect
		});

		await expect
			.element(screen.getByRole('dialog', { name: 'Command palette' }))
			.toBeInTheDocument();
		const search = screen.getByRole('searchbox', { name: 'Search commands' });
		await search.fill('zoom');
		await expect
			.element(screen.getByRole('option', { name: /Zoom to fit drawing/ }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('option', { name: /Align Left/ }))
			.not.toBeInTheDocument();
		await screen.getByRole('option', { name: /Zoom to fit drawing/ }).click();

		expect(onSelect).toHaveBeenCalledWith('zoom-fit');
		await expect
			.element(screen.getByRole('dialog', { name: 'Command palette' }))
			.not.toBeInTheDocument();
	});
});
