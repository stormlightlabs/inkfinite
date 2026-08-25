import type { Meta, StoryObj } from '@storybook/sveltekit';

import { createStoryInspectorSelection } from '../../stories/editor.stories.fixtures';
import SelectionMetadata from '../SelectionMetadata.svelte';

const namedObject = createStoryInspectorSelection('appearance');
const meta = {
	title: 'Editor/Inspector/Metadata',
	component: SelectionMetadata,
	tags: ['autodocs'],
	args: namedObject
} satisfies Meta<typeof SelectionMetadata>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NamedObject: Story = {};
