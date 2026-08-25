import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: { port: 1420 },
	clearScreen: false,
	resolve: {
		alias: {
			'@inkfinite/bindings': new URL('../../packages/bindings/src/index.ts', import.meta.url).pathname,
			'@inkfinite/core/persistence': new URL('../../packages/core/src/persistence.ts', import.meta.url).pathname,
			'@inkfinite/core/geometry': new URL('../../packages/core/src/geometry.ts', import.meta.url).pathname,
			'@inkfinite/core': new URL('../../packages/core/src/index.ts', import.meta.url).pathname,
			'@inkfinite/editor/input-dom': new URL('../../packages/editor/src/input-dom.ts', import.meta.url).pathname,
			'@inkfinite/editor/renderer': new URL('../../packages/editor/src/renderer.ts', import.meta.url).pathname,
			'@inkfinite/editor/export': new URL('../../packages/editor/src/export.ts', import.meta.url).pathname,
			'@inkfinite/editor/runtime': new URL('../../packages/editor/src/runtime.ts', import.meta.url).pathname,
			'@inkfinite/ui/editor': new URL('../../packages/ui/src/lib/editor/index.ts', import.meta.url).pathname,
			'@inkfinite/ui/styles.css': new URL('../../packages/ui/src/lib/styles/index.css', import.meta.url).pathname,
			'@inkfinite/ui': new URL('../../packages/ui/src/lib/index.ts', import.meta.url).pathname,
			$editor: new URL('../../packages/ui/src/lib/editor', import.meta.url).pathname
		}
	},
	test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
