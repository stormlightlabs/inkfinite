import { importInterchange } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';

describe('browser SVG import', () => {
	it('maps nested groups and native primitives into one imported board', () => {
		const imported = importInterchange(
			'<svg viewBox="0 0 100 80"><g transform="translate(10 20)"><rect x="4" y="5" width="20" height="30" fill="#123456" /></g></svg>',
			'icon.svg'
		);

		expect(imported.format).toBe('svg');
		expect(Object.values(imported.snapshot.doc.shapes)).toHaveLength(1);
		expect(Object.values(imported.snapshot.doc.shapes)[0]).toMatchObject({
			type: 'rect',
			x: 14,
			y: 25,
			props: { w: 20, h: 30, fill: '#123456' }
		});
		expect(imported.warnings.some((warning) => warning.code === 'svg-group-flattened')).toBe(true);
	});
});
