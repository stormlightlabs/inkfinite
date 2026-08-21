import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import Toolbar from '../Toolbar.svelte';

const controls = createRawSnippet(() => ({ render: () => '<button type="button">Draw</button>' }));

describe('Toolbar', () => {
	it('groups controls with an accessible name and orientation', async () => {
		const screen = render(Toolbar, {
			children: controls,
			label: 'Drawing tools',
			orientation: 'vertical'
		});

		const toolbar = screen.getByRole('toolbar', { name: 'Drawing tools' });
		await expect.element(toolbar).toHaveAttribute('aria-orientation', 'vertical');
		await expect.element(screen.getByRole('button', { name: 'Draw' })).toBeInTheDocument();
	});
});
