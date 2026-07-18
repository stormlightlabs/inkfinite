import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Dialog from './Dialog.svelte';

describe('Dialog', () => {
	it('renders an accessible modal only while open', () => {
		const { rerender } = render(Dialog, { open: false, title: 'About Inkfinite' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		rerender({ open: true, title: 'About Inkfinite' });

		const dialog = screen.getByRole('dialog', { name: 'About Inkfinite' });
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(dialog).toHaveFocus();
	});

	it('closes from the backdrop and Escape key when enabled', async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(Dialog, { open: true, onClose, title: 'Test dialog' });

		await user.click(screen.getByRole('presentation'));
		expect(onClose).toHaveBeenCalledOnce();

		render(Dialog, { open: true, onClose, title: 'Second dialog' });
		await user.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it('keeps the dialog open when dismissal is disabled', async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(Dialog, {
			closeOnBackdrop: false,
			closeOnEscape: false,
			onClose,
			open: true,
			title: 'Persistent dialog'
		});

		await user.click(screen.getByRole('presentation'));
		await user.keyboard('{Escape}');

		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});
});
