import { expect, test } from '../fixtures/editor';

for (const theme of ['light', 'dark'] as const) {
	test(`editor chrome in ${theme} theme`, { tag: '@visual' }, async ({ editor, page }) => {
		await editor.open(theme);
		await expect(page).toHaveScreenshot(`editor-${theme}.png`, { fullPage: true });
	});

	test(
		`editor hover and focus states in ${theme} theme`,
		{ tag: '@visual' },
		async ({ editor, page }) => {
			await editor.open(theme);
			const directSelect = page.getByRole('button', { name: 'Direct Select', exact: true });
			await directSelect.hover();
			await expect(page).toHaveScreenshot(`editor-${theme}-hover.png`, { fullPage: true });
			await directSelect.focus();
			await expect(page).toHaveScreenshot(`editor-${theme}-focus.png`, { fullPage: true });
		}
	);
}

test('shape tool menu', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open();
	await page.getByRole('button', { name: 'Shapes', exact: true }).click();
	await expect(page.getByRole('menu', { name: 'Shape tools' })).toBeVisible();
	await expect(page).toHaveScreenshot('shape-tool-menu.png');
});
