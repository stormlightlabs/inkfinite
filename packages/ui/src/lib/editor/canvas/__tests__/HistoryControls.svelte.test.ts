import { EditorState, SnapshotCommand, Store } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import HistoryControls from '../HistoryControls.svelte';

describe('HistoryControls', () => {
	it('undoes and redoes commands while reflecting history availability', async () => {
		const before = EditorState.create();
		const after = EditorState.clone(before);
		after.ui.toolId = 'rect';
		const store = new Store(before);
		store.executeCommand(new SnapshotCommand('Choose rectangle tool', 'ui', before, after));

		const screen = render(HistoryControls, { store });
		const undo = screen.getByRole('button', { name: 'Undo' });
		const redo = screen.getByRole('button', { name: 'Redo' });

		await expect.element(undo).toBeEnabled();
		await expect.element(redo).toBeDisabled();
		await undo.click();
		expect(store.getState().ui.toolId).toBe('select');
		await expect.element(undo).toBeDisabled();
		await expect.element(redo).toBeEnabled();

		await redo.click();
		expect(store.getState().ui.toolId).toBe('rect');
		await expect.element(undo).toBeEnabled();
		await expect.element(redo).toBeDisabled();
	});
});
