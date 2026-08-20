import type { SvgAsset, SvgGroup, SvgImport, SvgImportWarning, SvgShape } from '@inkfinite/bindings/svg-import';
import type { Transform } from '@inkfinite/bindings/model';
import {
	ShapeRecord,
	type Document,
	type ImportedGroup,
	type PathGeometry,
	type PathSegment,
	type ShapeRecord as Shape
} from '../model';
import type { InterchangeImport } from '../interchange';
import { addShape, blankSnapshot, WarningCollector } from './shared';

/** A source accepted by the browser WASM importer. */
export type SvgImportSource = string | Uint8Array;

/** Imports the normalized result produced by Rust into the browser document model. */
export function projectSvgImport(imported: SvgImportResult, fileName: string): InterchangeImport {
	const { snapshot, pageId, layerId } = blankSnapshot(fileName);
	const warnings = new WarningCollector();
	const assets = [imported.source_asset, ...imported.assets];
	snapshot.doc.assets = Object.fromEntries(assets.map((asset) => [asset.id, assetRecord(asset)]));

	const context: ProjectionContext = {
		pageId,
		layerId,
		document: snapshot.doc,
		warnings,
		ids: new Set(),
		shapeIndex: 0,
		groupIndex: 0,
		groups: {}
	};
	walkGroup(imported.root, IDENTITY, '', 1, context);
	snapshot.doc.svgGroups = context.groups;
	if (imported.omitted_image_count > 0) {
		warnings.add(
			'svg-images-omitted',
			'Embedded image nodes were retained as assets but omitted because image shapes are not available yet.',
			imported.omitted_image_count
		);
	}
	for (const warning of imported.warnings) addSvgWarning(warnings, warning);

	return { format: 'svg', snapshot, warnings: warnings.values() };
}

/** Normalized SVG result supplied by the generated Rust/WASM bindings. */
export type SvgImportResult = SvgImport & { omitted_image_count: number };

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type Point = { x: number; y: number };
type ProjectionContext = {
	pageId: string;
	layerId: string;
	document: Document;
	warnings: WarningCollector;
	ids: Set<string>;
	shapeIndex: number;
	groupIndex: number;
	groups: Record<string, ImportedGroup>;
};

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function walkGroup(
	group: SvgGroup,
	parentMatrix: Matrix,
	groupPath: string,
	parentOpacity: number,
	context: ProjectionContext
) {
	const matrix = multiply(parentMatrix, transformMatrix(group.transform));
	const opacity = parentOpacity * group.style.opacity;
	const groupId = groupPath ? `svg:group:${groupPath}` : 'svg:group:root';
	const parentId = groupPath
		? groupPath.includes('/')
			? `svg:group:${groupPath.slice(0, groupPath.lastIndexOf('/'))}`
			: 'svg:group:root'
		: undefined;
	context.groups[groupId] = {
		id: groupId,
		...(group.source_id ? { sourceId: group.source_id } : {}),
		...(parentId && parentId !== groupId ? { parentId } : {}),
		transform: group.transform,
		style: group.style,
		properties: group.properties
	};
	for (const [index, node] of group.children.entries()) {
		if (node.kind === 'group') {
			const childName = node.value.source_id?.trim() || `group-${context.groupIndex++}`;
			walkGroup(node.value, matrix, groupPath ? `${groupPath}/${childName}` : childName, opacity, context);
			continue;
		}
		if (node.kind === 'image') continue;
		const shape = projectShape(node.value, matrix, opacity, groupPath, context, index);
		if (shape) addShape(context.document, context.pageId, context.layerId, shape);
	}
}

