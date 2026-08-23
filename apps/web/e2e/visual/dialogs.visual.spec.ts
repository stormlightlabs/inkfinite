import { expect, test } from '../fixtures/editor';

test('object metadata dialog', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open();
	await editor.createSelectedRectangle();
	await page.getByRole('button', { name: 'Edit metadata' }).click();
	const dialog = page.getByRole('dialog', { name: 'Object metadata' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveScreenshot('object-metadata-dialog.png');
	await expect(page).toHaveScreenshot('object-metadata-page.png');
});

test('card controls and details dialog', { tag: '@visual' }, async ({ editor, page }) => {
	await editor.open();
	await page.getByRole('button', { name: 'Open stencils library' }).click();
	await page.getByRole('button', { name: 'Card', exact: true }).click();
	await page.getByRole('button', { name: 'Close stencil palette' }).click();
	const editCard = await editor.revealControl('Edit card');
	await editor.waitForRendering();
	await expect(page).toHaveScreenshot('card.png');
	await editCard.click();
	const dialog = page.getByRole('dialog', { name: 'Card details' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveScreenshot('card-details-dialog.png');
});
