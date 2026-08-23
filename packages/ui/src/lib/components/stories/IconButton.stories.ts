import type { Meta, StoryObj } from '@storybook/sveltekit';

import IconButton from '../IconButton.svelte';

const meta = {
	title: 'Controls/Icon button',
	component: IconButton,
	tags: ['autodocs'],
	args: { label: 'Draw', name: 'draw' }
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };
export const Disabled: Story = { args: { disabled: true } };