function projectShape(
	source: SvgShape,
	parentMatrix: Matrix,
	parentOpacity: number,
	groupPath: string,
	context: ProjectionContext,
	childIndex: number
): Shape | null {
	const matrix = multiply(parentMatrix, transformMatrix(source.transform));
	const id = nextId(source.source_id, context);
	const fillOpacity = source.style.fill_opacity ?? 1;
	const strokeOpacity = source.style.stroke_opacity ?? 1;
	const opacity = parentOpacity * source.style.opacity;
	const groupId = groupPath ? `svg:group:${groupPath}` : undefined;
	const properties = source.properties;
	const kind = source.kind;

	switch (kind) {
		case 'rect': {
			const transform = decompose(matrix);
			const shape = ShapeRecord.createRect(
				context.pageId,
				transform.e,
				transform.f,
				{
					w: numberProperty(properties, 'width'),
					h: numberProperty(properties, 'height'),
					fill: paintProperty(properties, 'fill'),
					stroke: paintProperty(properties, 'stroke'),
					radius: numberProperty(properties, 'radius')
				},
				id
			);
			shape.rot = transform.rotation;
			shape.props.w *= Math.abs(transform.scaleX);
			shape.props.h *= Math.abs(transform.scaleY);
			return styled(shape, opacity, fillOpacity, strokeOpacity, groupId);
		}
		case 'ellipse': {
			const transform = decompose(matrix);
			const shape = ShapeRecord.createEllipse(
				context.pageId,
				transform.e,
				transform.f,
				{
					w: numberProperty(properties, 'width'),
					h: numberProperty(properties, 'height'),
					fill: paintProperty(properties, 'fill'),
					stroke: paintProperty(properties, 'stroke')
				},
				id
			);
			shape.rot = transform.rotation;
			shape.props.w *= Math.abs(transform.scaleX);
			shape.props.h *= Math.abs(transform.scaleY);
			return styled(shape, opacity, fillOpacity, strokeOpacity, groupId);
		}
		case 'line': {
			const start = apply(matrix, pointProperty(properties, 'a'));
			const end = apply(matrix, pointProperty(properties, 'b'));
			const shape = ShapeRecord.createLine(
				context.pageId,
				start.x,
				start.y,
				{
					a: { x: 0, y: 0 },
					b: { x: end.x - start.x, y: end.y - start.y },
					stroke: paintProperty(properties, 'stroke'),
					width: numberProperty(properties, 'width')
				},
				id
			);
			return styled(shape, opacity, 1, strokeOpacity, groupId);
		}
		case 'path': {
			const geometry = transformGeometry(properties as PathGeometry, matrix);
			const shape = ShapeRecord.createPath(
				context.pageId,
				0,
				0,
				{
					...geometry,
					fill: paintProperty(properties, 'fill'),
					stroke: paintProperty(properties, 'stroke'),
					stroke_width: numberProperty(properties, 'stroke_width')
				},
				id
			);
			return styled(shape, opacity, fillOpacity, strokeOpacity, groupId);
		}
		case 'text': {
			const transform = decompose(matrix);
			const shape = ShapeRecord.createText(
				context.pageId,
				transform.e,
				transform.f,
				{
					text: stringProperty(properties, 'text'),
					fontSize: numberProperty(properties, 'font_size') * Math.abs(transform.scaleY),
					fontFamily: stringProperty(properties, 'font_family'),
					color: paintProperty(properties, 'color')
				},
				id
			);
			shape.rot = transform.rotation;
			return styled(shape, opacity, fillOpacity, strokeOpacity, groupId);
		}
		default:
			context.warnings.add(
				'svg-unsupported-element',
				`The Rust importer returned unsupported shape kind '${kind}' at child ${childIndex}.`
			);
			return null;
	}
}

function styled<T extends Shape>(
	shape: T,
	opacity: number,
	fillOpacity: number,
	strokeOpacity: number,
	groupId?: string
): T {
	shape.opacity = opacity;
	shape.fillOpacity = fillOpacity;
	shape.strokeOpacity = strokeOpacity;
	shape.groupId = groupId;
	return shape;
}

