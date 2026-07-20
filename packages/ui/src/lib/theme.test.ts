import { afterEach, describe, expect, it } from 'vitest';

import { applyInkTheme } from './theme';

describe('applyInkTheme', () => {
	afterEach(() => applyInkTheme('system'));

	it('forces and clears a document theme', () => {
		applyInkTheme('dark');
		expect(document.documentElement).toHaveAttribute('data-ink-theme', 'dark');
		expect(document.documentElement.style.colorScheme).toBe('dark');

		applyInkTheme('system');
		expect(document.documentElement).not.toHaveAttribute('data-ink-theme');
		expect(document.documentElement.style.colorScheme).toBe('');
	});
});
