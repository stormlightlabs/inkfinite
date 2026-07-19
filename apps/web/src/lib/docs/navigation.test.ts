import { describe, expect, test } from 'vitest';
import { findDocsPage } from './navigation';

describe('documentation navigation', () => {
	test('normalizes paths before finding a page', () => {
		expect(findDocsPage('/docs/reference/cli')?.title).toBe('Command-line interface');
	});
});
