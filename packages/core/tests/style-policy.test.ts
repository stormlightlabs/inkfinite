import { describe, expect, it } from 'vitest';
import { creationStylePolicy } from '../src/style-policy';

describe('creation style policy', () => {
	it('uses neutral geometry and reserves the accent for arrows', () => {
		const policy = creationStylePolicy('light');
		expect(policy.rect.fill).toBe('#ffffff');
		expect(policy.rect.stroke).not.toBe(policy.arrow.stroke);
		expect(policy.rect.radius).toBeGreaterThan(policy.frame.radius ?? 0);
	});

	it('resolves explicit readable colors for a dark canvas', () => {
		const policy = creationStylePolicy('dark');
		expect(policy.rect).toEqual({ fill: '#252738', stroke: '#8f93a8', radius: 12 });
		expect(policy.text.color).toBe('#d8e6e6');
		expect(policy.markdown.color).toBe(policy.text.color);
		expect(Object.values(policy).some((value) => JSON.stringify(value).includes('var('))).toBe(false);
	});
});
