import type { Meta, StoryObj } from '@storybook/sveltekit';

import { getSelectionInspectorState } from '../../selection-inspector';
import { createStoryStore } from '../../stories/editor.stories.fixtures';
import SelectionPathVector from '../SelectionPathVector.svelte';

const arrowStore = createStoryStore();
const arrowSelection = getSelectionInspectorState(arrowStore.getState());
const meta = {
	title: 'Editor/Inspector/Path and vector',
	component: SelectionPathVector,
	tags: ['autodocs'],
	args: { store: arrowStore, selection: arrowSelection }
} satisfies Meta<typeof SelectionPathVector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Arrow: Story = { args: { store: arrowStore, selection: arrowSelection } };
