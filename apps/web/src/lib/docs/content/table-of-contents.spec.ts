import { describe, expect, test } from 'vitest';
import { extractTableOfContents } from './table-of-contents.js';

describe('documentation table of contents extraction', () => {
	test('adds slugs and derives h2 and h3 entries from Markdown headings', () => {
		const file = { data: { fm: { title: 'Example' } } };
		const tree = {
			type: 'root',
			children: [
				{ type: 'element', tagName: 'h1', children: [] },
				{
					type: 'element',
					tagName: 'h2',
					children: [{ type: 'text', value: 'First section' }]
				},
				{
					type: 'element',
					tagName: 'h3',
					children: [
						{ type: 'text', value: 'Nested ' },
						{ type: 'element', children: [{ type: 'text', value: 'section' }] }
					]
				}
			]
		} as Parameters<ReturnType<typeof extractTableOfContents>>[0];

		extractTableOfContents()(tree, file);

		expect(file.data.fm).toEqual({
			title: 'Example',
			toc: [
				{ title: 'First section', slug: 'first-section', level: 2 },
				{ title: 'Nested section', slug: 'nested-section', level: 3 }
			]
		});
		expect(tree.children?.[1]?.properties).toEqual({ id: 'first-section' });
		expect(tree.children?.[2]?.properties).toEqual({ id: 'nested-section' });
	});
});
