import { expect, test } from '../fixtures/editor';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('mobile editor chrome', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open('dark');
	await expect(page).toHaveScreenshot('mobile-editor.png', { fullPage: true });
});

test('mobile selection controls', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open('dark');
	await editor.createSelectedRectangle({ x: 120, y: 360 }, { x: 300, y: 470 });
	await expect(page).toHaveScreenshot('mobile-selection.png', { fullPage: true });
});

test(
	'mobile color controls stay within the viewport',
	{ tag: '@visual' },
	async ({ editor, page }) => {
		await editor.open('dark');
		await editor.createSelectedRectangle({ x: 70, y: 360 }, { x: 320, y: 500 });
		await page.getByRole('button', { name: 'Fill color', exact: true }).click();
		const picker = page.locator('.color-picker__panel');
		await expect(page.getByRole('group', { name: 'Quick colors' })).toBeVisible();
		await expect(picker).toBeInViewport();
		await expect(page).toHaveScreenshot('mobile-color-picker.png', { fullPage: true });
	}
);
