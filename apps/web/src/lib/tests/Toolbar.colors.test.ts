import type { Store } from '@inkfinite/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Toolbar from '$editor/components/Toolbar.svelte';
import { createBrushStore } from '$editor/status';
import { createStoreWithLine, createStoreWithRect } from './toolbar-fixtures';

describe('Toolbar color controls', () => {
	beforeEach(() => {
		cleanup();
	});

	function renderToolbar(store: Store) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const brushStore = createBrushStore();
		return render(Toolbar, {
			target,
			props: { currentTool: 'select', onToolChange: () => {}, store, brushStore }
		});
	}

	it('updates fill color for selected shapes', async () => {
		const store = createStoreWithRect();
		const screen = renderToolbar(store);

		await screen.getByRole('button', { name: 'Fill color' }).click();
		await screen
			.getByRole('group', { name: 'Quick colors' })
			.getByRole('button', { name: 'blue 3' })
			.click();

		const updated = store.getState().doc.shapes['shape:rect'];
		expect(updated?.type).toBe('rect');
		if (updated?.type !== 'rect') {
			throw new Error('Expected rect shape');
		}
		expect(updated.props.fill).toBe('#0089fc');
	});

	it('updates stroke color for selectable shapes', async () => {
		const store = createStoreWithRect();
		const screen = renderToolbar(store);

		await screen.getByRole('button', { name: 'Stroke color' }).click();
		await screen
			.getByRole('group', { name: 'Quick colors' })
			.getByRole('button', { name: 'red 3' })
			.click();

		const updated = store.getState().doc.shapes['shape:rect'];
		expect(updated?.type).toBe('rect');
		if (updated?.type !== 'rect') {
			throw new Error('Expected rect shape');
		}
		expect(updated.props.stroke).toBe('#ff4647');
	});

	it('hides fill control when selection has no fillable shapes', () => {
		const store = createStoreWithLine();
		const { container } = renderToolbar(store);

		const fillButton = container.querySelector(
			'button[aria-label="Fill color"]'
		) as HTMLButtonElement | null;
		const strokeButton = container.querySelector(
			'button[aria-label="Stroke color"]'
		) as HTMLButtonElement | null;
		expect(fillButton).toBeNull();
		expect(strokeButton).toBeTruthy();
		if (!strokeButton) return;

		expect(strokeButton.disabled).toBe(false);
	});
});
