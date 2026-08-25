import { expect, test } from './fixtures/editor';

test.describe.configure({ mode: 'serial' });

test('installs the app shell and requests persistent storage', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(StorageManager.prototype, 'persist', {
			configurable: true,
			value: async () => {
				Reflect.set(globalThis, '__inkfinitePersistRequested', true);
				return true;
			}
		});
	});

	await page.goto('/app');
	await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();

	const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(manifest).toBe('/manifest.webmanifest');
	const manifestResponse = await page.request.get('/manifest.webmanifest');
	expect(manifestResponse.ok()).toBe(true);
	expect((await manifestResponse.json()).icons).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ sizes: '192x192' }),
			expect.objectContaining({ sizes: '512x512' })
		])
	);

	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
	expect(await page.evaluate(() => Reflect.get(globalThis, '__inkfinitePersistRequested'))).toBe(
		true
	);

	await page.getByRole('button', { name: 'About Inkfinite' }).click();
	const displayedVersion = (await page.getByText(/^Version v/).textContent())?.replace(
		'Version ',
		''
	);
	const cachedVersions = await page.evaluate(async () =>
		(await caches.keys())
			.filter((name) => name.startsWith('inkfinite-'))
			.flatMap((name) => {
				try {
					return [JSON.parse(name.slice('inkfinite-'.length)).display as string];
				} catch {
					return [];
				}
			})
	);
	expect(cachedVersions).toContain(displayedVersion);
});

test('creates, reopens, and exports a board while offline', async ({ editor, page, context }) => {
	await editor.open();
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();

	await editor.createSelectedRectangle();
	await context.setOffline(true);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();

	await editor.createSelectedRectangle({ x: 540, y: 520 }, { x: 700, y: 630 });
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export drawing' }).click();
	await page.getByRole('menuitem', { name: 'Export all shapes as SVG' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/\.svg$/);

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();
	await context.setOffline(false);
});

test('offers an explicit reload when a service worker update is waiting', async ({ page }) => {
	await page.goto('/app');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();

	await page.evaluate(async () => {
		await navigator.serviceWorker.register(`/service-worker.js?update=${Date.now()}`);
	});
	await expect
		.poll(() =>
			page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))
		)
		.toBe(true);

	const reloadButton = page.getByRole('button', { name: 'Update and reload' });
	await expect(reloadButton).toBeVisible();
	await expect(page).toHaveScreenshot('update-notice.png');
	await Promise.all([page.waitForEvent('framenavigated'), reloadButton.click()]);
	await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();
});
