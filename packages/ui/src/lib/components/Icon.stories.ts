import type { Meta, StoryObj } from '@storybook/sveltekit';

import Icon from './Icon.svelte';
import { ICONS } from '../icons';

const meta = {
	title: 'Controls/Icon',
	component: Icon,
	tags: ['autodocs'],
	args: { name: 'draw', size: 24 },
	argTypes: { name: { control: 'select', options: Object.keys(ICONS) } }
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Labeled: Story = { args: { label: 'Draw', name: 'draw' } };
