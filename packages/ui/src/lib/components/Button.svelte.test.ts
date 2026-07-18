import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import Button from './Button.svelte';

describe('Button', () => {
	it('runs its action from the accessible button', async () => {
		const onclick = vi.fn();
		const screen = render(Button, { label: 'Save drawing', onclick });

		await screen.getByRole('button', { name: 'Save drawing' }).click();

		expect(onclick).toHaveBeenCalledOnce();
	});

	it('prevents actions while busy', async () => {
		const onclick = vi.fn();
		const screen = render(Button, { busy: true, label: 'Saving', onclick });

		const button = screen.getByRole('button', { name: 'Saving' });
		await expect.element(button).toBeDisabled();
		await expect.element(button).toHaveAttribute('aria-busy', 'true');
		expect(onclick).not.toHaveBeenCalled();
	});
});
