import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { mdsvex } from 'mdsvex';
import { extractTableOfContents } from './src/lib/docs/content/table-of-contents.js';

const DEFAULT_VERSION = '0.0.0';
const buildVersion = getBuildVersion();

function getBuildVersion() {
	const tag = gitOutput(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']);
	const version = tag ?? `v${DEFAULT_VERSION}`;
	const count =
		gitOutput(
			tag ? ['rev-list', '--count', `${tag}..HEAD`] : ['rev-list', '--count', 'HEAD']
		) ?? '0';
	const commit = gitOutput(['rev-parse', 'HEAD']) ?? 'unknown';
	const shortCommit = gitOutput(['rev-parse', '--short', 'HEAD']) ?? 'unknown';
	const display = count === '0' ? version : `${version}-${count}+g${shortCommit}`;
	return { display, commit, version };
}

function gitOutput(args) {
	try {
		return execFileSync('git', args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		return null;
	}
}

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
		version: { name: JSON.stringify(buildVersion) },
		alias: {
			$editor: '../../packages/ui/src/lib/editor',
			$ui: '../../packages/ui/src/lib/index.ts',
			'@inkfinite/ui/editor': '../../packages/ui/src/lib/editor/index.ts'
		}
	}
};

export default config;
