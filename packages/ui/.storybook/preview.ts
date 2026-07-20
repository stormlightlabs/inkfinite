import type { Preview } from '@storybook/sveltekit';

import '../src/lib/styles/index.css';

const preview: Preview = {
	parameters: {
		a11y: { test: 'error' },
		controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
		layout: 'centered'
	}
};

export default preview;
