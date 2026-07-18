import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import Sheet from './Sheet.svelte';

describe('Sheet', () => {
	it.each(['left', 'right', 'top', 'bottom'] as const)(
		'renders an accessible %s-side modal',
		async (side) => {
			const screen = render(Sheet, { open: true, side, title: 'Layers' });

			const sheet = screen.getByRole('dialog', { name: 'Layers' });
			await expect.element(sheet).toHaveAttribute('aria-modal', 'true');
			await expect.element(sheet).toHaveClass(`sheet-${side}`);
			await expect.element(sheet).toHaveFocus();
		}
	);

	it('defaults to the right side', async () => {
		const screen = render(Sheet, { open: true, title: 'History' });
		await expect.element(screen.getByRole('dialog')).toHaveClass('sheet-right');
	});

	it('closes from the backdrop and Escape key', async () => {
		const onClose = vi.fn();
		let screen = render(Sheet, { open: true, onClose, title: 'First sheet' });

		screen
			.getByRole('presentation')
			.element()
			.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onClose).toHaveBeenCalledOnce();

		screen = render(Sheet, { open: true, onClose, title: 'Second sheet' });
		await expect.element(screen.getByRole('dialog')).toHaveFocus();
		await userEvent.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
