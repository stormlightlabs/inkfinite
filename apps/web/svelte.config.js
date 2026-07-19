import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.svx', '.md'],
	preprocess: [vitePreprocess(), mdsvex({ extensions: ['.svx', '.md'] })],
	kit: {
		adapter: adapter({ fallback: 'index.html' }),
		prerender: { entries: ['*'] },
		alias: {
			$editor: '../../packages/ui/src/lib/editor',
			$ui: '../../packages/ui/src/lib/index.ts',
			'@inkfinite/ui/editor': '../../packages/ui/src/lib/editor/index.ts'
		}
	}
};

export default config;
