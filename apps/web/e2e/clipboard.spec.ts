import { expect, test } from './fixtures/editor';

test('copies selected and document SVG as vector and plain-text clipboard data', async ({
	editor,
	page
}) => {
	await page
		.context()
		.grantPermissions(['clipboard-read', 'clipboard-write'], {
			origin: 'http://127.0.0.1:4175'
		});
	await editor.open();
	await editor.createSelectedRectangle();

	await page.getByRole('button', { name: 'Export drawing' }).click();
	await page.getByRole('menuitem', { name: 'Copy selected shapes as SVG', exact: true }).click();
	await expect(page.locator('.clipboard-status')).toContainText('SVG copied');

	const selectedClipboard = await page.evaluate(async () => {
		const item = (await navigator.clipboard.read())[0];
		const types = item?.types ?? [];
		return {
			text:
				item && types.includes('text/plain')
					? await (await item.getType('text/plain')).text()
					: '',
			types
		};
	});
	expect(selectedClipboard.text).toContain('<svg');
	expect(selectedClipboard.text).toContain('<rect');
	expect(selectedClipboard.types).toContain('image/svg+xml');
	expect(selectedClipboard.types).toContain('text/plain');

	await page.getByRole('button', { name: 'Export drawing' }).click();
	await page.getByRole('menuitem', { name: 'Copy all shapes as SVG', exact: true }).click();
	await expect(page.locator('.clipboard-status')).toContainText('SVG copied');
});

test('copies selected and transparent document PNG data when image clipboard is supported', async ({
	editor,
	page
}) => {
	await page
		.context()
		.grantPermissions(['clipboard-read', 'clipboard-write'], {
			origin: 'http://127.0.0.1:4175'
		});
	await editor.open();
	await editor.createSelectedRectangle();

	await page.getByRole('button', { name: 'Export drawing' }).click();
	await page.getByRole('menuitem', { name: 'Copy selected shapes as PNG' }).click();
	await expect(page.locator('.clipboard-status')).toContainText('PNG copied');

	const selectedClipboard = await page.evaluate(async () => {
		const item = (await navigator.clipboard.read())[0];
		const image = item?.types.includes('image/png') ? await item.getType('image/png') : null;
		return { types: item?.types ?? [], size: image?.size ?? 0, type: image?.type ?? '' };
	});
	expect(selectedClipboard.types).toContain('image/png');
	expect(selectedClipboard.size).toBeGreaterThan(0);
	expect(selectedClipboard.type).toBe('image/png');

	await page.getByRole('button', { name: 'Export drawing' }).click();
	await page.getByRole('menuitem', { name: 'Copy all shapes as transparent PNG' }).click();
	await expect(page.locator('.clipboard-status')).toContainText('Document PNG copied');
});

test('downloads PNG when image clipboard support is unavailable', async ({ editor, page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, 'clipboard', {
			configurable: true,
			get: () => undefined
		});
	});
	await editor.open();
	await editor.createSelectedRectangle();

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export drawing' }).click();
	await page.getByRole('menuitem', { name: 'Copy selected shapes as PNG' }).click();
	const download = await downloadPromise;

	expect(download.suggestedFilename()).toBe('selection.png');
	await expect(page.locator('.clipboard-status')).toContainText('Downloaded selection.png');
});
