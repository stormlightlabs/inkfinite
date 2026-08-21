import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryEditorControls } from '../../stories/editor.stories.fixtures';
import Toolbar from '../Toolbar.svelte';

const controls = createStoryEditorControls();

const meta = {
	title: 'Editor/Toolbar',
	component: Toolbar,
	tags: ['autodocs'],
	args: {
		currentTool: 'select',
		onToolChange: () => {},
		store: controls.store,
		brushStore: controls.brushStore,
		onStencilsClick: () => {}
	},
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Web: Story = { args: { showAgentControl: false } };

export const Desktop: Story = { args: { showAgentControl: true } };
