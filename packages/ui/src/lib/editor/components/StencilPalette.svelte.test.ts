import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import StencilPalette from './StencilPalette.svelte';

describe('StencilPalette', () => {
	it('filters registered stencils and supports keyboard selection', async () => {
		const onStencilClick = vi.fn();
		const screen = render(StencilPalette, { open: true, onClose: vi.fn(), onStencilClick });

		const filter = screen.getByRole('textbox', { name: 'Filter components' });
		await filter.fill('no stencil has this name');
		await expect.element(screen.getByText('No components found')).toBeInTheDocument();

		await filter.clear();
		const stencil = screen.getByRole('button', { name: /process/i });
		await expect.element(stencil).toBeInTheDocument();
		stencil.element().focus();
		await userEvent.keyboard('{Enter}');
		expect(onStencilClick).toHaveBeenCalledOnce();
	});
});
