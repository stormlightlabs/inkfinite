import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createSelectedArrowStore } from '../../../../test/editor-fixtures';
import ArrowPopover from '../ArrowPopover.svelte';

describe('ArrowPopover', () => {
	it('updates selected arrows through an undoable command', async () => {
		const store = createSelectedArrowStore();
		const screen = render(ArrowPopover, { store });

		await screen.getByRole('button', { name: 'Arrow settings' }).click();
		await screen.getByRole('button', { name: 'Orthogonal routing' }).click();
		await screen.getByRole('checkbox', { name: 'Start arrowhead' }).click();

		const width = screen
			.getByRole('spinbutton', { name: 'Arrow stroke width' })
			.element() as HTMLInputElement;
		width.value = '4';
		width.dispatchEvent(new Event('change', { bubbles: true }));

		const arrow = store.getState().doc.shapes['shape:arrow'];
		expect(arrow.type === 'arrow' && arrow.props.routing?.kind).toBe('orthogonal');
		expect(arrow.type === 'arrow' && arrow.props.style.headStart).toBe(true);
		expect(arrow.type === 'arrow' && arrow.props.style.width).toBe(4);
		expect(store.canUndo()).toBe(true);

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await expect.element(screen.getByRole('button', { name: 'Arrow settings' })).toHaveFocus();

		store.undo();
		const restored = store.getState().doc.shapes['shape:arrow'];
		expect(restored.type === 'arrow' && restored.props.routing?.kind).toBe('orthogonal');
	});
});
