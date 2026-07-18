import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import IconButton from './IconButton.svelte';

describe('IconButton', () => {
	it('exposes its label and selected state while forwarding actions', async () => {
		const onclick = vi.fn();
		const screen = render(IconButton, {
			label: 'Select',
			name: 'draw',
			selected: true,
			onclick
		});

		const button = screen.getByRole('button', { name: 'Select' });
		await expect.element(button).toHaveAttribute('aria-pressed', 'true');

		await button.click();
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('does not run actions while disabled', async () => {
		const onclick = vi.fn();
		const screen = render(IconButton, {
			disabled: true,
			label: 'Delete',
			name: 'delete',
			onclick
		});

		await expect.element(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
		expect(onclick).not.toHaveBeenCalled();
	});
});
