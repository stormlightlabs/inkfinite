import { ShapeRecord, type Document, type PathSegment, type PathSubpath, type ShapeRecord as Shape } from '../model';
import type { InterchangeImport } from '../interchange';
import { addShape, blankSnapshot, WarningCollector } from './shared';

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type Point = { x: number; y: number };
type SvgStyle = {
	fill: string;
	stroke: string;
	strokeWidth: number;
	fillRule: 'nonzero' | 'evenodd';
	opacity: number;
	fillOpacity: number;
	strokeOpacity: number;
	fontSize: number;
	fontFamily: string;
};

type SvgContext = {
	pageId: string;
	layerId: string;
	document: Document;
	warnings: WarningCollector;
	ids: Set<string>;
	shapeIndex: number;
};

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const DEFAULT_STYLE: SvgStyle = {
	fill: '#000000',
	stroke: 'none',
	strokeWidth: 1,
	fillRule: 'nonzero',
	opacity: 1,
	fillOpacity: 1,
	strokeOpacity: 1,
	fontSize: 16,
	fontFamily: 'sans-serif'
};

/** Imports the supported static SVG subset into the browser document model. */
export function importSvg(root: string, fileName: string): InterchangeImport {
	if (new TextEncoder().encode(root).byteLength > 16 * 1024 * 1024) {
		throw new Error('The selected file is larger than the 16 MB import limit.');
	}
	if (typeof DOMParser === 'undefined') throw new Error('SVG import is only available in a browser.');
	const xml = new DOMParser().parseFromString(root, 'image/svg+xml');
	if (xml.querySelector('parsererror')) throw new Error('The selected SVG is malformed.');
	const svg = xml.documentElement;
	if (svg.localName !== 'svg') throw new Error('The selected file does not have an <svg> root.');

	const { snapshot, pageId, layerId } = blankSnapshot(fileName);
	const warnings = new WarningCollector();
	warnings.add('svg-source-asset', 'The browser document model does not retain the original SVG source asset.');
	const context: SvgContext = { pageId, layerId, document: snapshot.doc, warnings, ids: new Set(), shapeIndex: 0 };
	walk(svg, IDENTITY, DEFAULT_STYLE, context, true);
	return { format: 'svg', snapshot, warnings: warnings.values() };
}

function walk(element: Element, parentMatrix: Matrix, parentStyle: SvgStyle, context: SvgContext, isRoot = false) {
	const tag = element.localName;
	const style = readStyle(element, parentStyle);
	let matrix: Matrix;
	try {
		matrix = multiply(parentMatrix, parseTransform(element.getAttribute('transform')));
	} catch (error) {
		context.warnings.add('svg-transform', `A transform on <${tag}> was skipped: ${String(error)}.`);
		matrix = parentMatrix;
	}

	if (!isRoot && ['script', 'style', 'animate', 'animateMotion', 'animateTransform', 'set'].includes(tag)) {
		context.warnings.add('svg-active-content', `The <${tag}> element was omitted.`);
		return;
	}
	if (
		!isRoot &&
		['defs', 'linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter'].includes(tag)
	) {
		context.warnings.add('svg-unsupported-feature', `The <${tag}> definition was omitted.`);
		return;
	}
	if (!isRoot && ['g', 'svg'].includes(tag)) {
		if (tag === 'g')
			context.warnings.add('svg-group-flattened', 'SVG groups were flattened into native shape coordinates.');
		for (const child of Array.from(element.children)) walk(child, matrix, style, context);
		return;
	}
	if (!isRoot) {
		try {
			const shape = shapeFromElement(element, matrix, style, context);
			if (shape) addShape(context.document, context.pageId, context.layerId, shape);
		} catch (error) {
			context.warnings.add('svg-element', `The <${tag}> element was omitted: ${String(error)}.`);
		}
	}
	if (tag === 'svg' || tag === 'g') {
		for (const child of Array.from(element.children)) walk(child, matrix, style, context);
	}
}

