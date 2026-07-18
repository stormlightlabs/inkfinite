/** Iconify classes used by Inkfinite's shared icon component. */
export const ICONS = {
	add: 'i-ph-plus-bold',
	arrow: 'i-tabler-arrow-up-right',
	'arrow-right': 'i-tabler-arrow-right',
	check: 'i-bi-check-lg',
	close: 'i-ph-x-bold',
	dark: 'i-tabler-moon',
	delete: 'i-bi-trash3',
	draw: 'i-ph-pencil-simple-line-bold',
	folder: 'i-ph-folder-bold',
	'grid-dots': 'i-tabler-grid-dots',
	'grip-vertical': 'i-tabler-grip-vertical',
	history: 'i-tabler-history',
	'info-circle': 'i-tabler-info-circle',
	light: 'i-tabler-sun',
	menu: 'i-bi-list',
	markdown: 'i-tabler-markdown',
	line: 'i-tabler-minus',
	ellipse: 'i-tabler-circle',
	rectangle: 'i-tabler-rectangle',
	select: 'i-tabler-pointer',
	text: 'i-tabler-letter-t',
	moon: 'i-tabler-moon',
	pencil: 'i-ph-pencil-simple-line-bold',
	redo: 'i-tabler-arrow-forward-up',
	save: 'i-ph-floppy-disk-back-bold',
	search: 'i-ph-magnifying-glass-bold',
	settings: 'i-bi-sliders',
	sun: 'i-tabler-sun',
	trash: 'i-bi-trash3',
	undo: 'i-tabler-arrow-back-up'
} as const;

/** A semantic icon name supported by the shared icon component. */
export type IconName = keyof typeof ICONS;
