import type {
	ArrowLabel,
	EditorState,
	MarkdownShape,
	PathGeometry,
	PathShape,
	TextPathLayout,
	TextShape
} from '@inkfinite/core';
import { arrowLabelPlacement, shapeTransform } from '@inkfinite/core';
import { paintForCanvas } from './canvas.js';
import type { RendererResources } from './resources.js';
import { LruCache } from './resources.js';

/**
 * Draw an arrow label
 */
export function drawArrowLabel(
	context: CanvasRenderingContext2D,
	state: EditorState,
	geometry: PathGeometry,
	label: ArrowLabel
) {
	if (!label.text) return;

	const placement = arrowLabelPlacement(geometry, label);
	if (!placement) return;
	const labelPos = placement.point;

	context.save();
	context.font = '14px sans-serif';
	context.fillStyle = '#000';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	const metrics = context.measureText(label.text);
	const padding = 4;
	const bgWidth = metrics.width + padding * 2;
	const bgHeight = 18;

	context.fillStyle = 'rgba(255, 255, 255, 0.9)';
	context.fillRect(labelPos.x - bgWidth / 2, labelPos.y - bgHeight / 2, bgWidth, bgHeight);
	context.strokeStyle = '#ccc';
	context.lineWidth = 1 / state.camera.zoom;
	context.strokeRect(labelPos.x - bgWidth / 2, labelPos.y - bgHeight / 2, bgWidth, bgHeight);

	context.fillStyle = '#000';
	context.fillText(label.text, labelPos.x, labelPos.y);
	context.restore();
}

/**
 * Draw a text shape
 */
export function drawText(context: CanvasRenderingContext2D, shape: TextShape, resources: RendererResources) {
	const { text, fontSize, fontFamily, color, w } = shape.props;

	context.globalAlpha *= shape.fillOpacity ?? 1;
	context.font = `${fontSize}px ${fontFamily}`;
	context.fillStyle =
		paintForCanvas(context, color, { x: 0, y: 0, width: w ?? fontSize * 10, height: fontSize * 1.2 }) ?? '#000000';
	context.textBaseline = 'top';

	if (w === undefined) {
		context.fillText(text, 0, 0);
	} else {
		const lines = wrapText(context, text, w, resources.textLayoutCache, resources.textMetricCache);
		for (const [index, line] of lines.entries()) {
			context.fillText(line, 0, index * fontSize * 1.2);
		}
	}
}

/** Draw attached text in the supporting path's local coordinate system. */
export function drawTextOnPath(
	context: CanvasRenderingContext2D,
	shape: TextShape,
	path: PathShape,
	layout: TextPathLayout
): void {
	const matrix = shapeTransform(path);
	context.save();
	context.globalAlpha *= shape.fillOpacity ?? 1;
	context.transform(matrix[0], matrix[1], matrix[3], matrix[4], matrix[6], matrix[7]);
	context.font = `${shape.props.fontSize}px ${shape.props.fontFamily}`;
	context.fillStyle =
		paintForCanvas(context, shape.props.color, {
			x: layout.bounds.min.x,
			y: layout.bounds.min.y,
			width: layout.bounds.max.x - layout.bounds.min.x,
			height: layout.bounds.max.y - layout.bounds.min.y
		}) ?? '#000000';
	context.textAlign = 'center';
	context.textBaseline = 'alphabetic';
	for (const glyph of layout.glyphs) {
		context.save();
		context.translate(glyph.point.x, glyph.point.y);
		context.rotate(glyph.angle);
		context.fillText(glyph.character, 0, 0);
		context.restore();
	}
	context.restore();
}

/**
 * Parse and render markdown to canvas
 *
 * Renders markdown with basic formatting:
 * - Headings (h1-h6) with appropriate sizes
 * - Bold (**text** or __text__)
 * - Italic (*text* or _text_)
 * - Code (`code`)
 * - Paragraphs with line wrapping
 * - Lists (ordered and unordered)
 * - Code blocks (```)
 */
export type MarkdownLine = { source: string; kind: 'code' | 'text'; fontSize: number; weight: string; prefix: string };

