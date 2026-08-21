declare module 'culori' {
	interface CuloriColor {
		mode?: string;
		h?: number;
		s?: number;
		v?: number;
		r?: number;
		g?: number;
		b?: number;
	}

	export function converter(
		mode: string
	): (color: CuloriColor | undefined) => CuloriColor | undefined;
	export function formatHex(color: CuloriColor | undefined): string | undefined;
	export function parse(color: string): CuloriColor | undefined;
}
