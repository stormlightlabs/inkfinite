import type {
	ArrowStyle,
	BrushConfig,
	ContainerProps,
	EllipseProps,
	LineProps,
	MarkdownProps,
	RectProps,
	StrokeStyle,
	TextProps
} from './editor-model';

/** Canvas appearance used to resolve explicit creation-time document colors. */
export type CanvasAppearance = 'light' | 'dark';

/** Visual defaults persisted on newly created native content. */
export type CreationStylePolicy = {
	rect: Pick<RectProps, 'fill' | 'stroke' | 'radius'>;
	ellipse: Pick<EllipseProps, 'fill' | 'stroke'>;
	frame: Pick<ContainerProps, 'fill' | 'stroke' | 'radius'>;
	line: Pick<LineProps, 'stroke' | 'width'>;
	arrow: ArrowStyle;
	pen: { brush: BrushConfig; style: StrokeStyle };
	text: Pick<TextProps, 'fontSize' | 'fontFamily' | 'color'>;
	markdown: Pick<MarkdownProps, 'fontSize' | 'fontFamily' | 'color' | 'bg' | 'border'>;
	card: {
		container: Pick<ContainerProps, 'fill' | 'stroke' | 'radius'>;
		title: Pick<TextProps, 'fontSize' | 'fontFamily' | 'color'>;
		body: Pick<MarkdownProps, 'fontSize' | 'fontFamily' | 'color' | 'bg' | 'border'>;
	};
};

const FONT_FAMILY = 'Instrument Sans Variable';
const BRUSH = { size: 6, thinning: 0.35, smoothing: 0.55, streamline: 0.55, simulatePressure: true };

/** Resolves theme-independent, explicit document colors against the current canvas. */
export function creationStylePolicy(appearance: CanvasAppearance = 'light'): CreationStylePolicy {
	const dark = appearance === 'dark';
	const fill = dark ? '#252738' : '#ffffff';
	const stroke = dark ? '#8f93a8' : '#69717d';
	const text = dark ? '#d8e6e6' : '#1e2029';
	const mutedText = dark ? '#b8c5c8' : '#495063';
	const accent = dark ? '#a78bfa' : '#7655df';
	return {
		rect: { fill, stroke, radius: 12 },
		ellipse: { fill, stroke },
		frame: { fill: dark ? '#1d1f30' : '#e5e9eb', stroke, radius: 6 },
		line: { stroke, width: 2 },
		arrow: { stroke: accent, width: 2, headEnd: true },
		pen: { brush: { ...BRUSH }, style: { color: text, opacity: 1 } },
		text: { fontSize: 16, fontFamily: FONT_FAMILY, color: text },
		markdown: {
			fontSize: 16,
			fontFamily: FONT_FAMILY,
			color: text,
			bg: 'transparent',
			border: 'transparent'
		},
		card: {
			container: { fill, stroke, radius: 14 },
			title: { fontSize: 18, fontFamily: FONT_FAMILY, color: text },
			body: {
				fontSize: 14,
				fontFamily: FONT_FAMILY,
				color: mutedText,
				bg: 'transparent',
				border: 'transparent'
			}
		}
	};
}
