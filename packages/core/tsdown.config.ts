import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		model: 'src/model.ts',
		geometry: 'src/geometry.ts',
		commands: 'src/commands.ts',
		selection: 'src/selection.ts',
		interchange: 'src/interchange.ts',
		persistence: 'src/persistence.ts'
	},
	exports: true
});
