import { EditorState, SnapshotCommand, Store } from '@inkfinite/core';
import type { Meta, StoryObj } from '@storybook/sveltekit';

import HistoryControls from '../HistoryControls.svelte';

function storeWithHistory(state: 'undo' | 'redo'): Store {
	const before = EditorState.create();
	const after = EditorState.clone(before);
	after.ui.toolId = 'rect';
	const store = new Store(before);
	store.executeCommand(new SnapshotCommand('Choose rectangle tool', 'ui', before, after));
	if (state === 'redo') store.undo();
	return store;
}

const meta = {
	title: 'Editor/History controls',
	component: HistoryControls,
	tags: ['autodocs'],
	args: { store: new Store() },
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof HistoryControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const UndoAvailable: Story = { args: { store: storeWithHistory('undo') } };

export const RedoAvailable: Story = { args: { store: storeWithHistory('redo') } };
