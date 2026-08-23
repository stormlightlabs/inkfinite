import { expect, test } from './fixtures/editor';

test('text can be added and formatted', async ({ editor, page }) => {
	await editor.open();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await page.mouse.click(500, 420);
	await page.mouse.dblclick(500, 420);

	const textEditor = page.locator('.canvas-text-editor');
	await textEditor.fill('Inkfinite text');
	await textEditor.press('Control+Enter');
	await expect(textEditor).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Typography' })).toBeVisible();

	const fontSize = page.getByRole('spinbutton', { name: 'Font size' });
	await fontSize.fill('32');
	await fontSize.press('Enter');
	await expect(fontSize).toHaveValue('32');
});

test('multiple objects expose arrange commands', async ({ editor, page }) => {
	await editor.open();
	await editor.createSelectedRectangle();
	await editor.drawRectangle({ x: 600, y: 520 }, { x: 780, y: 640 });
	await editor.selectAt({ x: 690, y: 580 });
	await editor.selectAt({ x: 390, y: 580 }, true);

	const arrange = await editor.revealControl('Arrange');
	await arrange.click();
	await expect(page.getByRole('menu', { name: 'Arrange commands' })).toBeVisible();
});
