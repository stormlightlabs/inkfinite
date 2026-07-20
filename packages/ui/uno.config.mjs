import presetIcons from '@unocss/preset-icons';
import { defineConfig } from 'unocss';

export default defineConfig({
	presets: [
		presetIcons({
			extraProperties: {
				display: 'inline-block',
				'flex-shrink': '0',
				'vertical-align': '-0.125em'
			}
		})
	]
});
