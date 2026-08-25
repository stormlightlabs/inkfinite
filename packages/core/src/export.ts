import { arrowGeometryForShape, getStrokeOutline, localToWorld, pathGeometryBounds, shapeBoundsForState } from './geom';
import { arrowHeadGeometry, arrowLabelPlacement, arrowShaftGeometry } from './arrow-geometry';
import { paintToSvg } from './paint';
import type { Box2 } from './math';
import { Box2 as Box2Ops } from './math';
import type {
	ArrowShape,
	ContainerShape,
	EllipseShape,
	LineShape,
	MarkdownShape,
	PathGeometry,
	PathShape,
	RectShape,
	ShapeRecord,
	TextShape
} from './model';
import type { EditorState } from './reactivity';
import { getSelectedShapes, getShapesOnCurrentPage } from './reactivity';

export type ExportOptions = {
	/**
	 * Export only selected shapes (default: false - export all)
	 */
	selectedOnly?: boolean;

	/**
	 * Paint an opaque background or preserve transparent pixels in the SVG.
	 * Defaults to an opaque white background for compatibility with file exports.
	 */
	background?: 'white' | 'transparent';

	/**
	 * Include camera transform in the SVG (default: false - export in world coordinates)
	 *
	 * When false, shapes are exported in their natural world coordinates.
	 * When true, the camera transform is baked into the SVG viewBox.
	 */
	includeCamera?: boolean;
};

/**
 * Export the current viewport as a PNG blob.
 *
 * This captures whatever is currently visible on the canvas.
 *
 * @param canvas - The canvas element to export
 * @returns Promise resolving to PNG blob
 */
export async function exportViewportToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('Failed to export canvas to PNG'));
			}
		}, 'image/png');
	});
}

/**
 * Export selected shapes as a PNG blob.
 *
 * This creates a temporary canvas, renders only the selected shapes
 * with their bounds, and exports it as PNG.
 *
 * @param state - Editor state containing shapes
 * @param renderFn - Function to render shapes to a canvas context
 * @returns Promise resolving to PNG blob, or null if no selection
 */
export async function exportSelectionToPNG(
	state: EditorState,
	renderFunction: (context: CanvasRenderingContext2D, shapes: ShapeRecord[], bounds: Box2) => void
): Promise<Blob | null> {
	const shapes = getSelectedShapes(state);
	if (shapes.length === 0) {
		return null;
	}

	const bounds = combineBounds(shapes.map((shape) => exportBounds(state, shape)));
	if (!bounds) {
		return null;
	}

	const padding = 20;
	const width = Box2Ops.width(bounds) + padding * 2;
	const height = Box2Ops.height(bounds) + padding * 2;

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Failed to get 2D context');
	}

	context.fillStyle = 'white';
	context.fillRect(0, 0, width, height);

	context.save();
	context.translate(-bounds.min.x + padding, -bounds.min.y + padding);

	renderFunction(context, shapes, bounds);

	context.restore();

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('Failed to export selection to PNG'));
			}
		}, 'image/png');
	});
}

/**
 * Export shapes to SVG format.
 *
 * By default, shapes are exported in world coordinates (camera transform is NOT applied).
 * Set `includeCamera: true` to bake the camera transform into the SVG viewBox.
 *
 * @param state - Editor state containing shapes and camera
 * @param options - Export options
 * @returns SVG string
 */