function transformGeometry(properties: PathGeometry, matrix: Matrix): PathGeometry {
	return {
		fill_rule: properties.fill_rule,
		subpaths: properties.subpaths.map((subpath) => ({
			closed: subpath.closed,
			segments: subpath.segments.map((segment) => transformSegment(segment, matrix))
		}))
	};
}

function transformSegment(segment: PathSegment, matrix: Matrix): PathSegment {
	switch (segment.type) {
		case 'move':
		case 'line':
			return { ...segment, to: apply(matrix, segment.to) };
		case 'quadratic':
			return { ...segment, control: apply(matrix, segment.control), to: apply(matrix, segment.to) };
		case 'cubic':
			return {
				...segment,
				control_1: apply(matrix, segment.control_1),
				control_2: apply(matrix, segment.control_2),
				to: apply(matrix, segment.to)
			};
	}
}

function assetRecord(asset: SvgAsset) {
	return {
		id: asset.id,
		name: asset.name,
		mediaType: asset.media_type,
		digest: asset.digest,
		bytes: [...asset.bytes]
	};
}

function addSvgWarning(warnings: WarningCollector, warning: SvgImportWarning) {
	switch (warning.kind) {
		case 'unsupported_element':
			warnings.add(
				'svg-unsupported-element',
				`Skipped SVG element <${warning.element}>${warning.source_id ? ` (${warning.source_id})` : ''}: ${warning.reason}`
			);
			break;
		case 'unsupported_feature':
			warnings.add(
				`svg-${warning.feature}`,
				`Skipped SVG ${warning.feature.replaceAll('_', ' ')} on <${warning.element}>${warning.source_id ? ` (${warning.source_id})` : ''}: ${warning.action.replaceAll('_', ' ')}`
			);
			break;
		case 'unsupported_paint':
			warnings.add(
				'svg-unsupported-paint',
				`Skipped SVG ${warning.property} paint on <${warning.element}>: ${warning.value}`
			);
			break;
	}
}

function nextId(sourceId: string | null, context: ProjectionContext) {
	const base = sourceId?.trim() ? `svg:${sourceId.trim()}` : `svg:shape:${context.shapeIndex++}`;
	let id = base;
	let suffix = 2;
	while (context.ids.has(id)) id = `${base}:${suffix++}`;
	context.ids.add(id);
	return id;
}

function transformMatrix(transform: Transform): Matrix {
	const cos = Math.cos(transform.rotation);
	const sin = Math.sin(transform.rotation);
	return {
		a: transform.scale_x * cos,
		b: transform.scale_x * sin,
		c: -transform.scale_y * sin,
		d: transform.scale_y * cos,
		e: transform.translation.x,
		f: transform.translation.y
	};
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

function apply(matrix: Matrix, point: Point): Point {
	return {
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f
	};
}

function decompose(matrix: Matrix) {
	const scaleX = Math.hypot(matrix.a, matrix.b);
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	const scaleY = determinant < 0 ? -Math.hypot(matrix.c, matrix.d) : Math.hypot(matrix.c, matrix.d);
	return {
		e: matrix.e,
		f: matrix.f,
		rotation: scaleX > Number.EPSILON ? Math.atan2(matrix.b, matrix.a) : 0,
		scaleX,
		scaleY
	};
}

function numberProperty(properties: Record<string, unknown>, name: string) {
	const value = properties[name];
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringProperty(properties: Record<string, unknown>, name: string) {
	return typeof properties[name] === 'string' ? properties[name] : '';
}

function paintProperty(properties: Record<string, unknown>, name: string) {
	const value = stringProperty(properties, name);
	return value === 'none' || value === 'transparent' ? '' : value;
}

function pointProperty(properties: Record<string, unknown>, name: string): Point {
	const value = properties[name];
	if (typeof value === 'object' && value !== null && 'x' in value && 'y' in value) {
		const point = value as { x: unknown; y: unknown };
		if (typeof point.x === 'number' && typeof point.y === 'number') return { x: point.x, y: point.y };
	}
	return { x: 0, y: 0 };
}