function shapeFromElement(element: Element, matrix: Matrix, style: SvgStyle, context: SvgContext): Shape | null {
	const tag = element.localName;
	const id = nextId(element.getAttribute('id'), context);
	const transform = decompose(matrix);
	const opacity = style.opacity;
	const fillOpacity = style.fillOpacity * opacity;
	const strokeOpacity = style.strokeOpacity * opacity;

	switch (tag) {
		case 'rect': {
			const width = nonNegativeNumber(element, 'width', 0);
			const height = nonNegativeNumber(element, 'height', 0);
			const rectTransform = decompose(
				multiply(matrix, translation(number(element, 'x', 0), number(element, 'y', 0)))
			);
			const props = {
				w: width * Math.abs(rectTransform.scaleX),
				h: height * Math.abs(rectTransform.scaleY),
				fill: style.fill,
				stroke: style.stroke,
				radius: Math.max(0, number(element, 'rx', number(element, 'ry', 0)))
			};
			return withStyle(
				ShapeRecord.createRect(context.pageId, rectTransform.x, rectTransform.y, props, id),
				opacity,
				fillOpacity,
				strokeOpacity,
				rectTransform.rotation
			);
		}
		case 'circle':
		case 'ellipse': {
			const rx = tag === 'circle' ? nonNegativeNumber(element, 'r', 0) : nonNegativeNumber(element, 'rx', 0);
			const ry = tag === 'circle' ? rx : nonNegativeNumber(element, 'ry', 0);
			const ellipseTransform = decompose(
				multiply(matrix, translation(number(element, 'cx', 0) - rx, number(element, 'cy', 0) - ry))
			);
			const props = {
				w: rx * 2 * Math.abs(ellipseTransform.scaleX),
				h: ry * 2 * Math.abs(ellipseTransform.scaleY),
				fill: style.fill,
				stroke: style.stroke
			};
			return withStyle(
				ShapeRecord.createEllipse(context.pageId, ellipseTransform.x, ellipseTransform.y, props, id),
				opacity,
				fillOpacity,
				strokeOpacity,
				ellipseTransform.rotation
			);
		}
		case 'line': {
			const start = apply(matrix, { x: number(element, 'x1', 0), y: number(element, 'y1', 0) });
			const end = apply(matrix, { x: number(element, 'x2', 0), y: number(element, 'y2', 0) });
			const props = {
				a: { x: 0, y: 0 },
				b: { x: end.x - start.x, y: end.y - start.y },
				stroke: style.stroke,
				width: style.strokeWidth
			};
			return withStyle(
				ShapeRecord.createLine(context.pageId, start.x, start.y, props, id),
				opacity,
				1,
				strokeOpacity,
				0
			);
		}
		case 'polygon':
		case 'polyline': {
			const points = parsePoints(element.getAttribute('points') ?? '').map((point) => apply(matrix, point));
			if (points.length < (tag === 'polygon' ? 3 : 2)) throw new Error('the points attribute has too few points');
			const segments: PathSegment[] = [
				{ type: 'move', to: points[0] },
				...points.slice(1).map((to) => ({ type: 'line', to }) satisfies PathSegment)
			];
			return withStyle(
				ShapeRecord.createPath(
					context.pageId,
					0,
					0,
					{
						subpaths: [{ segments, closed: tag === 'polygon' }],
						fill_rule: style.fillRule,
						fill: style.fill,
						stroke: style.stroke,
						stroke_width: style.strokeWidth
					},
					id
				),
				opacity,
				fillOpacity,
				strokeOpacity,
				0
			);
		}
		case 'path': {
			const geometry = parsePath(element.getAttribute('d') ?? '').map((subpath) => ({
				...subpath,
				segments: subpath.segments.map((segment) => transformSegment(segment, matrix))
			}));
			if (!geometry.length) throw new Error('the path has no segments');
			return withStyle(
				ShapeRecord.createPath(
					context.pageId,
					0,
					0,
					{
						subpaths: geometry,
						fill_rule: style.fillRule,
						fill: style.fill,
						stroke: style.stroke,
						stroke_width: style.strokeWidth
					},
					id
				),
				opacity,
				fillOpacity,
				strokeOpacity,
				0
			);
		}
		case 'text': {
			const point = apply(matrix, { x: number(element, 'x', 0), y: number(element, 'y', 0) });
			return withStyle(
				ShapeRecord.createText(
					context.pageId,
					point.x,
					point.y,
					{
						text: element.textContent ?? '',
						fontSize: style.fontSize,
						fontFamily: style.fontFamily,
						color: style.fill
					},
					id
				),
				opacity,
				fillOpacity,
				strokeOpacity,
				transform.rotation
			);
		}
		case 'image':
			context.warnings.add('svg-image', 'Embedded image nodes are not available in the browser document model.');
			return null;
		default:
			context.warnings.add('svg-element', `The <${tag}> element is not supported.`);
			return null;
	}
}

function withStyle<T extends Shape>(
	shape: T,
	opacity: number,
	fillOpacity: number,
	strokeOpacity: number,
	rotation: number
): T {
	return { ...shape, rot: rotation, opacity, fillOpacity, strokeOpacity };
}

