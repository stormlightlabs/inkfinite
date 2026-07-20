import { describe, expect, test } from 'vitest';
import { DOCS_GROUPS, DOCS_MANIFEST, findDocsPage } from './navigation';

describe('documentation navigation', () => {
	test('normalizes paths before finding a page', () => {
		expect(findDocsPage('/docs/reference/cli')?.title).toBe('Command-line interface');
	});

	test('groups reuse every canonical manifest entry exactly once', () => {
		const groupedPages = DOCS_GROUPS.flatMap((group) => group.pages);

		expect(groupedPages).toHaveLength(DOCS_MANIFEST.length);
		expect(new Set(groupedPages)).toEqual(new Set(DOCS_MANIFEST));
	});
});
