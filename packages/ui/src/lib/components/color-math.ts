/// <reference path="./culori.d.ts" />

import { converter, formatHex, parse } from 'culori';

/** HSV values use degrees for hue and unit intervals for saturation and value. */
export interface HSV {
	h: number;
	s: number;
	v: number;
}

/** RGB values use the familiar 0–255 channel range. */
export interface RGB {
	r: number;
	g: number;
	b: number;
}

type CuloriColor = {
	mode?: string;
	h?: number;
	s?: number;
	v?: number;
	r?: number;
	g?: number;
	b?: number;
};

type CuloriConverter = (color: CuloriColor | undefined) => CuloriColor | undefined;

const toHsv = converter('hsv') as CuloriConverter;
const toRgb = converter('rgb') as CuloriConverter;
const hexPattern = /^#[\da-f]{3}(?:[\da-f]{3})?$/i;

/** Constrains a number to an inclusive interval. */
export function clamp(value: number, min = 0, max = 1): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeHue(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return ((value % 360) + 360) % 360;
}

/** Normalizes a three- or six-digit hex value through Culori. */
export function normalizeHex(value: string): string | undefined {
	const trimmed = value.trim();
	if (!hexPattern.test(trimmed)) return undefined;

	const parsed = parse(trimmed) as CuloriColor | undefined;
	const formatted = parsed ? formatHex(parsed) : undefined;
	return typeof formatted === 'string' ? formatted.toLowerCase() : undefined;
}

/** Converts a hex value to byte-based RGB channels. */
export function hexToRgb(value: string): RGB | undefined {
	const normalized = normalizeHex(value);
	const parsed = normalized ? (parse(normalized) as CuloriColor) : undefined;
	const rgb = parsed ? toRgb(parsed) : undefined;
	if (!rgb || !isRgb(rgb)) return undefined;

	return {
		r: Math.round(clamp(rgb.r) * 255),
		g: Math.round(clamp(rgb.g) * 255),
		b: Math.round(clamp(rgb.b) * 255)
	};
}

/** Converts a hex value to HSV values for the custom picker controls. */
export function hexToHsv(value: string): HSV | undefined {
	const normalized = normalizeHex(value);
	const parsed = normalized ? (parse(normalized) as CuloriColor) : undefined;
	const hsv = parsed ? toHsv(parsed) : undefined;
	if (!hsv || !isHsv(hsv)) return undefined;

	return { h: normalizeHue(hsv.h ?? 0), s: clamp(hsv.s ?? 0), v: clamp(hsv.v ?? 0) };
}

/** Converts HSV values to byte-based RGB channels. */
export function hsvToRgb({ h, s, v }: HSV): RGB {
	const rgb = toRgb({ mode: 'hsv', h: normalizeHue(h), s: clamp(s), v: clamp(v) });
	if (!rgb || !isRgb(rgb)) return { r: 0, g: 0, b: 0 };

	return {
		r: Math.round(clamp(rgb.r) * 255),
		g: Math.round(clamp(rgb.g) * 255),
		b: Math.round(clamp(rgb.b) * 255)
	};
}

/** Converts byte-based RGB channels to a lowercase six-digit hex value. */
export function rgbToHex({ r, g, b }: RGB): string {
	const formatted = formatHex({
		mode: 'rgb',
		r: clamp(r / 255),
		g: clamp(g / 255),
		b: clamp(b / 255)
	} as CuloriColor);
	return typeof formatted === 'string' ? formatted.toLowerCase() : '#000000';
}

/** Converts HSV values directly to a lowercase six-digit hex value. */
export function hsvToHex(value: HSV): string {
	return rgbToHex(hsvToRgb(value));
}

function isRgb(color: CuloriColor): color is CuloriColor & { r: number; g: number; b: number } {
	return [color.r, color.g, color.b].every(
		(channel) => channel !== undefined && Number.isFinite(channel)
	);
}

function isHsv(color: CuloriColor): color is CuloriColor & { s: number; v: number } {
	return [color.s, color.v].every(
		(channel) => channel !== undefined && Number.isFinite(channel)
	);
}