export function exportToSVG(state: EditorState, options: ExportOptions = {}): string {
	const shapes = options.selectedOnly ? getExportSelection(state) : getShapesOnCurrentPage(state);

	if (shapes.length === 0) {
		return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
	}

	const bounds = combineBounds(shapes.map((shape) => exportBounds(state, shape)));
	if (!bounds) {
		return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
	}

	const padding = 20;
	const width = Box2Ops.width(bounds) + padding * 2;
	const height = Box2Ops.height(bounds) + padding * 2;
	const offsetX = bounds.min.x - padding;
	const offsetY = bounds.min.y - padding;

	const elements: string[] =
		options.background === 'transparent'
			? []
			: [`<rect x="${offsetX}" y="${offsetY}" width="${width}" height="${height}" fill="white"/>`];
	const definitions: string[] = [];

	for (const shape of shapes) {
		const svg = shapeToSVG(shape, state, definitions);
		if (svg) {
			elements.push(wrapSemanticMetadata(shape, svg));
		}
	}

	const viewBox = `${offsetX} ${offsetY} ${width} ${height}`;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`,
		...(definitions.length > 0 ? [`<defs>${definitions.join('')}</defs>`] : []),
		...elements,
		`</svg>`
	].join('\n');
}

/**
 * Convert a single shape to SVG markup.
 */
function shapeToSVG(shape: ShapeRecord, state: EditorState, definitions: string[]): string | null {
	const transform = `translate(${shape.x},${shape.y})${
		shape.rot === 0 ? '' : ` rotate(${(shape.rot * 180) / Math.PI})`
	}`;

	switch (shape.type) {
		case 'rect': {
			return withSvgEffects(shape, rectToSVG(shape, transform, definitions), transform, definitions);
		}
		case 'ellipse': {
			return withSvgEffects(shape, ellipseToSVG(shape, transform, definitions), transform, definitions);
		}
		case 'line': {
			return withSvgEffects(shape, lineToSVG(shape, transform, definitions), transform, definitions);
		}
		case 'arrow': {
			return withSvgEffects(shape, arrowToSVG(shape, transform, state, definitions), transform, definitions);
		}
		case 'container': {
			return withSvgEffects(shape, containerToSVG(shape, transform, definitions), transform, definitions);
		}
		case 'text': {
			return withSvgEffects(shape, textToSVG(shape, transform, state, definitions), transform, definitions);
		}
		case 'path': {
			return withSvgEffects(shape, pathToSVG(shape, transform, definitions), transform, definitions);
		}
		case 'stroke': {
			return withSvgEffects(shape, strokeToSVG(shape, transform, definitions), transform, definitions);
		}
		case 'image': {
			const asset = state.doc.assets?.[shape.props.assetId];
			if (!asset) return null;
			const { w, h, crop, mask, caption } = shape.props;
			const encoded = encodeBase64(asset.bytes);
			const maskId = `inkfinite-image-mask-${shape.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
			const maskMarkup = mask
				? `<defs><clipPath id="${maskId}">${mask.kind === 'ellipse' ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>` : `<rect width="${w}" height="${h}" rx="${mask.kind === 'rounded' ? Math.min(mask.radius ?? 16, w / 2, h / 2) : 0}"/>`}</clipPath></defs>`
				: '';
			const clip = mask ? ` clip-path="url(#${maskId})"` : '';
			const image = crop
				? `<svg x="0" y="0" width="${w}" height="${h}" viewBox="${crop.left} ${crop.top} ${1 - crop.left - crop.right} ${1 - crop.top - crop.bottom}" preserveAspectRatio="none"${clip}><image width="1" height="1" href="data:${escapeXML(asset.mediaType)};base64,${encoded}"/></svg>`
				: `<image width="${w}" height="${h}" href="data:${escapeXML(asset.mediaType)};base64,${encoded}" preserveAspectRatio="none"${clip}/>`;
			const captionMarkup = caption?.trim()
				? `<text x="8" y="${Math.max(12, h - 6)}" font-family="sans-serif" font-size="12" fill="#ffffff" stroke="#000000" stroke-opacity="0.35">${escapeXML(caption)}</text>`
				: '';
			return withSvgEffects(
				shape,
				`<g transform="${transform}" opacity="${shape.opacity ?? 1}">${maskMarkup}${image}${captionMarkup}</g>`,
				transform,
				definitions
			);
		}
		case 'reference': {
			const { w, h, referenceType, value, label } = shape.props;
			const accent = referenceType === 'url' ? '#2563eb' : referenceType === 'file' ? '#16a34a' : '#7c3aed';
			return withSvgEffects(
				shape,
				`<g transform="${transform}" opacity="${shape.opacity ?? 1}"><rect width="${w}" height="${h}" rx="8" fill="#f8fafc" stroke="${accent}" stroke-width="2"/><text x="12" y="20" font-family="sans-serif" font-size="12" font-weight="600" fill="${accent}">${referenceType.toUpperCase()}</text><text x="12" y="42" font-family="sans-serif" font-size="13" fill="#1f2937">${escapeXML(label || value)}</text></g>`,
				transform,
				definitions
			);
		}
		case 'markdown': {
			return withSvgEffects(shape, markdownToSVG(shape, transform, definitions), transform, definitions);
		}
		default: {
			return null;
		}
	}
}

function withSvgEffects(shape: ShapeRecord, content: string, transform: string, definitions: string[]): string {
	const props = shape.props;
	const safeId = shape.id.replace(/[^a-zA-Z0-9_-]/g, '-');
	const attributes: string[] = [];
	if (props.clipPath) {
		const id = `inkfinite-clip-${safeId}`;
		definitions.push(
			`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${pathGeometryToSVG(props.clipPath)}" transform="${transform}" fill-rule="${props.clipPath.fill_rule}"/></clipPath>`
		);
		attributes.push(`clip-path="url(#${id})"`);
	}
	if (props.maskEffect) {
		const id = `inkfinite-mask-${safeId}`;
		definitions.push(
			`<mask id="${id}" maskUnits="userSpaceOnUse" mask-type="${props.maskEffect.mode}"><path d="${pathGeometryToSVG(props.maskEffect.geometry)}" transform="${transform}" fill="white" fill-opacity="${svgNumber(props.maskEffect.opacity ?? 1)}" fill-rule="${props.maskEffect.geometry.fill_rule}"/></mask>`
		);
		attributes.push(`mask="url(#${id})"`);
	}
	if (props.filter) {
		const id = `inkfinite-filter-${safeId}`;
		const primitives = props.filter.primitives
			.map((primitive, index) => filterPrimitiveToSvg(primitive, index, id))
			.join('');
		definitions.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${primitives}</filter>`);
		attributes.push(`filter="url(#${id})"`);
	}
	return attributes.length > 0 ? `<g ${attributes.join(' ')}>${content}</g>` : content;
}

function filterPrimitiveToSvg(
	primitive: NonNullable<ShapeRecord['props']['filter']>['primitives'][number],
	index: number,
	filterId: string
): string {
	const input = index === 0 ? 'SourceGraphic' : `${filterId}-${index}`;
	const result = `${filterId}-${index + 1}`;
	switch (primitive.type) {
		case 'blur':
			return `<feGaussianBlur in="${input}" stdDeviation="${svgNumber(primitive.radius)}" result="${result}"/>`;
		case 'drop_shadow':
			return `<feDropShadow in="${input}" dx="${svgNumber(primitive.dx)}" dy="${svgNumber(primitive.dy)}" stdDeviation="${svgNumber(primitive.radius)}" flood-color="${escapeXML(primitive.color)}" flood-opacity="${svgNumber(primitive.opacity)}" result="${result}"/>`;
		case 'saturate':
			return `<feColorMatrix in="${input}" type="saturate" values="${svgNumber(primitive.amount)}" result="${result}"/>`;
		case 'hue_rotate':
			return `<feColorMatrix in="${input}" type="hueRotate" values="${svgNumber(primitive.degrees)}" result="${result}"/>`;
		case 'grayscale':
			return `<feColorMatrix in="${input}" type="saturate" values="${svgNumber(1 - primitive.amount)}" result="${result}"/>`;
		case 'brightness':
			return `<feComponentTransfer in="${input}" result="${result}"><feFuncR type="linear" slope="${svgNumber(primitive.amount)}"/><feFuncG type="linear" slope="${svgNumber(primitive.amount)}"/><feFuncB type="linear" slope="${svgNumber(primitive.amount)}"/></feComponentTransfer>`;
		case 'contrast': {
			const intercept = 0.5 - 0.5 * primitive.amount;
			return `<feComponentTransfer in="${input}" result="${result}"><feFuncR type="linear" slope="${svgNumber(primitive.amount)}" intercept="${svgNumber(intercept)}"/><feFuncG type="linear" slope="${svgNumber(primitive.amount)}" intercept="${svgNumber(intercept)}"/><feFuncB type="linear" slope="${svgNumber(primitive.amount)}" intercept="${svgNumber(intercept)}"/></feComponentTransfer>`;
		}
		case 'invert':
			return `<feComponentTransfer in="${input}" result="${result}"><feFuncR type="table" tableValues="${svgNumber(primitive.amount)} ${svgNumber(1 - primitive.amount)}"/><feFuncG type="table" tableValues="${svgNumber(primitive.amount)} ${svgNumber(1 - primitive.amount)}"/><feFuncB type="table" tableValues="${svgNumber(primitive.amount)} ${svgNumber(1 - primitive.amount)}"/></feComponentTransfer>`;
		case 'sepia': {
			const amount = primitive.amount;
			return `<feColorMatrix in="${input}" type="matrix" values="${svgNumber(0.393 + 0.607 * (1 - amount))} ${svgNumber(0.769 - 0.769 * (1 - amount))} ${svgNumber(0.189 - 0.189 * (1 - amount))} 0 0 ${svgNumber(0.349 - 0.349 * (1 - amount))} ${svgNumber(0.686 + 0.314 * (1 - amount))} ${svgNumber(0.168 - 0.168 * (1 - amount))} 0 0 ${svgNumber(0.272 - 0.272 * (1 - amount))} ${svgNumber(0.534 - 0.534 * (1 - amount))} ${svgNumber(0.131 + 0.869 * (1 - amount))} 0 0 0 0 0 1 0" result="${result}"/>`;
		}
		case 'opacity':
			return `<feComponentTransfer in="${input}" result="${result}"><feFuncA type="linear" slope="${svgNumber(primitive.amount)}"/></feComponentTransfer>`;
	}
}

function rectToSVG(shape: RectShape, transform: string, definitions: string[]): string {
	const { w, h, fill, stroke, radius } = shape.props;
	const fillAttribute = `fill="${paintToSvg(fill, `${shape.id}-fill`, definitions)}"`;
	const strokeAttribute = stroke
		? `stroke="${paintToSvg(stroke, `${shape.id}-stroke`, definitions)}" stroke-width="2"`
		: '';
	const radiusAttribute = radius > 0 ? `rx="${radius}" ry="${radius}"` : '';

	return `<rect transform="${transform}" width="${w}" height="${h}" ${fillAttribute} ${strokeAttribute} ${radiusAttribute}/>`;
}

function ellipseToSVG(shape: EllipseShape, transform: string, definitions: string[]): string {
	const { w, h, fill, stroke } = shape.props;
	const cx = w / 2;
	const cy = h / 2;
	const rx = w / 2;
	const ry = h / 2;
	const fillAttribute = `fill="${paintToSvg(fill, `${shape.id}-fill`, definitions)}"`;
	const strokeAttribute = stroke
		? `stroke="${paintToSvg(stroke, `${shape.id}-stroke`, definitions)}" stroke-width="2"`
		: '';

	return `<ellipse transform="${transform}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${fillAttribute} ${strokeAttribute}/>`;
}

