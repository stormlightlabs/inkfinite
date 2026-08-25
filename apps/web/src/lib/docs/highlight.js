import { escapeSvelte } from 'mdsvex';
import { bundledLanguages, codeToHtml } from 'shiki';

const plainTextLanguages = new Set(['', 'text', 'txt', 'plaintext']);

/**
 * Highlights a fenced Markdown code block with light and dark documentation themes.
 *
 * @param {string} code
 * @param {string | null | undefined} language
 */
export async function highlightCode(code, language = '') {
	const requestedLanguage = language?.toLowerCase() ?? '';
	const lang =
		plainTextLanguages.has(requestedLanguage) || !(requestedLanguage in bundledLanguages)
			? 'text'
			: requestedLanguage;

	const html = await codeToHtml(code, {
		lang,
		themes: { light: 'github-light', dark: 'github-dark' },
		defaultColor: false
	});

	return escapeSvelte(html.replace(' tabindex="0"', ''));
}
