import type { Meta, StoryObj } from '@storybook/sveltekit';

import Dialog from './Dialog.svelte';
import DialogStory from './DialogStory.svelte';

const meta = {
	title: 'Surfaces/Dialog',
	component: Dialog,
	tags: ['autodocs'],
	args: { open: true, title: 'About this board' },
	render: (args) => ({ Component: DialogStory, props: args })
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Persistent: Story = { args: { closeOnBackdrop: false, closeOnEscape: false } };
