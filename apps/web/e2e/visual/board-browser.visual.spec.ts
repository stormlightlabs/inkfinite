import { expect, test } from '../fixtures/editor';

test(
	'board browser shows active storage and sorting controls',
	{ tag: '@visual' },
	async ({ editor, page }) => {
		await editor.open();
		await page.getByRole('button', { name: 'Browse boards' }).click();
		const browser = page.getByRole('dialog', { name: 'Boards' });
		await expect(browser).toBeVisible();
		await expect(browser).toHaveScreenshot('board-browser.png', {
			mask: [
				browser.locator('.filebrowser__summary-grid dd').nth(3),
				browser.locator('.filebrowser__board-meta')
			]
		});
	}
);

test.describe('narrow viewport', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test(
		'board browser fits a coarse pointer viewport',
		{ tag: '@visual' },
		async ({ editor, page }) => {
			await editor.open();
			await page.getByRole('button', { name: 'Browse boards' }).click();
			const browser = page.getByRole('dialog', { name: 'Boards' });
			await expect(browser).toBeVisible();
			await expect(browser).toBeInViewport();
			await expect(browser).toHaveScreenshot('board-browser-mobile.png', {
				mask: [
					browser.locator('.filebrowser__summary-grid dd').nth(3),
					browser.locator('.filebrowser__board-meta')
				]
			});
		}
	);
});
