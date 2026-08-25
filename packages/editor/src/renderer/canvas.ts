import type { EditorShapeRecord, FilterEffect, PaintValue, PathGeometry } from '@inkfinite/core';
import { shapeTransform } from '@inkfinite/core';
type PaintBounds =
	| { x: number; y: number; width: number; height: number }
	| { min: { x: number; y: number }; max: { x: number; y: number } };

/** Resolve a paint value for Canvas drawing in local shape coordinates. */
export function paintForCanvas(
	context: CanvasRenderingContext2D,
	value: PaintValue | undefined,
	bounds: PaintBounds
): string | CanvasGradient | null {
	if (typeof value === 'string') return value || null;
	if (!value) return null;
	if (value.kind === 'solid') return value.color || null;
	const area =
		'min' in bounds
			? {
					x: bounds.min.x,
					y: bounds.min.y,
					width: bounds.max.x - bounds.min.x,
					height: bounds.max.y - bounds.min.y
				}
			: bounds;
	const point = (x: number, y: number) => {
		const localX = value.units === 'object_bounding_box' ? area.x + x * area.width : x;
		const localY = value.units === 'object_bounding_box' ? area.y + y * area.height : y;
		const transform = value.transform;
		return {
			x: transform.a * localX + transform.c * localY + transform.e,
			y: transform.b * localX + transform.d * localY + transform.f
		};
	};
	const stopColor = (color: string, opacity: number) => withOpacity(color, opacity);
	if (value.kind === 'linear_gradient') {
		const start = point(value.x1, value.y1);
		const end = point(value.x2, value.y2);
		const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
		for (const stop of value.stops) gradient.addColorStop(stop.offset, stopColor(stop.color, stop.opacity));
		return gradient;
	}
	const center = point(value.cx, value.cy);
	const focus = point(value.fx, value.fy);
	const radius = value.units === 'object_bounding_box' ? value.r * Math.min(area.width, area.height) : value.r;
	const gradient = context.createRadialGradient(focus.x, focus.y, 0, center.x, center.y, Math.max(0, radius));
	for (const stop of value.stops) gradient.addColorStop(stop.offset, stopColor(stop.color, stop.opacity));
	return gradient;
}

function withOpacity(color: string, opacity: number): string {
	if (opacity >= 1) return color;
	const hex = color.match(/^#([\da-f]{3,8})$/i)?.[1];
	if (hex) {
		const expanded = hex.length === 3 || hex.length === 4 ? [...hex].map((part) => part + part).join('') : hex;
		const rgb = expanded
			.slice(0, 6)
			.match(/[\da-f]{2}/gi)
			?.map((part) => parseInt(part, 16));
		if (rgb?.length === 3)
			return `rgba(${rgb.join(', ')}, ${opacity * (expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1)})`;
	}
	const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
	if (rgba) {
		const parts = rgba[1].split(',').map((part) => part.trim());
		if (parts.length >= 3)
			return `rgba(${parts.slice(0, 3).join(', ')}, ${opacity * (parts[3] ? Number(parts[3]) : 1)})`;
	}
	return color;
}

/** Apply the stored shape transform to a Canvas context. */
export function applyShapeTransform(context: CanvasRenderingContext2D, shape: EditorShapeRecord): void {
	const matrix = shapeTransform(shape);
	if (shape.editorTransform && typeof context.transform === 'function') {
		context.transform(matrix[0], matrix[1], matrix[3], matrix[4], matrix[6], matrix[7]);
		return;
	}
	context.translate(shape.x, shape.y);
	if (shape.rot !== 0) context.rotate(shape.rot);
}

/** Add native path geometry to the current Canvas path. */
export function drawNativePath(context: CanvasRenderingContext2D, geometry: PathGeometry): void {
	context.beginPath();
	for (const subpath of geometry.subpaths) {
		for (const segment of subpath.segments) {
			switch (segment.type) {
				case 'move':
					context.moveTo(segment.to.x, segment.to.y);
					break;
				case 'line':
					context.lineTo(segment.to.x, segment.to.y);
					break;
				case 'quadratic':
					context.quadraticCurveTo(segment.control.x, segment.control.y, segment.to.x, segment.to.y);
					break;
				case 'cubic':
					context.bezierCurveTo(
						segment.control_1.x,
						segment.control_1.y,
						segment.control_2.x,
						segment.control_2.y,
						segment.to.x,
						segment.to.y
					);
					break;
			}
		}
		if (subpath.closed) context.closePath();
	}
}

/** Apply the supported clip, mask, and filter effects before shape drawing. */
export function applyShapeEffects(context: CanvasRenderingContext2D, shape: EditorShapeRecord): void {
	const props = shape.props as EditorShapeRecord['props'] & {
		clipPath?: PathGeometry;
		maskEffect?: { geometry: PathGeometry; opacity?: number };
		filter?: FilterEffect;
	};
	if (props.filter) context.filter = filterToCanvas(props.filter);
	if (props.clipPath) {
		drawNativePath(context, props.clipPath);
		context.clip(props.clipPath.fill_rule === 'evenodd' ? 'evenodd' : 'nonzero');
	}
	if (props.maskEffect) {
		context.globalAlpha *= props.maskEffect.opacity ?? 1;
		drawNativePath(context, props.maskEffect.geometry);
		context.clip(props.maskEffect.geometry.fill_rule === 'evenodd' ? 'evenodd' : 'nonzero');
	}
}

/** Convert the shared supported filter subset to the Canvas filter syntax. */
export function filterToCanvas(filter: FilterEffect): string {
	return filter.primitives
		.map((primitive) => {
			switch (primitive.type) {
				case 'blur':
					return `blur(${Math.max(0, primitive.radius)}px)`;
				case 'brightness':
					return `brightness(${Math.max(0, primitive.amount)})`;
				case 'contrast':
					return `contrast(${Math.max(0, primitive.amount)})`;
				case 'grayscale':
					return `grayscale(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'hue_rotate':
					return `hue-rotate(${primitive.degrees}deg)`;
				case 'invert':
					return `invert(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'saturate':
					return `saturate(${Math.max(0, primitive.amount)})`;
				case 'sepia':
					return `sepia(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'opacity':
					return `opacity(${Math.max(0, Math.min(1, primitive.amount))})`;
				case 'drop_shadow':
					return `drop-shadow(${primitive.dx}px ${primitive.dy}px ${Math.max(0, primitive.radius)}px ${primitive.color})`;
			}
		})
		.join(' ');
}
