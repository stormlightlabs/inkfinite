import type { Paint as NativePaint, PaintValue as NativePaintValue } from '@inkfinite/bindings/model';

/** A legacy CSS colour or a canonical native paint. */
export type PaintValue = NativePaintValue;
/** Canonical native paint definition. */
export type Paint = NativePaint;

/** Returns the first visible colour represented by a paint. */
export function paintColor(value: PaintValue | undefined): string | null {
	if (typeof value === 'string') return value;
	if (!value) return null;
	return value.kind === 'solid' ? value.color : (value.stops[0]?.color ?? null);
}

/** Returns a CSS preview suitable for a colour or gradient control. */
export function paintPreview(value: PaintValue | undefined): string {
	if (typeof value === 'string' || !value) return value ?? 'transparent';
	if (value.kind === 'solid') return value.color;
	const stops = value.stops
		.map((stop) => `${withOpacity(stop.color, stop.opacity)} ${Math.round(stop.offset * 100)}%`)
		.join(', ');
	if (value.kind === 'linear_gradient') {
		const angle = Math.atan2(value.y2 - value.y1, value.x2 - value.x1) * (180 / Math.PI) + 90;
		return `linear-gradient(${angle}deg, ${stops})`;
	}
	return `radial-gradient(circle, ${stops})`;
}

/** Add one paint definition and return its SVG paint value. */
export function paintToSvg(value: PaintValue | undefined, id: string, definitions: string[]): string {
	if (typeof value === 'string') return value ? escapeXml(value) : 'none';
	if (!value) return 'none';
	if (value.kind === 'solid') return escapeXml(value.color);
	const gradientId = `inkfinite-gradient-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
	const units = value.units === 'object_bounding_box' ? 'objectBoundingBox' : 'userSpaceOnUse';
	const spread = value.spread;
	const transform = `matrix(${value.transform.a} ${value.transform.b} ${value.transform.c} ${value.transform.d} ${value.transform.e} ${value.transform.f})`;
	const stops = value.stops
		.map(
			(stop) =>
				`<stop offset="${stop.offset}" stop-color="${escapeXml(stop.color)}" stop-opacity="${stop.opacity}"/>`
		)
		.join('');
	if (value.kind === 'linear_gradient') {
		definitions.push(
			`<linearGradient id="${gradientId}" x1="${value.x1}" y1="${value.y1}" x2="${value.x2}" y2="${value.y2}" gradientUnits="${units}" gradientTransform="${transform}" spreadMethod="${spread}">${stops}</linearGradient>`
		);
	} else {
		definitions.push(
			`<radialGradient id="${gradientId}" cx="${value.cx}" cy="${value.cy}" r="${value.r}" fx="${value.fx}" fy="${value.fy}" gradientUnits="${units}" gradientTransform="${transform}" spreadMethod="${spread}">${stops}</radialGradient>`
		);
	}
	return `url(#${gradientId})`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
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
