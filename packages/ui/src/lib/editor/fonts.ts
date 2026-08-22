/** Fonts bundled with the editor and available for canvas text. */
export const EDITOR_FONT_GROUPS = [
	{
		label: 'Sans',
		fonts: [
			{ label: 'Instrument Sans', family: 'Instrument Sans Variable' },
			{ label: 'Atkinson Hyperlegible Next', family: 'Atkinson Hyperlegible Next Variable' },
			{ label: 'IBM Plex Sans', family: 'IBM Plex Sans Variable' },
			{ label: 'Google Sans', family: 'Google Sans Variable' },
			{ label: 'Playpen Sans', family: 'Playpen Sans Variable' }
		]
	},
	{
		label: 'Serif',
		fonts: [
			{ label: 'Source Serif 4', family: 'Source Serif 4 Variable' },
			{ label: 'Newsreader', family: 'Newsreader Variable' },
			{ label: 'Fraunces', family: 'Fraunces Variable' }
		]
	},
	{
		label: 'Mono',
		fonts: [
			{ label: 'JetBrains Mono', family: 'JetBrains Mono Variable' },
			{ label: 'Geist Mono', family: 'Geist Mono Variable' },
			{ label: 'Azeret Mono', family: 'Azeret Mono Variable' }
		]
	}
] as const;
