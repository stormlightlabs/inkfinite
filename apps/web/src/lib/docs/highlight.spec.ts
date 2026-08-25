import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { highlightCode } from './highlight.js';

function codeText(html: string): string {
	return JSDOM.fragment(html).querySelector('code')?.textContent ?? '';
}

describe('documentation syntax highlighting', () => {
	it('preserves indentation, blank lines, and line breaks', async () => {
		const source = 'fn main() {\n\tprintln!("first");\n\n\tprintln!("second");\n}';
		const html = await highlightCode(source, 'rust');

		expect(codeText(html)).toBe(source);
		expect(html).toContain('class="shiki shiki-themes github-light github-dark"');
		expect(html).toContain('--shiki-light:');
		expect(html).toContain('--shiki-dark:');
		expect(html).not.toContain('tabindex=');
	});

	it('renders unknown fences as plain text without changing their whitespace', async () => {
		const source = 'first\n  second';
		expect(codeText(await highlightCode(source, 'inkfinite-example'))).toBe(source);
	});
});
