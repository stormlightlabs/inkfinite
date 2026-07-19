import type { Meta, StoryObj } from '@storybook/sveltekit';

import ContextMenuStory from './ContextMenuStory.svelte';

const meta = {
	title: 'Controls/ContextMenu',
	component: ContextMenuStory,
	tags: ['autodocs']
} satisfies Meta<typeof ContextMenuStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};
