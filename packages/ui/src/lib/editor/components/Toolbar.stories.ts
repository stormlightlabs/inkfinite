import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryEditorControls } from '../editor.stories.fixtures';
import Toolbar from './Toolbar.svelte';

const controls = createStoryEditorControls();

const meta = {
	title: 'Editor/Toolbar',
	component: Toolbar,
	tags: ['autodocs'],
	args: {
		currentTool: 'select',
		onToolChange: () => {},
		store: controls.store,
		getViewport: () => ({ width: 1280, height: 720 }),
		brushStore: controls.brushStore,
		onStencilsClick: () => {}
	},
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Web: Story = {};
export const Desktop: Story = {
	args: {
		platform: 'desktop',
		desktop: {
			fileName: 'launch-ideas.inkfinite',
			recentBoards: [],
			onOpen: () => {},
			onNew: () => {},
			onSaveAs: () => {},
			onSelectBoard: () => {}
		}
	}
};
