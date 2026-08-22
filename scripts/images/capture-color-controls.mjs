import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '../../apps/web/node_modules/playwright/index.mjs';

const webApp = fileURLToPath(new URL('../../apps/web', import.meta.url));
const output = fileURLToPath(new URL('./__screenshots__/', import.meta.url));
const port = 4193;
const server = spawn('node_modules/.bin/vite', ['dev', '--host', '127.0.0.1', '--port', String(port)], {
	cwd: webApp,
	stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', (chunk) => {
	serverLog += chunk;
	process.stdout.write(`[vite] ${chunk}`);
});
server.stderr.on('data', (chunk) => {
	serverLog += chunk;
	process.stderr.write(`[vite] ${chunk}`);
});

function step(message) {
	console.log(`[capture] ${message}`);
}

async function waitForServer(url) {
	for (let attempt = 1; attempt <= 60; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Web app did not start.\n${serverLog}`);
}

async function createSelectedRectangle(page) {
	await page.getByRole('button', { name: 'Shapes', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
	const canvas = page.locator('canvas').first();
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error('Editor canvas is not visible');

	const start = { x: bounds.x + 280, y: bounds.y + 210 };
	const end = { x: bounds.x + 600, y: bounds.y + 410 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 8 });
	await page.mouse.up();

	await page.getByRole('button', { name: 'Direct Select', exact: true }).click();
	await page.mouse.click((start.x + end.x) / 2, (start.y + end.y) / 2);
	await page.getByRole('button', { name: 'Fill color', exact: true }).waitFor();
}

await mkdir(output, { recursive: true });
let browser;
try {
	const url = `http://127.0.0.1:${port}/app`;
	await waitForServer(url);
	browser = await chromium.launch({ channel: 'chrome', headless: true });

	for (const theme of ['light', 'dark']) {
		step(`capturing ${theme} color controls`);
		const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
		const page = await context.newPage();
		await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
		await page.goto(url, { waitUntil: 'networkidle' });
		await createSelectedRectangle(page);

		const fill = page.getByRole('button', { name: 'Fill color', exact: true });
		await fill.click();
		await page.getByRole('group', { name: 'Quick colors' }).waitFor();
		console.log(
			'[capture] desktop quick bounds',
			await fill.boundingBox(),
			await page.locator('.color-picker__panel').boundingBox()
		);
		await page.screenshot({ path: `${output}/color-controls-${theme}-quick.png`, fullPage: true });

		await page.getByRole('button', { name: 'Custom…' }).click();
		await page.getByRole('group', { name: 'Color families' }).waitFor();
		await page.screenshot({ path: `${output}/color-controls-${theme}-custom.png`, fullPage: true });
		await context.close();
	}

	step('capturing dark mobile color controls');
	const mobileContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true
	});
	const mobile = await mobileContext.newPage();
	await mobile.addInitScript(() => localStorage.setItem('theme', 'dark'));
	await mobile.goto(url, { waitUntil: 'networkidle' });
	await createSelectedRectangle(mobile);
	await mobile.getByRole('button', { name: 'Fill color', exact: true }).click();
	await mobile.getByRole('group', { name: 'Quick colors' }).waitFor();
	console.log(
		'[capture] mobile quick bounds',
		await mobile.getByRole('button', { name: 'Fill color', exact: true }).boundingBox(),
		await mobile.locator('.color-picker__panel').boundingBox()
	);
	await mobile.screenshot({ path: `${output}/color-controls-mobile-quick.png`, fullPage: true });
	await mobileContext.close();
	step('capture complete');
} finally {
	await browser?.close();
	server.kill('SIGTERM');
}
