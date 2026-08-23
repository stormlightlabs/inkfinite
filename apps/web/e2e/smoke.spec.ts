import { expect, test } from './fixtures/editor';

test('the editor opens with its primary tools', { tag: '@smoke' }, async ({ editor, page }) => {
	await editor.open();

	await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeVisible();
	await expect(page.getByRole('complementary', { name: 'Layers' })).toBeVisible();
});

test(
	'selecting a rectangle exposes appearance controls',
	{ tag: '@smoke' },
	async ({ editor, page }) => {
		await editor.open();
		await editor.createSelectedRectangle();

		await expect(page.getByRole('button', { name: 'Fill color', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit metadata' })).toBeVisible();
	}
);
