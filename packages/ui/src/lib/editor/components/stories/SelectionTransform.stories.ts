import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryInspectorSelection } from '../../stories/editor.stories.fixtures';
import SelectionTransform from '../SelectionTransform.svelte';

const layoutSelection = createStoryInspectorSelection('layout');
const meta = {
	title: 'Editor/Inspector/Transform and layout',
	component: SelectionTransform,
	tags: ['autodocs'],
	args: { ...layoutSelection, showAgentControl: true }
} satisfies Meta<typeof SelectionTransform>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleSelection: Story = {};
