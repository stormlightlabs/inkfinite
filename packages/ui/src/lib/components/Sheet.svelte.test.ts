import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Sheet from './Sheet.svelte';

describe('Sheet', () => {
	it.each(['left', 'right', 'top', 'bottom'] as const)(
		'renders an accessible %s-side modal',
		(side) => {
			render(Sheet, { open: true, side, title: 'Layers' });

			const sheet = screen.getByRole('dialog', { name: 'Layers' });
			expect(sheet).toHaveAttribute('aria-modal', 'true');
			expect(sheet).toHaveClass(`sheet-${side}`);
			expect(sheet).toHaveFocus();
		}
	);

	it('defaults to the right side', () => {
		render(Sheet, { open: true, title: 'History' });
		expect(screen.getByRole('dialog')).toHaveClass('sheet-right');
	});

	it('closes from the backdrop and Escape key', async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(Sheet, { open: true, onClose, title: 'First sheet' });

		await user.click(screen.getByRole('presentation'));
		expect(onClose).toHaveBeenCalledOnce();

		render(Sheet, { open: true, onClose, title: 'Second sheet' });
		await user.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
