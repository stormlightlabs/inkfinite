import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryStore } from '../../stories/editor.stories.fixtures';
import ArrowPopover from '../ArrowPopover.svelte';

const meta = {
	title: 'Editor/Arrow popover',
	component: ArrowPopover,
	tags: ['autodocs'],
	args: { store: createStoryStore() }
} satisfies Meta<typeof ArrowPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectedArrow: Story = {};
export const Disabled: Story = { args: { disabled: true } };
