import { Store, type ToolId } from '@inkfinite/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Toolbar from '$editor/components/Toolbar.svelte';
import { createBrushStore } from '$editor/status';

function renderToolbar(currentTool: ToolId = 'select') {
	const onToolChange = vi.fn();
	const result = render(Toolbar, {
		currentTool,
		onToolChange,
		store: new Store(),
		brushStore: createBrushStore()
	});
	return { ...result, onToolChange };
}

describe('Toolbar component', () => {
	beforeEach(cleanup);

	it('renders primary tools and groups shape tools in a menu', () => {
		const { container } = renderToolbar();
		const labels = [...container.querySelectorAll<HTMLButtonElement>('.tool-button')].map(
			(button) => button.getAttribute('aria-label')
		);
		expect(labels).toEqual(['Select', 'Direct Select', 'Shapes', 'Text', 'Markdown', 'Pen']);
	});

	it('selects a shape from the shapes menu', async () => {
		const { container, onToolChange } = renderToolbar();
		(container.querySelector('[aria-label="Shapes"]') as HTMLButtonElement).click();
		await vi.waitFor(() =>
			expect(document.querySelector('[aria-label="Shape tools"]')).toBeTruthy()
		);
		(document.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
		expect(onToolChange).toHaveBeenCalledWith('rect');
	});

	it('marks a shape tool as active on the grouped control', () => {
		const { container } = renderToolbar('rect');
		const shapes = container.querySelector('[aria-label="Shapes"]');
		expect(shapes?.classList.contains('toolbar__tool-button--active')).toBe(true);
		expect(shapes?.getAttribute('aria-pressed')).toBe('true');
	});

	it('updates active state when the current tool changes', async () => {
		const { container, rerender, onToolChange } = renderToolbar();
		const props = { onToolChange, store: new Store(), brushStore: createBrushStore() };
		expect(
			container.querySelector('[data-tool-id="select"]')?.getAttribute('aria-pressed')
		).toBe('true');
		await rerender({ ...props, currentTool: 'rect' });
		expect(
			container.querySelector('[data-tool-id="select"]')?.getAttribute('aria-pressed')
		).toBe('false');
		expect(
			container.querySelector('[aria-label="Shapes"]')?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('labels the drawing toolbar', () => {
		const { container } = renderToolbar();
		const toolbar = container.querySelector('.toolbar');
		expect(toolbar?.getAttribute('role')).toBe('toolbar');
		expect(toolbar?.getAttribute('aria-label')).toBe('Drawing tools');
	});
});
