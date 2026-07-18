import type { Meta, StoryObj } from '@storybook/sveltekit';

import BrushPopover from './BrushPopover.svelte';

const meta = {
	title: 'Controls/Brush popover',
	component: BrushPopover,
	tags: ['autodocs'],
	args: {
		brush: {
			color: '#8a69f7',
			simulatePressure: true,
			size: 16,
			smoothing: 0.5,
			streamline: 0.5,
			thinning: 0.5
		},
		onBrushChange: () => {}
	}
} satisfies Meta<typeof BrushPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