function lineToSVG(shape: LineShape, transform: string, definitions: string[]): string {
	const { a, b, stroke, width } = shape.props;

	return `<line transform="${transform}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${paintToSvg(
		stroke,
		`${shape.id}-stroke`,
		definitions
	)}" stroke-width="${width}"/>`;
}

function arrowToSVG(shape: ArrowShape, transform: string, state: EditorState, definitions: string[]): string {
	const geometry = arrowGeometryForShape(state, shape);
	if (!geometry) return '';
	const stroke = paintToSvg(shape.props.style.stroke, `${shape.id}-stroke`, definitions);
	const width = svgNumber(shape.props.style.width);
	const shaft = arrowShaftGeometry(geometry.path, shape.props.style);
	const elements = pathGeometryIsPolyline(shaft)
		? pathGeometryToLines(shaft, stroke, width)
		: [`<path d="${pathGeometryToSVG(shaft)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`];

	const head = (atStart: boolean) => {
		const resolved = arrowHeadGeometry(geometry.path, atStart);
		if (!resolved) return;
		const headStyle = atStart ? shape.props.style.headStartStyle : shape.props.style.headEndStyle;
		const points = `M ${svgNumber(resolved.tip.x)} ${svgNumber(resolved.tip.y)} L ${svgNumber(resolved.left.x)} ${svgNumber(resolved.left.y)} L ${svgNumber(resolved.right.x)} ${svgNumber(resolved.right.y)}`;
		elements.push(
			headStyle === 'triangle'
				? `<path d="${points} Z" fill="${stroke}" stroke="${stroke}" stroke-width="${width}"/>`
				: `<path d="M ${svgNumber(resolved.tip.x)} ${svgNumber(resolved.tip.y)} L ${svgNumber(resolved.left.x)} ${svgNumber(resolved.left.y)} M ${svgNumber(resolved.tip.x)} ${svgNumber(resolved.tip.y)} L ${svgNumber(resolved.right.x)} ${svgNumber(resolved.right.y)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`
		);
	};

	if (shape.props.style.headEnd !== false) head(false);
	if (shape.props.style.headStart) head(true);

	const label = shape.props.label;
	if (label?.text) {
		const placement = arrowLabelPlacement(geometry.path, label);
		if (placement) {
			elements.push(
				`<text x="${svgNumber(placement.point.x)}" y="${svgNumber(placement.point.y)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="14" fill="${stroke}">${escapeXML(label.text)}</text>`
			);
		}
	}
	return `<g transform="${transform}">${elements.join('')}</g>`;
}

