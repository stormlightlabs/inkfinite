import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryEditorControls } from '../editor.stories.fixtures';
import StatusBar from './StatusBar.svelte';

const controls = createStoryEditorControls();

const meta = {
	title: 'Editor/Status bar',
	component: StatusBar,
	tags: ['autodocs'],
	args: {
		store: controls.store,
		cursor: controls.cursor,
		persistence: controls.persistence,
		snap: controls.snap
	},
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
