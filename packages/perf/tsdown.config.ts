import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: [
		'src/cli.ts',
		'src/capture-performance.ts',
		'src/mcp-startup.ts',
		'src/measure-browser.ts',
		'src/measure-process.ts',
		'src/profile-native.ts'
	],
	format: 'esm',
	clean: true,
	sourcemap: true,
	shims: true
});
