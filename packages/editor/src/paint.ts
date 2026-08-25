import type { PaintValue } from '@inkfinite/core';

type PaintBounds =
	| { x: number; y: number; width: number; height: number }
	| { min: { x: number; y: number }; max: { x: number; y: number } };

/** Resolve a paint to a Canvas fill or stroke style in local space. */
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
