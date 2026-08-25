import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryInspectorStore } from '../../stories/editor.stories.fixtures';
import SelectionControls from '../SelectionControls.svelte';

const meta = {
	title: 'Editor/Inspector/Selection controls',
	component: SelectionControls,
	tags: ['autodocs'],
	args: {
		currentTool: 'select',
		orientation: 'vertical',
		store: createStoryInspectorStore('appearance')
	},
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof SelectionControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Appearance: Story = {};
export const Text: Story = { args: { store: createStoryInspectorStore('text') } };
export const Image: Story = { args: { store: createStoryInspectorStore('image') } };
export const Card: Story = { args: { store: createStoryInspectorStore('card') } };
export const Layout: Story = { args: { store: createStoryInspectorStore('layout') } };
