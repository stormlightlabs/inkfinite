import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), devtoolsJson()],
	server: { fs: { allow: [searchForWorkspaceRoot(process.cwd())] } },
	resolve: {
		alias: {
			'@inkfinite/bindings': new URL('../../packages/bindings/src/index.ts', import.meta.url)
				.pathname,
			'@inkfinite/core/persistence': new URL(
				'../../packages/core/src/persistence.ts',
				import.meta.url
			).pathname,
			'@inkfinite/core/geometry': new URL(
				'../../packages/core/src/geometry.ts',
				import.meta.url
			).pathname,
			'@inkfinite/core': new URL('../../packages/core/src/index.ts', import.meta.url)
				.pathname,
			'@inkfinite/editor/input-dom': new URL(
				'../../packages/editor/src/input-dom.ts',
				import.meta.url
			).pathname,
			'@inkfinite/editor/renderer': new URL(
				'../../packages/editor/src/renderer.ts',
				import.meta.url
			).pathname,
			'@inkfinite/editor/export': new URL(
				'../../packages/editor/src/export.ts',
				import.meta.url
			).pathname,
			'@inkfinite/editor/runtime': new URL(
				'../../packages/editor/src/runtime.ts',
				import.meta.url
			).pathname,
			'@inkfinite/ui/editor': new URL(
				'../../packages/ui/src/lib/editor/index.ts',
				import.meta.url
			).pathname,
			'@inkfinite/ui/styles.css': new URL(
				'../../packages/ui/src/lib/styles/index.css',
				import.meta.url
			).pathname,
			'@inkfinite/ui': new URL('../../packages/ui/src/lib/index.ts', import.meta.url)
				.pathname,
			$editor: new URL('../../packages/ui/src/lib/editor', import.meta.url).pathname
		}
	},
	test: {
		ui: false,
		watch: false,
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						headless: true,
						enabled: true,
						provider: playwright({
							launchOptions: { channel: 'chrome' },
							contextOptions: { deviceScaleFactor: 1 }
						}),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/lib/tests/**/*.{test,spec}.{js,ts}'
					],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'input-dpr-2',
					browser: {
						headless: true,
						enabled: true,
						provider: playwright({
							launchOptions: { channel: 'chrome' },
							contextOptions: { deviceScaleFactor: 2 }
						}),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/lib/tests/input.test.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/lib/tests/**/*.{test,spec}.{js,ts}'
					]
				}
			}
		]
	}
});
