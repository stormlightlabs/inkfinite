import { createBrushStore } from '$editor/status';
import { type ComponentProps } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Toolbar from '$editor/components/Toolbar.svelte';
import { createStoreWithRect } from './toolbar-fixtures';

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

describe('Editor application chrome', () => {
	beforeEach(() => {
		cleanup();
	});

	it('renders the application title and monochrome logo', () => {
		const { container } = renderToolbar();
		expect(container.querySelector('.application-chrome')).toBeTruthy();
		expect(container.querySelector('.toolbar__logo svg path')?.getAttribute('fill')).toBe(
			'currentColor'
		);
		expect(container.querySelector('.toolbar__tagline')).toBeNull();
	});

	it('keeps file commands out of the drawing toolbar', () => {
		const { container } = renderToolbar();
		expect(container.querySelector('.toolbar .toolbar__import-button')).toBeNull();
		expect(container.querySelector('.toolbar .toolbar__export-button')).toBeNull();
		expect(
			container.querySelector('.application-chrome .toolbar__import-button')
		).toBeTruthy();
		expect(
			container.querySelector('.application-chrome .toolbar__export-button')
		).toBeTruthy();
	});
});
