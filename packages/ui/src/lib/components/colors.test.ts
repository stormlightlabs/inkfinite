import { describe, expect, it } from 'vitest';

import { findPaletteColor, getPaletteColor, quickColors, REASONABLE_COLORS } from './colors';

describe('reasonable colors', () => {
	it('contains six shades for every Reasonable Colors family', () => {
		expect(Object.keys(REASONABLE_COLORS)).toHaveLength(25);
		for (const shades of Object.values(REASONABLE_COLORS)) {
			expect(shades).toHaveLength(6);
			for (const color of shades) {
				expect(color).toMatch(/^#[\da-f]{6}$/);
			}
		}
	});

	it('keeps the quick palette compact and resolves its values', () => {
		expect(quickColors).toHaveLength(16);
		for (const { family, shade } of quickColors) {
			expect(getPaletteColor(family, shade)).toMatch(/^#[\da-f]{6}$/);
		}
	});

	it('finds a palette family and one-based shade', () => {
		expect(findPaletteColor('#0089FC')).toEqual({ family: 'blue', shade: 3 });
		expect(findPaletteColor('#not-a-color')).toBeUndefined();
	});
});
