import { expect, test } from '../fixtures/editor';

test('rectangle selection controls', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open();
	await editor.createSelectedRectangle();
	await expect(page).toHaveScreenshot('rectangle.png');
});

test('multi-selection and arrange menu', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open();
	await editor.createSelectedRectangle();
	await editor.drawRectangle({ x: 600, y: 520 }, { x: 780, y: 640 });
	await editor.selectAt({ x: 690, y: 580 });
	await editor.selectAt({ x: 390, y: 580 }, true);
	await editor.revealControl('Align');
	await expect(page).toHaveScreenshot('multi-selection.png');
	await (await editor.revealControl('Arrange')).click();
	await expect(page.getByRole('menu', { name: 'Arrange commands' })).toBeVisible();
	await expect(page).toHaveScreenshot('arrange-menu.png');
});

test('text typography controls', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await page.mouse.click(500, 420);
	await page.mouse.dblclick(500, 420);
	const textEditor = page.locator('.canvas-text-editor');
	await textEditor.fill("It's Instrument Sans!");
	await textEditor.press('Control+Enter');
	await page.getByRole('spinbutton', { name: 'Font size' }).fill('32');
	await page.getByRole('spinbutton', { name: 'Font size' }).press('Enter');
	await editor.waitForRendering();
	await expect(page).toHaveScreenshot('typography.png');
});

test('arrow connection controls in dark theme', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open('dark');
	await editor.chooseTool('Arrow');
	await editor.drag({ x: 320, y: 500 }, { x: 720, y: 500 });
	await editor.selectAt({ x: 520, y: 500 });
	await page.getByRole('button', { name: 'Arrow settings' }).click();
	await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
	await expect(page).toHaveScreenshot('arrow.png');
});
