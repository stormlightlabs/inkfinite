import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryPlatform } from '../../stories/editor.stories.fixtures';
import Canvas from '../Canvas.svelte';

const meta = {
	title: 'Editor/Canvas',
	component: Canvas,
	tags: ['autodocs'],
	args: { platform: createStoryPlatform() },
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof Canvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
