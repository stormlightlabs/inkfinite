import { Store } from '@inkfinite/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Toolbar from '$editor/components/Toolbar.svelte';
import { createBrushStore } from '$editor/status';

// TODO: reuse this pattern
function renderToolbar(store: Store) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const brushStore = createBrushStore();
	return render(Toolbar, {
		target,
		props: { currentTool: 'select', onToolChange: () => {}, store, brushStore }
	});
}

describe('Toolbar accessibility', () => {
	beforeEach(() => {
		cleanup();
	});

	it('should have proper ARIA labels on tool buttons', () => {
		const store = new Store();
		const { container } = renderToolbar(store);

		const selectButton = container.querySelector('[data-tool-id="select"]');
		expect(selectButton?.getAttribute('aria-label')).toBe('Select');
		expect(selectButton?.getAttribute('aria-pressed')).toBe('true');

		const rectButton = container.querySelector('[data-tool-id="rect"]');
		expect(rectButton?.getAttribute('aria-label')).toBe('Rectangle');
		expect(rectButton?.getAttribute('aria-pressed')).toBe('false');
	});

	it('should have ARIA attributes on export button', () => {
		const store = new Store();
		const { container } = renderToolbar(store);

		const exportButton = container.querySelector('.toolbar__export-button');
		expect(exportButton?.getAttribute('aria-label')).toBe('Export drawing');
		expect(exportButton?.getAttribute('aria-haspopup')).toBe('true');
		expect(exportButton?.getAttribute('aria-expanded')).toBe('false');
	});

	it('should have proper menu roles when export menu is open', async () => {
		const store = new Store();
		const { container } = renderToolbar(store);

		const exportButton = container.querySelector(
			'.toolbar__export-button'
		) as HTMLButtonElement;
		exportButton.click();

		await new Promise((resolve) => setTimeout(resolve, 0));

		const exportMenu = container.querySelector('.toolbar__export-menu');
		expect(exportMenu?.getAttribute('role')).toBe('menu');
		expect(exportMenu?.getAttribute('aria-label')).toBe('Export options');

		const menuItems = container.querySelectorAll('.toolbar__export-menu .toolbar__menu-item');
		expect(menuItems.length).toBe(3);
		menuItems.forEach((item) => {
			expect(item.getAttribute('role')).toBe('menuitem');
			expect(item.getAttribute('aria-label')).toBeTruthy();
		});
	});

	it('should have visible focus states on buttons', () => {
		const store = new Store();
		const { container } = renderToolbar(store);

		const selectButton = container.querySelector('.toolbar__tool-button') as HTMLElement;
		selectButton.focus();

		expect(document.activeElement).toBe(selectButton);
	});
});
