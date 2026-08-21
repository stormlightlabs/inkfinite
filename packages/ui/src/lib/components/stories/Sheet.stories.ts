import type { Meta, StoryObj } from '@storybook/sveltekit';

import Sheet from '../Sheet.svelte';
import SheetStory from './SheetStory.svelte';

const meta = {
	title: 'Surfaces/Sheet',
	component: Sheet,
	tags: ['autodocs'],
	args: { open: true, side: 'left', title: 'Stencil library' },
	argTypes: { side: { control: 'select', options: ['left', 'right', 'top', 'bottom'] } },
	render: (args) => ({ Component: SheetStory, props: args })
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const FromBottom: Story = { args: { side: 'bottom' } };
