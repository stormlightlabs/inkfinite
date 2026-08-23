import { expect, test } from './fixtures/editor';

async function openBoards(editor: { page: import('@playwright/test').Page }) {
	await editor.page.getByRole('button', { name: 'Browse boards' }).click();
	return editor.page.getByRole('dialog', { name: 'Boards' });
}

test('creates, renames, duplicates, and switches boards', async ({ editor, page }) => {
	await editor.open();
	let browser = await openBoards(editor);

	await browser.getByRole('button', { name: 'Create new board' }).click();
	await browser.getByRole('textbox', { name: 'New board name' }).fill('Project map');
	await browser.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(browser).not.toBeVisible();

	browser = await openBoards(editor);
	await browser.getByPlaceholder('Search boards...').fill('Project map');
	const projectRow = browser.locator('[data-board-row]').first();
	await expect(projectRow).toContainText('Project map');
	await projectRow.getByLabel('Rename board').click();
	await browser.getByRole('textbox', { name: 'Board name' }).fill('Project map renamed');
	await projectRow.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(browser.getByText('Project map renamed')).toBeVisible();
	await projectRow.getByLabel('Duplicate board').click();
	await expect(browser).not.toBeVisible();

	browser = await openBoards(editor);
	await browser.getByPlaceholder('Search boards...').fill('Copy of Project map renamed');
	const duplicateRow = browser.locator('[data-board-row]').first();
	await expect(duplicateRow).toContainText('Copy of Project map renamed');
	await duplicateRow.getByRole('button', { name: /Open Copy of Project map renamed/ }).click();
	await expect(browser).not.toBeVisible();

	await page.reload({ waitUntil: 'networkidle' });
	await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();
	browser = await openBoards(editor);
	await browser.getByPlaceholder('Search boards...').fill('Copy of Project map renamed');
	await expect(browser.locator('[data-board-row]').first()).toContainText(
		'Copy of Project map renamed'
	);
});

test('deletes a board and reports inspector details', async ({ editor, page }) => {
	await editor.open();
	let browser = await openBoards(editor);

	await browser.getByRole('button', { name: 'Create new board' }).click();
	await browser.getByRole('textbox', { name: 'New board name' }).fill('Disposable map');
	await browser.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(browser).not.toBeVisible();

	browser = await openBoards(editor);
	await browser.getByPlaceholder('Search boards...').fill('Disposable map');
	const row = browser.locator('[data-board-row]').first();
	await row.getByLabel('Inspect board').click();
	await expect(page.getByRole('heading', { name: 'Board Inspector' })).toBeVisible();
	await expect(page.getByText('Board details')).toBeVisible();
	await expect(page.getByText('Statistics')).toBeVisible();
	await page.getByLabel('Close inspector').click();

	page.once('dialog', (dialog) => dialog.accept());
	await row.getByLabel('Delete board').click();
	await expect(browser.getByText('Disposable map')).not.toBeVisible();
});
