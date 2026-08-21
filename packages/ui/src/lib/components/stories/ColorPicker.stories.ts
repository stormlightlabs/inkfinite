import type { Meta, StoryObj } from '@storybook/sveltekit';

import ColorPicker from '../ColorPicker.svelte';

const meta = {
	title: 'Controls/Color picker',
	component: ColorPicker,
	tags: ['autodocs'],
	args: { label: 'Fill color', onchange: () => {}, value: '#0089fc' },
	argTypes: {
		align: { control: 'select', options: ['start', 'end'] },
		recentColors: { control: 'object' }
	}
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithRecentColors: Story = {
	args: { recentColors: ['#8a69f7', '#00a21f', '#ff4647'], value: '#8a69f7' }
};
export const EndAligned: Story = { args: { align: 'end' } };
export const Disabled: Story = { args: { disabled: true } };
