import { describe, expect, it } from 'vitest';

import {
	clamp,
	hexToHsv,
	hexToRgb,
	hsvToHex,
	hsvToRgb,
	normalizeHex,
	rgbToHex
} from '../color-math';

describe('color math', () => {
	it('normalizes only supported hex input through Culori', () => {
		expect(normalizeHex('#ABC')).toBe('#aabbcc');
		expect(normalizeHex(' #A1B2C3 ')).toBe('#a1b2c3');
		expect(normalizeHex('rgb(10 20 30)')).toBeUndefined();
		expect(normalizeHex('blue')).toBeUndefined();
	});

	it('converts hex and RGB values', () => {
		expect(hexToRgb('#336699')).toEqual({ r: 51, g: 102, b: 153 });
		expect(rgbToHex({ r: 51, g: 102, b: 153 })).toBe('#336699');
		expect(rgbToHex({ r: -10, g: 300, b: 127.5 })).toBe('#00ff80');
	});

	it('converts HSV values without hand-written color formulas', () => {
		expect(hsvToRgb({ h: 0, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
		expect(hsvToHex({ h: 210, s: 2 / 3, v: 0.6 })).toBe('#336699');
		expect(hexToHsv('#336699')).toEqual({ h: 210, s: 2 / 3, v: 0.6 });
	});

	it('clamps unit values and wraps hue values', () => {
		expect(clamp(-1)).toBe(0);
		expect(clamp(2)).toBe(1);
		expect(hsvToHex({ h: -150, s: 1, v: 1 })).toBe('#0080ff');
	});
});
