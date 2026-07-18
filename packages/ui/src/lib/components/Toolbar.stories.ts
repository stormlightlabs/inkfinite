import type { Meta, StoryObj } from '@storybook/sveltekit';
import { createRawSnippet } from 'svelte';

import Toolbar from './Toolbar.svelte';

const controls = createRawSnippet(() => ({
	render: () => '<button type="button">Select</button><button type="button">Draw</button>'
}));

const meta = {
	title: 'Controls/Toolbar',
	component: Toolbar,
	tags: ['autodocs'],
	args: { children: controls, label: 'Drawing tools' },
	argTypes: { orientation: { control: 'select', options: ['horizontal', 'vertical'] } }
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};
export const Vertical: Story = { args: { orientation: 'vertical' } };
