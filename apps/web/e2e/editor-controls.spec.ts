import { expect, test } from './fixtures/editor';

async function expectInsideViewport(locator: import('@playwright/test').Locator) {
	const box = await locator.boundingBox();
	const viewport = locator.page().viewportSize();
	expect(box).not.toBeNull();
	expect(viewport).not.toBeNull();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
	expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

test('menus stay in the viewport and restore focus', async ({ editor, page }) => {
	await editor.open();

	const exportButton = page.getByRole('button', { name: 'Export drawing' });
	await exportButton.click();
	const exportMenu = page.getByRole('menu', { name: 'Export options' });
	await expect(exportMenu).toBeVisible();
	await expectInsideViewport(exportMenu);
	await page.keyboard.press('Escape');
	await expect(exportButton).toBeFocused();

	const shapesButton = page.getByRole('button', { name: 'Shapes', exact: true });
	await shapesButton.click();
	const shapesMenu = page.getByRole('menu', { name: 'Shape tools' });
	await expectInsideViewport(shapesMenu);
	await page.keyboard.press('Escape');
	await expect(shapesButton).toBeFocused();

	const zoomButton = page.getByRole('button', { name: 'Zoom level' });
	await zoomButton.click();
	await expectInsideViewport(page.getByRole('menu', { name: 'Zoom options' }));
	await page.keyboard.press('Escape');
	await expect(zoomButton).toBeFocused();
});

test('tool and menu changes do not move the canvas', async ({ editor, page }) => {
	await editor.open();
	const canvas = page.locator('canvas').first();
	const initial = await canvas.boundingBox();

	await page.getByRole('button', { name: 'Direct Select', exact: true }).click();
	await page.getByRole('button', { name: 'Shapes', exact: true }).click();
	await page.keyboard.press('Escape');

	expect(await canvas.boundingBox()).toEqual(initial);
});
