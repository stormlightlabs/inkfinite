import { EditorState, SnapshotCommand, Store } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import HistoryViewer from './HistoryViewer.svelte';

describe('HistoryViewer', () => {
	it('shows commands and lets the user undo and redo them', async () => {
		const before = EditorState.create();
		const after = EditorState.clone(before);
		after.ui.toolId = 'rect';
		const store = new Store(before);
		store.executeCommand(new SnapshotCommand('Choose rectangle tool', 'ui', before, after));

		const screen = render(HistoryViewer, { store, open: true, onClose: vi.fn() });

		await expect.element(screen.getByText('Choose rectangle tool')).toBeInTheDocument();
		await screen.getByRole('button', { name: 'Undo' }).click();
		expect(store.getState().ui.toolId).toBe('select');

		const redo = screen.getByRole('button', { name: 'Redo' });
		await expect.element(redo).toBeEnabled();
		await redo.click();
		expect(store.getState().ui.toolId).toBe('rect');
	});
});
