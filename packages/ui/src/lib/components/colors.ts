import { normalizeHex } from './color-math';

/**
 * Reasonable Colors hue family with six perceptual shades.
 *
 * @see https://github.com/matthewhowell/reasonable-colors
 *
 * @see https://www.reasonable.work/artifacts/ra005-reasonable-colors/
 * */
export const REASONABLE_COLORS = {
	gray: ['#f6f6f6', '#e2e2e2', '#8b8b8b', '#6f6f6f', '#3e3e3e', '#222222'],
	rose: ['#fff7f9', '#ffdce5', '#ff3b8d', '#db0072', '#800040', '#4c0023'],
	raspberry: ['#fff8f8', '#ffdddf', '#ff426c', '#de0051', '#82002c', '#510018'],
	red: ['#fff8f6', '#ffddd8', '#ff4647', '#e0002b', '#830014', '#530003'],
	orange: ['#fff8f5', '#ffded1', '#fd4d00', '#cd3c00', '#752100', '#401600'],
	cinnamon: ['#fff8f3', '#ffdfc6', '#d57300', '#ac5c00', '#633300', '#371d00'],
	amber: ['#fff8ef', '#ffe0b2', '#b98300', '#926700', '#523800', '#302100'],
	yellow: ['#fff9e5', '#ffe53e', '#9c8b00', '#7d6f00', '#463d00', '#292300'],
	lime: ['#f7ffac', '#d5f200', '#819300', '#677600', '#394100', '#222600'],
	chartreuse: ['#e5ffc3', '#98fb00', '#5c9b00', '#497c00', '#264500', '#182600'],
	green: ['#e0ffd9', '#72ff6c', '#00a21f', '#008217', '#004908', '#062800'],
	emerald: ['#dcffe6', '#5dffa2', '#00a05a', '#008147', '#004825', '#002812'],
	aquamarine: ['#daffef', '#42ffc6', '#009f78', '#007f5f', '#004734', '#00281b'],
	teal: ['#d7fff7', '#00ffe4', '#009e8c', '#007c6e', '#00443c', '#002722'],
	cyan: ['#c4fffe', '#00fafb', '#00999a', '#007a7b', '#004344', '#002525'],
	powder: ['#dafaff', '#8df0ff', '#0098a9', '#007987', '#004048', '#002227'],
	sky: ['#e3f7ff', '#aee9ff', '#0094b4', '#007590', '#00404f', '#001f28'],
	cerulean: ['#e8f6ff', '#b9e3ff', '#0092c5', '#00749d', '#003c54', '#001d2a'],
	azure: ['#e8f2ff', '#c6e0ff', '#008fdb', '#0071af', '#003b5e', '#001c30'],
	blue: ['#f0f4ff', '#d4e0ff', '#0089fc', '#006dca', '#00386d', '#001a39'],
	indigo: ['#f3f3ff', '#deddff', '#657eff', '#0061fc', '#00328a', '#001649'],
	violet: ['#f7f1ff', '#e8daff', '#9b70ff', '#794aff', '#2d0fbf', '#0b0074'],
	purple: ['#fdf4ff', '#f7d9ff', '#d150ff', '#b01fe3', '#660087', '#3a004f'],
	magenta: ['#fff3fc', '#ffd7f6', '#f911e0', '#ca00b6', '#740068', '#44003c'],
	pink: ['#fff7fb', '#ffdcec', '#ff2fb2', '#d2008f', '#790051', '#4b0030']
} as const;

export type ColorFamily = keyof typeof REASONABLE_COLORS;

export type ColorShade = 1 | 2 | 3 | 4 | 5 | 6;

type CompactColor = { readonly family: ColorFamily; readonly shade: ColorShade };

/** The compact set of families shown before a user explores a shade row. */
export const quickColors: CompactColor[] = [
	{ family: 'gray', shade: 6 },
	{ family: 'gray', shade: 3 },
	{ family: 'violet', shade: 3 },
	{ family: 'purple', shade: 3 },
	{ family: 'indigo', shade: 3 },
	{ family: 'blue', shade: 3 },
	{ family: 'sky', shade: 3 },
	{ family: 'cyan', shade: 3 },
	{ family: 'teal', shade: 3 },
	{ family: 'emerald', shade: 3 },
	{ family: 'green', shade: 3 },
	{ family: 'yellow', shade: 2 },
	{ family: 'amber', shade: 3 },
	{ family: 'orange', shade: 3 },
	{ family: 'red', shade: 3 },
	{ family: 'rose', shade: 3 }
] as const;

/** Finds the Reasonable Colors family and shade for a palette value. */
export function findPaletteColor(value: string): CompactColor | undefined {
	const normalized = normalizeHex(value);
	if (!normalized) return undefined;

	for (const [family, shades] of Object.entries(REASONABLE_COLORS) as [
		ColorFamily,
		readonly string[]
	][]) {
		const index = shades.indexOf(normalized);
		if (index !== -1) {
			return { family, shade: (index + 1) as ColorShade };
		}
	}
	return undefined;
}

/** Returns the palette value for a family and one-based shade number. */
export function getPaletteColor(family: ColorFamily, shade: ColorShade): string {
	return REASONABLE_COLORS[family][shade - 1];
}