function readStyle(element: Element, parent: SvgStyle): SvgStyle {
	const style = { ...parent };
	const declarations = new Map<string, string>();
	for (const name of [
		'fill',
		'stroke',
		'stroke-width',
		'fill-rule',
		'opacity',
		'fill-opacity',
		'stroke-opacity',
		'font-size',
		'font-family'
	]) {
		const value = element.getAttribute(name);
		if (value !== null) declarations.set(name, value);
	}
	for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
		const [name, value] = declaration.split(':', 2).map((part) => part?.trim());
		if (name && value) declarations.set(name, value);
	}
	if (declarations.has('fill')) style.fill = paint(declarations.get('fill')!);
	if (declarations.has('stroke')) style.stroke = paint(declarations.get('stroke')!);
	if (declarations.has('stroke-width'))
		style.strokeWidth = finite(declarations.get('stroke-width')!.replace(/px$/, ''), 'stroke-width');
	if (declarations.has('fill-rule'))
		style.fillRule = declarations.get('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero';
	if (declarations.has('opacity')) style.opacity *= clampOpacity(declarations.get('opacity')!);
	if (declarations.has('fill-opacity')) style.fillOpacity *= clampOpacity(declarations.get('fill-opacity')!);
	if (declarations.has('stroke-opacity')) style.strokeOpacity *= clampOpacity(declarations.get('stroke-opacity')!);
	if (declarations.has('font-size'))
		style.fontSize = finite(declarations.get('font-size')!.replace(/px$/, ''), 'font-size');
	if (declarations.has('font-family')) style.fontFamily = declarations.get('font-family')!.split(',')[0].trim();
	return style;
}

function paint(value: string) {
	const normalized = value.trim();
	return normalized === 'none' || normalized === 'transparent' || normalized.startsWith('url(') ? 'none' : normalized;
}

function number(element: Element, attribute: string, fallback: number): number {
	const value = element.getAttribute(attribute);
	return value === null || value.trim() === '' ? fallback : finite(value.replace(/px$/, ''), attribute);
}

function nonNegativeNumber(element: Element, attribute: string, fallback: number): number {
	const value = number(element, attribute, fallback);
	if (value < 0) throw new Error(`${attribute} must not be negative`);
	return value;
}

function finite(value: string, name: string) {
	const parsed = Number(value.trim());
	if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
	return parsed;
}

function clampOpacity(value: string) {
	return Math.min(1, Math.max(0, finite(value, 'opacity')));
}

function nextId(sourceId: string | null, context: SvgContext) {
	const base = sourceId?.trim() ? `svg:${sourceId.trim()}` : `svg:shape:${context.shapeIndex}`;
	context.shapeIndex += 1;
	let id = base;
	let suffix = 2;
	while (context.ids.has(id)) id = `${base}:${suffix++}`;
	context.ids.add(id);
	return id;
}

function parsePoints(value: string): Point[] {
	const values = value
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean)
		.map((item) => finite(item, 'points'));
	if (values.length % 2 !== 0) throw new Error('points must contain x/y pairs');
	const points: Point[] = [];
	for (let index = 0; index < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
	return points;
}

function parseTransform(value: string | null): Matrix {
	if (!value?.trim()) return IDENTITY;
	let result = IDENTITY;
	const pattern = /([a-z]+)\s*\(([^)]*)\)/gi;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(value))) {
		const values = match[2]
			.split(/[\s,]+/)
			.filter(Boolean)
			.map((item) => finite(item, 'transform'));
		let local: Matrix;
		switch (match[1].toLowerCase()) {
			case 'translate':
				local = { ...IDENTITY, e: values[0] ?? 0, f: values[1] ?? 0 };
				break;
			case 'scale':
				local = { a: values[0] ?? 1, b: 0, c: 0, d: values[1] ?? values[0] ?? 1, e: 0, f: 0 };
				break;
			case 'rotate': {
				const angle = ((values[0] ?? 0) * Math.PI) / 180;
				local = { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 0, f: 0 };
				break;
			}
			case 'matrix':
				if (values.length !== 6) throw new Error('matrix requires six values');
				local = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
				break;
			default:
				throw new Error(`${match[1]} transforms are not supported`);
		}
		result = multiply(result, local);
	}
	return result;
}

function multiply(left: Matrix, right: Matrix): Matrix {
	return {
		a: left.a * right.a + left.c * right.b,
		b: left.b * right.a + left.d * right.b,
		c: left.a * right.c + left.c * right.d,
		d: left.b * right.c + left.d * right.d,
		e: left.a * right.e + left.c * right.f + left.e,
		f: left.b * right.e + left.d * right.f + left.f
	};
}

