import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryFileBrowser } from '../editor.stories.fixtures';
import FileBrowser from './FileBrowser.svelte';

const meta = {
	title: 'Editor/File browser',
	component: FileBrowser,
	tags: ['autodocs'],
	args: { vm: createStoryFileBrowser(), open: true, onClose: () => {} },
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof FileBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBoards: Story = {};
export const Empty: Story = { args: { vm: createStoryFileBrowser([]) } };
