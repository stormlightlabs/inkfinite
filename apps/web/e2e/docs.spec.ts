import { expect, test } from '@playwright/test';

const policyExample = `{
	"default": {
		"permissions": {
			"read": true,
			"create": true,
			"modify": true,
			"delete": false,
			"layout": true,
			"propose": true
		},
		"hidden_layers": "deny",
		"require_agent_editable": true
	}
}`;

test('keeps documentation scrollable after client-side navigation from the landing page', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/docs\/quickstart\/?$/);

	expect(
		await page
			.locator('html')
			.evaluate((element) => getComputedStyle(element).overscrollBehavior)
	).toBe('none');
	await page.mouse.move(1200, 700);
	await page.mouse.wheel(0, 700);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('highlights documentation code without changing its whitespace', async ({ page }) => {
	await page.goto('/docs/automation/agents/');

	const codeBlock = page.locator('pre.shiki').filter({ hasText: 'hidden_layers' });
	const code = codeBlock.locator('code');
	const token = code.locator('span[style]').first();
	const footer = page.locator('.site-footer');

	await expect(page.locator('html')).toHaveAttribute('data-inkfinite-docs-theme', 'dark');
	expect(await code.textContent()).toBe(policyExample);
	await expect(codeBlock.locator('.line')).toHaveCount(14);
	expect(await code.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('pre');

	const darkCodeBackground = await codeBlock.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);
	const darkTokenColor = await token.evaluate((element) => getComputedStyle(element).color);
	const darkFooterBackground = await footer.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);

	await page.getByRole('button', { name: 'Switch documentation to light mode' }).click();

	await expect
		.poll(() => codeBlock.evaluate((element) => getComputedStyle(element).backgroundColor))
		.not.toBe(darkCodeBackground);
	expect(await token.evaluate((element) => getComputedStyle(element).color)).not.toBe(
		darkTokenColor
	);
	expect(await footer.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
		darkFooterBackground
	);
});