function translation(x: number, y: number): Matrix {
	return { ...IDENTITY, e: x, f: y };
}

function apply(matrix: Matrix, point: Point): Point {
	return {
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f
	};
}

function decompose(matrix: Matrix) {
	const scaleX = Math.hypot(matrix.a, matrix.b) || 1;
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	const scaleY = determinant / scaleX || 1;
	return { x: matrix.e, y: matrix.f, rotation: Math.atan2(matrix.b, matrix.a), scaleX, scaleY };
}

function transformSegment(segment: PathSegment, matrix: Matrix): PathSegment {
	if (segment.type === 'move' || segment.type === 'line') return { ...segment, to: apply(matrix, segment.to) };
	if (segment.type === 'quadratic')
		return { ...segment, control: apply(matrix, segment.control), to: apply(matrix, segment.to) };
	return {
		...segment,
		control_1: apply(matrix, segment.control_1),
		control_2: apply(matrix, segment.control_2),
		to: apply(matrix, segment.to)
	};
}

function parsePath(value: string): PathSubpath[] {
	const tokens = value.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
	let index = 0;
	let command = '';
	let current: Point = { x: 0, y: 0 };
	let start: Point = { x: 0, y: 0 };
	let lastCubic: Point | null = null;
	let lastQuadratic: Point | null = null;
	const subpaths: PathSubpath[] = [];
	let active: PathSubpath | null = null;
	const isCommand = (token: string) => /^[a-zA-Z]$/.test(token);
	const read = () => {
		if (index >= tokens.length || isCommand(tokens[index]))
			throw new Error('path command has incomplete parameters');
		return finite(tokens[index++], 'path');
	};
	while (index < tokens.length) {
		if (isCommand(tokens[index])) command = tokens[index++];
		if (!command) throw new Error('path data must begin with a command');
		const relative = command === command.toLowerCase();
		const type = command.toUpperCase();
		if (type === 'Z') {
			if (!active) throw new Error('close command has no subpath');
			active.closed = true;
			current = start;
			lastCubic = null;
			lastQuadratic = null;
			command = '';
			continue;
		}
		const point = (x: number, y: number): Point => (relative ? { x: current.x + x, y: current.y + y } : { x, y });
		if (type === 'M') {
			const next = point(read(), read());
			active = { segments: [{ type: 'move', to: next }], closed: false };
			subpaths.push(active);
			current = start = next;
			lastCubic = lastQuadratic = null;
			command = relative ? 'l' : 'L';
			continue;
		}
		if (!active) throw new Error('path segment has no move command');
		switch (type) {
			case 'L':
				current = point(read(), read());
				active.segments.push({ type: 'line', to: current });
				lastCubic = lastQuadratic = null;
				break;
			case 'H': {
				const value = read();
				current = { x: relative ? current.x + value : value, y: current.y };
				active.segments.push({ type: 'line', to: current });
				lastCubic = lastQuadratic = null;
				break;
			}
			case 'V': {
				const value = read();
				current = { x: current.x, y: relative ? current.y + value : value };
				active.segments.push({ type: 'line', to: current });
				lastCubic = lastQuadratic = null;
				break;
			}
			case 'C': {
				const control1 = point(read(), read());
				const control2 = point(read(), read());
				current = point(read(), read());
				active.segments.push({ type: 'cubic', control_1: control1, control_2: control2, to: current });
				lastCubic = control2;
				lastQuadratic = null;
				break;
			}
			case 'S': {
				const control1 = lastCubic
					? { x: current.x * 2 - lastCubic.x, y: current.y * 2 - lastCubic.y }
					: current;
				const control2 = point(read(), read());
				current = point(read(), read());
				active.segments.push({ type: 'cubic', control_1: control1, control_2: control2, to: current });
				lastCubic = control2;
				lastQuadratic = null;
				break;
			}
			case 'Q': {
				const control: Point = point(read(), read());
				current = point(read(), read());
				active.segments.push({ type: 'quadratic', control, to: current });
				lastQuadratic = control;
				lastCubic = null;
				break;
			}
			case 'T': {
				const control: Point = lastQuadratic
					? { x: current.x * 2 - lastQuadratic.x, y: current.y * 2 - lastQuadratic.y }
					: current;
				current = point(read(), read());
				active.segments.push({ type: 'quadratic', control, to: current });
				lastQuadratic = control;
				lastCubic = null;
				break;
			}
			case 'A':
				throw new Error('arc commands are not supported in the browser importer');
			default:
				throw new Error(`the ${type} command is not supported`);
		}
	}
	return subpaths;
}
