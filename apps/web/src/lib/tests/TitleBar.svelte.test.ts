import { createBrushStore } from '$editor/status';
import { type ComponentProps } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Toolbar from '$editor/components/Toolbar.svelte';
import { createStoreWithRect } from './Toolbar.colors.test';

const renderToolbar = (overrides: Partial<ComponentProps<typeof Toolbar>> = {}) => {
	const brushStore = createBrushStore();

	const { container } = render(Toolbar, {
		currentTool: 'select',
		onToolChange: () => {},
		store: createStoreWithRect(),
		brushStore,
		...overrides
	});

	return { container };
};

describe('TitleBar (merged into Toolbar)', () => {
	beforeEach(() => {
		cleanup();
	});

	it('renders the title and monochrome logo', () => {
		const { container } = renderToolbar();
		expect(container.querySelector('.toolbar')).toBeTruthy();
		expect(container.querySelector('.toolbar__logo svg path')?.getAttribute('fill')).toBe(
			'currentColor'
		);
	});

	it('keeps file commands out of the drawing toolbar', () => {
		const { container } = renderToolbar();
		expect(container.querySelector('.toolbar__desktop')).toBeNull();
		expect(container.textContent).not.toContain('Save As…');
	});
});