function prepareMarkdownLines(source: string, baseFontSize: number): MarkdownLine[] {
	const sourceLines = source.split('\n');
	const lines: MarkdownLine[] = [];

	for (let index = 0; index < sourceLines.length; index++) {
		let line = sourceLines[index];
		if (line.startsWith('```')) {
			const codeLines: string[] = [];
			index++;
			while (index < sourceLines.length && !sourceLines[index].startsWith('```')) {
				codeLines.push(sourceLines[index]);
				index++;
			}
			lines.push({
				source: codeLines.join('\n'),
				kind: 'code',
				fontSize: baseFontSize,
				weight: 'normal',
				prefix: ''
			});
			continue;
		}

		let fontSize = baseFontSize;
		let weight = 'normal';
		let prefix = '';
		const heading = line.match(/^(#{1,6})\s(.*)$/);
		const orderedItem = line.match(/^(\d+)\.\s(.*)$/);
		if (heading) {
			fontSize = baseFontSize * (2 - heading[1].length * 0.15);
			weight = 'bold';
			line = heading[2];
		} else if (/^[-*+]\s/.test(line)) {
			prefix = '• ';
			line = line.replace(/^[-*+]\s/, '');
		} else if (orderedItem) {
			prefix = `${orderedItem[1]}. `;
			line = orderedItem[2];
		}
		lines.push({ source: line, kind: 'text', fontSize, weight, prefix });
	}

	return lines;
}

export function drawMarkdown(
	context: CanvasRenderingContext2D,
	shape: MarkdownShape,
	theme: 'light' | 'dark' = 'light',
	resources: RendererResources
) {
	const { md, w, h, fontSize, fontFamily, color, bg, border } = shape.props;

	const width = w;
	const height = h ?? fontSize * 10;
	const shapeAlpha = context.globalAlpha;

	context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
	context.fillStyle = paintForCanvas(context, bg, { x: 0, y: 0, width, height }) ?? '#ffffff';
	context.fillRect(0, 0, width, height);

	if (border) {
		context.globalAlpha = shapeAlpha * (shape.strokeOpacity ?? 1);
		context.strokeStyle = paintForCanvas(context, border, { x: 0, y: 0, width, height }) ?? '#000000';
		context.lineWidth = 1;
		context.strokeRect(0, 0, width, height);
	}

	context.globalAlpha = shapeAlpha * (shape.fillOpacity ?? 1);
	context.fillStyle = paintForCanvas(context, color, { x: 0, y: 0, width, height }) ?? '#000000';
	context.textBaseline = 'top';

	const padding = 8;
	let yOffset = padding;
	const lineHeight = fontSize * 1.4;

	const layoutKey = `${md}\u0000${w}\u0000${fontSize}\u0000${fontFamily}\u0000${theme}`;
	let preparedLines = resources.markdownLayoutCache.get(layoutKey);
	if (!preparedLines) {
		preparedLines = prepareMarkdownLines(md, fontSize);
		resources.markdownLayoutCache.set(layoutKey, preparedLines);
	}

	for (let lineIndex = 0; lineIndex < preparedLines.length; lineIndex++) {
		const prepared = preparedLines[lineIndex];
		let line = prepared.source;

		if (yOffset + lineHeight > height - padding) break;

		let currentFontSize = prepared.fontSize;
		let currentStyle = 'normal';
		let currentWeight = 'normal';
		let prefix = prepared.prefix;

		if (prepared.kind === 'code') {
			context.fillStyle = theme === 'dark' ? '#2e3440' : '#f4f4f4';
			const codeBlockLines = line.split('\n');

			const codeBlockHeight = codeBlockLines.length * lineHeight + padding * 2;
			if (yOffset + codeBlockHeight <= height - padding) {
				context.fillRect(padding, yOffset, width - padding * 2, codeBlockHeight);

				context.fillStyle = theme === 'dark' ? '#e5e9f0' : '#333';
				context.font = `normal normal ${fontSize}px monospace`;

				for (const [index, codeLine] of codeBlockLines.entries()) {
					context.fillText(codeLine, padding + 4, yOffset + padding + index * lineHeight);
				}

				yOffset += codeBlockHeight + padding;
			}

			context.fillStyle = paintForCanvas(context, color, { x: 0, y: 0, width, height }) ?? '#000000';
			context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
			continue;
		}

		currentWeight = prepared.weight;

		line = prefix + line;

		line = line.replace(/`([^`]+)`/g, '$1');

		context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;

		const wrappedLines = wrapText(
			context,
			line,
			width - padding * 2,
			resources.textLayoutCache,
			resources.textMetricCache
		);

		for (const wrappedLine of wrappedLines) {
			if (yOffset + currentFontSize * 1.4 > height - padding) break;

			const styledLine = wrappedLine;
			let xOffset = padding;

			const segments = parseInlineStyles(styledLine);

			for (const segment of segments) {
				const { text: segmentText, bold, italic, code } = segment;

				if (code) {
					context.fillStyle = theme === 'dark' ? '#2e3440' : '#f4f4f4';
					const metrics = context.measureText(segmentText);
					context.fillRect(xOffset, yOffset, metrics.width + 4, currentFontSize * 1.2);

					context.fillStyle = theme === 'dark' ? '#e5e9f0' : '#333';
					context.font = `normal normal ${currentFontSize * 0.9}px monospace`;
					context.fillText(segmentText, xOffset + 2, yOffset);
					xOffset += metrics.width + 4;
					context.fillStyle = paintForCanvas(context, color, { x: 0, y: 0, width, height }) ?? '#000000';
					context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
				} else {
					const weight = bold ? 'bold' : currentWeight;
					const style = italic ? 'italic' : currentStyle;
					context.font = `${weight} ${style} ${currentFontSize}px ${fontFamily}`;
					context.fillText(segmentText, xOffset, yOffset);
					const metrics = context.measureText(segmentText);
					xOffset += metrics.width;
					context.font = `${currentWeight} ${currentStyle} ${currentFontSize}px ${fontFamily}`;
				}
			}

			yOffset += currentFontSize * 1.4;
		}
	}
}

/**
 * Parse inline markdown styles (bold, italic, code) into segments
 */
function parseInlineStyles(text: string): Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> {
	const segments: Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> = [];

	const codeRegex = /`([^`]+)`/g;
	const parts = [];
	let lastIndex = 0;
	let match;

	while ((match = codeRegex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			parts.push({ text: text.slice(lastIndex, match.index), code: false });
		}
		parts.push({ text: match[1], code: true });
		lastIndex = codeRegex.lastIndex;
	}

	if (lastIndex < text.length) {
		parts.push({ text: text.slice(lastIndex), code: false });
	}

	for (const part of parts) {
		if (part.code) {
			segments.push({ text: part.text, bold: false, italic: false, code: true });
		} else {
			const boldItalicRegex = /(\*\*\*|___)([^*_]+)(\*\*\*|___)|(\*\*|__)([^*_]+)(\*\*|__)|(\*|_)([^*_]+)(\*|_)/g;
			let lastPartIndex = 0;
			let partMatch;

			while ((partMatch = boldItalicRegex.exec(part.text)) !== null) {
				if (partMatch.index > lastPartIndex) {
					segments.push({
						text: part.text.slice(lastPartIndex, partMatch.index),
						bold: false,
						italic: false,
						code: false
					});
				}

				if (partMatch[1]) {
					segments.push({ text: partMatch[2], bold: true, italic: true, code: false });
				} else if (partMatch[4]) {
					segments.push({ text: partMatch[5], bold: true, italic: false, code: false });
				} else if (partMatch[7]) {
					segments.push({ text: partMatch[8], bold: false, italic: true, code: false });
				}

				lastPartIndex = boldItalicRegex.lastIndex;
			}

			if (lastPartIndex < part.text.length) {
				segments.push({ text: part.text.slice(lastPartIndex), bold: false, italic: false, code: false });
			}

			if (segments.length === 0 || lastPartIndex === 0) {
				if (segments.length === 0) {
					segments.push({ text: part.text, bold: false, italic: false, code: false });
				}
			}
		}
	}

	if (segments.length === 0) {
		segments.push({ text, bold: false, italic: false, code: false });
	}

	return segments;
}

/**
 * Wrap text to fit within a given width
 */
function wrapText(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	layoutCache = new LruCache<string, string[]>(512),
	metricCache = new LruCache<string, number>(2_048)
): string[] {
	const cacheKey = `${context.font}\u0000${maxWidth}\u0000${text}`;
	const cached = layoutCache.get(cacheKey);
	if (cached) return cached;
	const lines: string[] = [];
	for (const sourceLine of text.split('\n')) {
		let currentLine = '';
		for (const word of sourceLine.split(' ')) {
			const testLine = currentLine ? `${currentLine} ${word}` : word;
			const widthKey = `${context.font}\u0000${testLine}`;
			let measuredWidth = metricCache.get(widthKey);
			if (measuredWidth === undefined) {
				measuredWidth = context.measureText(testLine).width;
				metricCache.set(widthKey, measuredWidth);
			}

			if (measuredWidth > maxWidth && currentLine) {
				lines.push(currentLine);
				currentLine = word;
			} else {
				currentLine = testLine;
			}
		}
		lines.push(currentLine);
	}

	layoutCache.set(cacheKey, lines);
	return lines;
}
