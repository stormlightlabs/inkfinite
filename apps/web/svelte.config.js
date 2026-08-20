import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import { extractTableOfContents } from './src/lib/docs/content/table-of-contents.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.svx', '.md'],
	preprocess: [
		vitePreprocess(),
		mdsvex({ extensions: ['.svx', '.md'], rehypePlugins: [extractTableOfContents] })
	],
	kit: {
		adapter: adapter(),
		prerender: { entries: ['*'] },
		alias: {
			$editor: '../../packages/ui/src/lib/editor',
			$ui: '../../packages/ui/src/lib/index.ts',
			'@inkfinite/ui/editor': '../../packages/ui/src/lib/editor/index.ts'
		}
	}
};

export default config;
