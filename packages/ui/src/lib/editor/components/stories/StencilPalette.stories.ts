import type { Meta, StoryObj } from '@storybook/sveltekit';

import StencilPalette from '../StencilPalette.svelte';

const meta = {
	title: 'Editor/Stencil palette',
	component: StencilPalette,
	tags: ['autodocs'],
	args: { open: true, onClose: () => {}, onStencilClick: () => {} },
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof StencilPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
