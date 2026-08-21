import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import Dialog from '../Dialog.svelte';

describe('Dialog', () => {
	it('renders an accessible modal only while open', async () => {
		const screen = render(Dialog, { open: false, title: 'About Inkfinite' });
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();

		await screen.rerender({ open: true, title: 'About Inkfinite' });

		const dialog = screen.getByRole('dialog', { name: 'About Inkfinite' });
		await expect.element(dialog).toHaveAttribute('aria-modal', 'true');
		await expect.element(dialog).toHaveFocus();
	});

	it('closes from the backdrop and Escape key when enabled', async () => {
		const onClose = vi.fn();
		let screen = render(Dialog, { open: true, onClose, title: 'Test dialog' });

		await screen.getByRole('presentation').click();
		expect(onClose).toHaveBeenCalledOnce();

		screen = render(Dialog, { open: true, onClose, title: 'Second dialog' });
		await expect.element(screen.getByRole('dialog')).toHaveFocus();
		await userEvent.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it('keeps the dialog open when dismissal is disabled', async () => {
		const onClose = vi.fn();
		const screen = render(Dialog, {
			closeOnBackdrop: false,
			closeOnEscape: false,
			onClose,
			open: true,
			title: 'Persistent dialog'
		});

		await screen.getByRole('presentation').click();
		await userEvent.keyboard('{Escape}');

		expect(onClose).not.toHaveBeenCalled();
		await expect.element(screen.getByRole('dialog')).toBeInTheDocument();
	});
});
