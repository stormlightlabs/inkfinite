import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '../../apps/web/node_modules/playwright/index.mjs';

const webApp = fileURLToPath(new URL('../../apps/web', import.meta.url));
const output = fileURLToPath(new URL('./__screenshots__/', import.meta.url));
const port = 4189;
const url = `http://127.0.0.1:${port}/app`;
const server = spawn('node_modules/.bin/vite', ['dev', '--host', '127.0.0.1', '--port', String(port)], {
	cwd: webApp,
	stdio: ['ignore', 'pipe', 'pipe']
});

server.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
server.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

async function waitForServer() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
			if (attempt % 10 === 0) console.log(`[capture] server responded ${response.status}`);
		} catch (error) {
			if (attempt % 10 === 0) console.log(`[capture] server not ready: ${error.message}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('Editor server did not start');
}

async function drag(page, from, to) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

async function drawRectangle(page, from, to) {
	await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
	await drag(page, from, to);
}

async function selectAt(page, point, additive = false) {
	await page.getByRole('button', { name: 'Select', exact: true }).click();
	if (additive) await page.keyboard.down('Shift');
	await page.mouse.click(point.x, point.y);
	if (additive) await page.keyboard.up('Shift');
}

await mkdir(output, { recursive: true });
let browser;
try {
	await waitForServer();
	browser = await chromium.launch({ channel: 'chrome', headless: true });

	const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await desktop.addInitScript(() => localStorage.setItem('theme', 'light'));
	await desktop.goto(url, { waitUntil: 'networkidle' });
	await drawRectangle(desktop, { x: 300, y: 520 }, { x: 480, y: 640 });
	await selectAt(desktop, { x: 390, y: 580 });
	await desktop.getByRole('heading', { name: 'Appearance' }).waitFor();
	await desktop.screenshot({ path: `${output}/selection-controls-rectangle.png` });

	await drawRectangle(desktop, { x: 600, y: 520 }, { x: 780, y: 640 });
	await selectAt(desktop, { x: 690, y: 580 });
	await selectAt(desktop, { x: 390, y: 580 }, true);
	await desktop.getByRole('button', { name: 'Align' }).waitFor();
	await desktop.screenshot({ path: `${output}/selection-controls-multi.png` });

	await desktop.getByRole('button', { name: 'Arrange', exact: true }).click();
	await desktop.getByRole('menu', { name: 'Arrange commands' }).waitFor();
	await desktop.screenshot({ path: `${output}/selection-controls-arrange-menu.png` });

	const textPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await textPage.addInitScript(() => localStorage.setItem('theme', 'light'));
	await textPage.goto(url, { waitUntil: 'networkidle' });
	await textPage.getByRole('button', { name: 'Text', exact: true }).click();
	await textPage.mouse.click(500, 420);
	await textPage.keyboard.type('Heading');
	await textPage.keyboard.press('Control+Enter');
	await selectAt(textPage, { x: 500, y: 420 });
	await textPage.getByRole('heading', { name: 'Typography' }).waitFor();
	await textPage.screenshot({ path: `${output}/selection-controls-typography.png` });

	const cardPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await cardPage.addInitScript(() => localStorage.setItem('theme', 'light'));
	await cardPage.goto(url, { waitUntil: 'networkidle' });
	await cardPage.getByRole('button', { name: 'Open stencils library' }).click();
	await cardPage.getByRole('button', { name: 'Card', exact: true }).click();
	await cardPage.getByRole('button', { name: 'Close stencil palette' }).click();
	await cardPage.getByRole('heading', { name: 'Card' }).waitFor();
	await cardPage.screenshot({ path: `${output}/selection-controls-card.png` });

	const arrowPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await arrowPage.addInitScript(() => localStorage.setItem('theme', 'dark'));
	await arrowPage.goto(url, { waitUntil: 'networkidle' });
	await arrowPage.getByRole('button', { name: 'Arrow', exact: true }).click();
	await drag(arrowPage, { x: 320, y: 500 }, { x: 720, y: 500 });
	await selectAt(arrowPage, { x: 520, y: 500 });
	await arrowPage.getByRole('button', { name: 'Arrow settings' }).waitFor();
	await arrowPage.getByRole('button', { name: 'Arrow settings' }).click();
	await arrowPage.getByRole('heading', { name: 'Connections' }).waitFor();
	await arrowPage.screenshot({ path: `${output}/selection-controls-arrow.png` });

	const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await mobile.addInitScript(() => localStorage.setItem('theme', 'dark'));
	await mobile.goto(url, { waitUntil: 'networkidle' });
	await drawRectangle(mobile, { x: 120, y: 360 }, { x: 300, y: 470 });
	await selectAt(mobile, { x: 210, y: 415 });
	await mobile.getByRole('heading', { name: 'Appearance' }).waitFor();
	await mobile.screenshot({ path: `${output}/selection-controls-mobile.png`, fullPage: true });

	await cardPage.close();
	await arrowPage.close();
	await textPage.close();
	await desktop.close();
	await mobile.close();
	console.log('[capture] selection controls complete');
} finally {
	await browser?.close();
	server.kill('SIGTERM');
}
