import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createSelectedArrowStore } from '../../../test/editor-fixtures';
import ArrowPopover from './ArrowPopover.svelte';

describe('ArrowPopover', () => {
	it('updates selected arrows through an undoable command', async () => {
		const store = createSelectedArrowStore();
		const screen = render(ArrowPopover, { store });

		await screen.getByRole('button', { name: 'Arrow settings' }).click();
		await screen.getByRole('button', { name: 'Orthogonal routing' }).click();

		const arrow = store.getState().doc.shapes['shape:arrow'];
		expect(arrow.type === 'arrow' && arrow.props.routing?.kind).toBe('orthogonal');
		expect(store.canUndo()).toBe(true);

		store.undo();
		const restored = store.getState().doc.shapes['shape:arrow'];
		expect(restored.type === 'arrow' && restored.props.routing?.kind).toBe('straight');
	});
});
