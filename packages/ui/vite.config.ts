import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		watch: false,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'json'],
			exclude: [
				'**/*.stories.ts',
				'**/*.test.ts',
				'**/*.config.ts',
				'**/.svelte-kit/**',
				'**/dist/**',
				'**/storybook-static/**',
				'src/lib/editor/editor.stories.fixtures.ts',
				'src/test/**'
			]
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'components',
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({ launchOptions: { channel: 'chrome' } }),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/lib/theme.test.ts'],
					setupFiles: ['vitest-browser-svelte']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/lib/theme.test.ts']
				}
			}
		]
	}
});
