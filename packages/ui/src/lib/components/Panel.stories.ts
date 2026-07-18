import type { Meta, StoryObj } from '@storybook/sveltekit';

import Panel from './Panel.svelte';

const meta = {
	title: 'Surfaces/Panel',
	component: Panel,
	tags: ['autodocs'],
	args: {
		eyebrow: 'Page 01',
		heading: 'Rough ideas',
		description: 'A reusable surface for inspectors, dialogs, and file cards.'
	}
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
