import { expect, test } from '../fixtures/editor';

for (const theme of ['light', 'dark'] as const) {
	test(`color picker in ${theme} theme`, { tag: '@visual' }, async ({ editor, page }) => {
		await editor.open(theme);
		await editor.createSelectedRectangle();
		await page.getByRole('button', { name: 'Fill color', exact: true }).click();
		await expect(page.getByRole('group', { name: 'Quick colors' })).toBeVisible();
		await expect(page).toHaveScreenshot(`color-picker-${theme}-quick.png`, { fullPage: true });
		await page.getByRole('button', { name: 'Custom…' }).click();
		await expect(page.getByRole('group', { name: 'Color families' })).toBeVisible();
		await expect(page).toHaveScreenshot(`color-picker-${theme}-custom.png`, {
			fullPage: true
		});
	});

	test(`moved layers panel in ${theme} theme`, { tag: '@visual' }, async ({ editor, page }) => {
		await editor.open(theme);
		const panel = page.getByRole('complementary', { name: 'Layers' });
		const handle = page.getByRole('button', { name: 'Move layers panel' });
		const before = await panel.boundingBox();
		const handleBounds = await handle.boundingBox();
		if (!before || !handleBounds) throw new Error('Layers panel is not visible');
		await editor.drag(
			{
				x: handleBounds.x + handleBounds.width / 2,
				y: handleBounds.y + handleBounds.height / 2
			},
			{ x: 880, y: 300 }
		);
		const after = await panel.boundingBox();
		expect(after?.x).toBeLessThan(before.x - 100);
		await expect(page).toHaveScreenshot(`layers-moved-${theme}.png`, { fullPage: true });
	});
}
