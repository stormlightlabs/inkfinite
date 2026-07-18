import type { Meta, StoryObj } from '@storybook/sveltekit';

import Editor from './Editor.svelte';
import { createStoryPlatform } from './editor.stories.fixtures';

const meta = {
	title: 'Editor/Editor',
	component: Editor,
	tags: ['autodocs'],
	args: { platform: createStoryPlatform() },
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