function pathGeometryIsPolyline(geometry: PathGeometry): boolean {
	return geometry.subpaths.every((subpath) =>
		subpath.segments.every((segment) => segment.type === 'move' || segment.type === 'line')
	);
}

function pathGeometryToLines(geometry: PathGeometry, stroke: string, width: string): string[] {
	return geometry.subpaths.flatMap((subpath) => {
		const first = subpath.segments[0];
		if (!first || first.type !== 'move') return [];
		let from = first.to;
		return subpath.segments.slice(1).flatMap((segment) => {
			if (segment.type !== 'line') return [];
			const line = `<line x1="${svgNumber(from.x)}" y1="${svgNumber(from.y)}" x2="${svgNumber(segment.to.x)}" y2="${svgNumber(segment.to.y)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
			from = segment.to;
			return [line];
		});
	});
}

function pathGeometryToSVG(geometry: PathGeometry): string {
	return geometry.subpaths
		.flatMap((subpath) =>
			subpath.segments.map((segment) => {
				switch (segment.type) {
					case 'move':
						return `M ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
					case 'line':
						return `L ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
					case 'quadratic':
						return `Q ${svgNumber(segment.control.x)} ${svgNumber(segment.control.y)} ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
					case 'cubic':
						return `C ${svgNumber(segment.control_1.x)} ${svgNumber(segment.control_1.y)} ${svgNumber(segment.control_2.x)} ${svgNumber(segment.control_2.y)} ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
				}
			})
		)
		.join(' ');
}

function wrapSemanticMetadata(shape: ShapeRecord, content: string): string {
	const metadata = shape.metadata;
	if (!metadata) return content;
	const attributes = [
		metadata.name ? ` data-name="${escapeXML(metadata.name)}"` : '',
		metadata.title ? ` data-card-title="${escapeXML(metadata.title)}"` : '',
		metadata.body ? ` data-card-body="${escapeXML(metadata.body)}"` : '',
		metadata.role ? ` data-role="${escapeXML(metadata.role)}"` : '',
		metadata.description ? ` data-description="${escapeXML(metadata.description)}"` : '',
		metadata.tags.length > 0 ? ` data-tags="${escapeXML(metadata.tags.join(','))}"` : '',
		metadata.source ? ` data-source="${escapeXML(metadata.source)}"` : '',
		metadata.link ? ` data-link="${escapeXML(metadata.link)}"` : '',
		Object.keys(metadata.customMetadata).length > 0
			? ` data-metadata="${escapeXML(JSON.stringify(metadata.customMetadata) ?? '')}"`
			: ''
	].join('');
	return `<g data-shape-id="${escapeXML(shape.id)}"${attributes}>${content}</g>`;
}

function containerToSVG(shape: ContainerShape, transform: string, definitions: string[]): string {
	const { w = 0, h = 0, title, fill, stroke, radius = 0 } = shape.props;
	const fillValue = paintToSvg(fill, `${shape.id}-fill`, definitions);
	const strokeValue = paintToSvg(stroke, `${shape.id}-stroke`, definitions);
	const elements = [
		`<rect transform="${transform}" width="${svgNumber(w)}" height="${svgNumber(h)}" rx="${svgNumber(Math.min(radius, w / 2, h / 2))}" fill="${fillValue}" stroke="${strokeValue}"/>`
	];
	if (title)
		elements.push(
			`<text transform="${transform}" x="8" y="18" font-family="sans-serif" font-size="14" font-weight="600" fill="${strokeValue === 'none' ? '#69717d' : strokeValue}">${escapeXML(title)}</text>`
		);
	return elements.join('');
}

function textToSVG(shape: TextShape, transform: string, state: EditorState, definitions: string[]): string {
	const { text, fontSize, fontFamily, color, textPath } = shape.props;
	const fill = paintToSvg(color, `${shape.id}-fill`, definitions);
	if (!textPath) {
		return `<text transform="${transform}" font-size="${fontSize}" font-family="${escapeXML(fontFamily)}" fill="${fill}">${escapeXML(text)}</text>`;
	}
	const path = state.doc.shapes[textPath.pathId];
	if (!path || path.type !== 'path') {
		return `<text transform="${transform}" font-size="${fontSize}" font-family="${escapeXML(fontFamily)}" fill="${fill}">${escapeXML(text)}</text>`;
	}
	const basePathId = `inkfinite-path-${path.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
	const pathId = textPath.direction === 'reverse' ? `${basePathId}-reverse` : basePathId;
	if (textPath.direction === 'reverse' && !definitions.some((definition) => definition.includes(`id="${pathId}"`))) {
		definitions.push(
			`<path id="${pathId}" d="${pathGeometryToSVG(reversePathGeometry(path.props))}" transform="${shapeTransformToSvg(path)}" fill="none" stroke="none"/>`
		);
	}
	const anchor = textPath.align === 'center' ? 'middle' : textPath.align;
	return `<text font-size="${fontSize}" font-family="${escapeXML(fontFamily)}" fill="${fill}"><textPath href="#${pathId}" startOffset="${svgNumber(textPath.offset)}" text-anchor="${anchor}" side="${textPath.side}" direction="${textPath.direction === 'reverse' ? 'rtl' : 'ltr'}">${escapeXML(text)}</textPath></text>`;
}

function shapeTransformToSvg(shape: ShapeRecord): string {
	return `translate(${svgNumber(shape.x)},${svgNumber(shape.y)})${shape.rot === 0 ? '' : ` rotate(${svgNumber((shape.rot * 180) / Math.PI)})`}`;
}

function reversePathGeometry(geometry: PathGeometry): PathGeometry {
	return {
		...geometry,
		subpaths: geometry.subpaths.map((subpath) => {
			const first = subpath.segments[0];
			if (!first || first.type !== 'move' || subpath.segments.length < 2) return { ...subpath };
			const points = subpath.segments.map((segment) => segment.to);
			const segments: PathGeometry['subpaths'][number]['segments'] = [{ type: 'move', to: points.at(-1)! }];
			for (let index = subpath.segments.length - 1; index >= 1; index -= 1) {
				const segment = subpath.segments[index]!;
				const to = points[index - 1]!;
				if (segment.type === 'line') segments.push({ type: 'line', to });
				else if (segment.type === 'quadratic')
					segments.push({ type: 'quadratic', control: segment.control, to });
				else if (segment.type === 'cubic')
					segments.push({ type: 'cubic', control_1: segment.control_2, control_2: segment.control_1, to });
			}
			return { ...subpath, segments };
		})
	};
}

function strokeToSVG(
	shape: Extract<ShapeRecord, { type: 'stroke' }>,
	transform: string,
	definitions: string[]
): string {
	const outline = getStrokeOutline(shape);
	if (outline.length === 0) return '';
	const commands = outline
		.map((point, index) => `${index === 0 ? 'M' : 'L'} ${svgNumber(point.x)} ${svgNumber(point.y)}`)
		.join(' ');
	const fill = paintToSvg(shape.props.style.color, `${shape.id}-stroke`, definitions);
	const opacity = svgNumber(shape.strokeOpacity ?? shape.props.style.opacity);
	return `<path transform="${transform}" d="${commands} Z" fill="${fill}" fill-opacity="${opacity}" stroke="none"/>`;
}

function pathToSVG(shape: PathShape, transform: string, definitions: string[]): string {
	const commands = shape.props.subpaths
		.map((subpath) => {
			const segments = subpath.segments.map((segment) => {
				switch (segment.type) {
					case 'move':
						return `M ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
					case 'line':
						return `L ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
					case 'quadratic':
						return `Q ${svgNumber(segment.control.x)} ${svgNumber(segment.control.y)} ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
					case 'cubic':
						return `C ${svgNumber(segment.control_1.x)} ${svgNumber(segment.control_1.y)} ${svgNumber(segment.control_2.x)} ${svgNumber(segment.control_2.y)} ${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`;
				}
			});
			if (subpath.closed) segments.push('Z');
			return segments.join(' ');
		})
		.join(' ');
	const fill = paintToSvg(shape.props.fill, `${shape.id}-fill`, definitions);
	const stroke = shape.props.stroke
		? ` stroke="${paintToSvg(shape.props.stroke, `${shape.id}-stroke`, definitions)}" stroke-width="${svgNumber(shape.props.stroke_width ?? 2)}"`
		: '';
	const id = `inkfinite-path-${shape.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
	return `<path id="${id}" transform="${transform}" d="${commands}" fill="${fill}" fill-rule="${shape.props.fill_rule}"${stroke}/>`;
}

function svgNumber(value: number): string {
	if (Object.is(value, -0) || value === 0) return '0';
	return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Export markdown shape as SVG foreignObject
 *
 * Uses foreignObject to embed HTML for markdown rendering.
 *
 * For broader interoperability, the markdown is exported as plain text with basic formatting preserved.
 */
function markdownToSVG(shape: MarkdownShape, transform: string, definitions: string[]): string {
	const { md, w, h, fontSize, fontFamily, color, bg, border } = shape.props;
	const width = w;
	const height = h ?? fontSize * 10;

	const bgStyle = `background: ${paintToSvg(bg, `${shape.id}-background`, definitions)};`;
	const borderStyle = border ? `border: 1px solid ${paintToSvg(border, `${shape.id}-border`, definitions)};` : '';

	const escapedMarkdown = escapeXML(md);

	return [
		`<foreignObject transform="${transform}" width="${width}" height="${height}">`,
		`  <div xmlns="http://www.w3.org/1999/xhtml" style="${bgStyle}${borderStyle} padding: 8px; font-size: ${fontSize}px; font-family: ${escapeXML(
			fontFamily
		)}; color: ${paintToSvg(
			color,
			`${shape.id}-fill`,
			definitions
		)}; width: 100%; height: 100%; overflow: auto; white-space: pre-wrap; box-sizing: border-box;">`,
		`    ${escapedMarkdown}`,
		`  </div>`,
		`</foreignObject>`
	].join('\n');
}

function encodeBase64(bytes: number[]): string {
	if (typeof btoa !== 'function') return '';
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * Escape special XML characters in strings.
 */
function escapeXML(string_: string): string {
	return string_
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function exportBounds(state: EditorState, shape: ShapeRecord): Box2 {
	if (shape.type !== 'arrow') return shapeBoundsForState(state, shape);
	const geometry = arrowGeometryForShape(state, shape);
	if (!geometry) return shapeBoundsForState(state, shape);
	const bounds = pathGeometryBounds(geometry.path);
	const points = [bounds.min, { x: bounds.max.x, y: bounds.min.y }, bounds.max, { x: bounds.min.x, y: bounds.max.y }];
	if (shape.props.style.headEnd !== false) {
		const head = arrowHeadGeometry(geometry.path, false);
		if (head) points.push(head.tip, head.left, head.right);
	}
	if (shape.props.style.headStart) {
		const head = arrowHeadGeometry(geometry.path, true);
		if (head) points.push(head.tip, head.left, head.right);
	}
	if (shape.props.label?.text) {
		const placement = arrowLabelPlacement(geometry.path, shape.props.label);
		if (placement) {
			const halfWidth = (shape.props.label.text.length * 7 + 8) / 2;
			points.push(
				{ x: placement.point.x - halfWidth, y: placement.point.y - 9 },
				{ x: placement.point.x + halfWidth, y: placement.point.y - 9 },
				{ x: placement.point.x - halfWidth, y: placement.point.y + 9 },
				{ x: placement.point.x + halfWidth, y: placement.point.y + 9 }
			);
		}
	}
	return Box2Ops.fromPoints(points.map((point) => localToWorld(shape, point)));
}

function getExportSelection(state: EditorState): ShapeRecord[] {
	const selected = new Set(state.ui.selectionIds);
	for (const shape of getShapesOnCurrentPage(state)) {
		if (shape.type === 'text' && shape.props.textPath && selected.has(shape.id))
			selected.add(shape.props.textPath.pathId);
	}
	return getShapesOnCurrentPage(state).filter(
		(shape) => selected.has(shape.id) || hasSelectedAncestor(shape, selected, state)
	);
}

function hasSelectedAncestor(shape: ShapeRecord, selected: ReadonlySet<string>, state: EditorState): boolean {
	let parentId = shape.groupId;
	while (parentId) {
		if (selected.has(parentId)) return true;
		parentId = state.doc.shapes[parentId]?.groupId;
	}
	return false;
}

/**
 * Combine multiple bounding boxes into a single bounding box.
 */
function combineBounds(boxes: Box2[]): Box2 | null {
	if (boxes.length === 0) {
		return null;
	}

	let combined = Box2Ops.clone(boxes[0]);
	for (let index = 1; index < boxes.length; index++) {
		const box = boxes[index];
		combined = {
			min: { x: Math.min(combined.min.x, box.min.x), y: Math.min(combined.min.y, box.min.y) },
			max: { x: Math.max(combined.max.x, box.max.x), y: Math.max(combined.max.y, box.max.y) }
		};
	}
	return combined;
}
