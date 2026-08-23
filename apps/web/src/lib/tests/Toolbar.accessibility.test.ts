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

		const shapesButton = container.querySelector('[aria-label="Shapes"]');
		expect(shapesButton?.getAttribute('aria-haspopup')).toBe('menu');
		expect(shapesButton?.getAttribute('aria-expanded')).toBe('false');
		expect(shapesButton?.getAttribute('aria-pressed')).toBe('false');
	});

	it('should have ARIA attributes on export button', () => {
		const store = new Store();
		const { container } = renderToolbar(store);

		const exportButton = container.querySelector('.toolbar__export-button');
		expect(exportButton?.getAttribute('aria-label')).toBe('Export drawing');
		expect(exportButton?.getAttribute('aria-haspopup')).toBe('menu');
		expect(exportButton?.getAttribute('aria-expanded')).toBe('false');
		const importButton = container.querySelector('.toolbar__import-button');
		expect(importButton?.getAttribute('aria-label')).toBe('Import');
		expect(importButton?.getAttribute('aria-haspopup')).toBe('menu');
		expect(importButton?.getAttribute('aria-expanded')).toBe('false');
	});

	it('should have proper menu roles when export menu is open', async () => {
		const store = new Store();
		const { container } = renderToolbar(store);

		const exportButton = container.querySelector(
			'.toolbar__export-button'
		) as HTMLButtonElement;
		exportButton.click();

		await new Promise((resolve) => setTimeout(resolve, 0));

		const exportMenu = container.querySelector('[role="menu"][aria-label="Export options"]');
		expect(exportMenu).toBeTruthy();

		const menuItems = exportMenu?.querySelectorAll('[role="menuitem"]') ?? [];
		expect(menuItems.length).toBe(5);
		menuItems.forEach((item) => {
			expect(item.getAttribute('role')).toBe('menuitem');
			expect(item.getAttribute('aria-label')).toBeTruthy();
		});
	});

	it('should open the import menu with document, file, and markup choices', async () => {
		const store = new Store();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const { container } = render(Toolbar, {
			target,
			props: {
				currentTool: 'select',
				onToolChange: () => {},
				store,
				brushStore: createBrushStore(),
				onImportEditable: () => {},
				onImportSvg: () => {},
				onImportSvgMarkup: () => {}
			}
		});

		(container.querySelector('.toolbar__import-button') as HTMLButtonElement).click();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const menu = document.querySelector('[aria-label="Import options"]');
		expect(menu?.getAttribute('role')).toBe('menu');
		expect(
			[...menu!.querySelectorAll('[role="menuitem"]')].map((item) =>
				item.textContent?.trim()
			)
		).toEqual(['Editable document', 'SVG file', 'SVG code / markup']);
	});

	it('should have visible focus states on buttons', () => {
		const store = new Store();
		const { container } = renderToolbar(store);

		const selectButton = container.querySelector('.toolbar__tool-button') as HTMLElement;
		selectButton.focus();

		expect(document.activeElement).toBe(selectButton);
	});
});
