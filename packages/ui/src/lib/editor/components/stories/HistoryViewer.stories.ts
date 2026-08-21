import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryStore } from '../../stories/editor.stories.fixtures';
import HistoryViewer from '../HistoryViewer.svelte';

const meta = {
	title: 'Editor/History viewer',
	component: HistoryViewer,
	tags: ['autodocs'],
	args: { store: createStoryStore(), open: true, onClose: () => {} },
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof HistoryViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
