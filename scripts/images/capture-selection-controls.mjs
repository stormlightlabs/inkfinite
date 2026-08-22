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

async function chooseShapeTool(page, name) {
	await page.getByRole('button', { name: 'Shapes', exact: true }).click();
	await page.getByRole('menuitem', { name, exact: true }).click();
}

async function drawRectangle(page, from, to) {
	await chooseShapeTool(page, 'Rectangle');
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
	await desktop.getByRole('button', { name: 'Shapes', exact: true }).click();
	await desktop.getByRole('menu', { name: 'Shape tools' }).waitFor();
	await desktop.screenshot({ path: `${output}/toolbar-shapes-menu.png` });
	console.log('[capture] shapes captured');

	await desktop.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
	await drag(desktop, { x: 300, y: 520 }, { x: 480, y: 640 });
	await selectAt(desktop, { x: 390, y: 580 });
	await desktop.getByRole('heading', { name: 'Appearance' }).waitFor();
	await desktop.screenshot({ path: `${output}/selection-controls-rectangle.png` });
	console.log('[capture] rect captured');

	await desktop.getByRole('button', { name: 'Edit metadata' }).click();
	const metadataDialog = desktop.getByRole('dialog', { name: 'Object metadata' });
	await metadataDialog.waitFor();
	await metadataDialog.screenshot({ path: `${output}/selection-controls-metadata-dialog.png` });
	await desktop.screenshot({ path: `${output}/selection-controls-metadata.png` });
	console.log('[capture] metadata captured');

	await desktop.getByRole('button', { name: 'Done' }).click();

	await drawRectangle(desktop, { x: 600, y: 520 }, { x: 780, y: 640 });
	await selectAt(desktop, { x: 690, y: 580 });
	await selectAt(desktop, { x: 390, y: 580 }, true);
	while (!(await desktop.getByRole('button', { name: 'Align' }).isVisible())) {
		await desktop.getByRole('button', { name: 'Show more contextual controls' }).click();
		await desktop.waitForTimeout(250);
	}
	await desktop.screenshot({ path: `${output}/selection-controls-multi.png` });
	console.log('[capture] multi controls captured');

	await desktop.getByRole('button', { name: 'Arrange', exact: true }).click();
	await desktop.getByRole('menu', { name: 'Arrange commands' }).waitFor();
	await desktop.screenshot({ path: `${output}/selection-controls-arrange-menu.png` });
	console.log('[capture] arrange menu captured');

	const textPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await textPage.addInitScript(() => localStorage.setItem('theme', 'light'));
	await textPage.goto(url, { waitUntil: 'networkidle' });
	await textPage.getByRole('button', { name: 'Text', exact: true }).click();
	await textPage.mouse.click(500, 420);
	await textPage.mouse.dblclick(500, 420);
	const textEditor = textPage.locator('.canvas-text-editor');
	await textEditor.waitFor();
	await textEditor.fill("It's Instrument Sans!");
	await textEditor.press('Control+Enter');
	await textEditor.waitFor({ state: 'detached' });
	await textPage.getByRole('heading', { name: 'Typography' }).waitFor();
	const fontSize = textPage.getByRole('spinbutton', { name: 'Font size' });
	await fontSize.fill('32');
	await fontSize.press('Enter');
	await textPage.evaluate(() => document.fonts.ready);
	await textPage.screenshot({ path: `${output}/selection-controls-typography.png` });
	console.log('[capture] typography captured');

	const cardPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await cardPage.addInitScript(() => localStorage.setItem('theme', 'light'));
	await cardPage.goto(url, { waitUntil: 'networkidle' });
	await cardPage.getByRole('button', { name: 'Open stencils library' }).click();
	await cardPage.getByRole('button', { name: 'Card', exact: true }).click();
	await cardPage.getByRole('button', { name: 'Close stencil palette' }).click();
	const editCardButton = cardPage.getByRole('button', { name: 'Edit card' });
	while (true) {
		const bounds = await editCardButton.boundingBox();
		if (bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1424) break;
		await cardPage.getByRole('button', { name: 'Show more contextual controls' }).click();
		await cardPage.waitForTimeout(250);
	}
	await cardPage.evaluate(() => document.fonts.ready);
	await cardPage.waitForTimeout(100);
	await cardPage.screenshot({ path: `${output}/selection-controls-card.png` });
	await cardPage.getByRole('button', { name: 'Edit card' }).click();
	const cardDialog = cardPage.getByRole('dialog', { name: 'Card details' });
	await cardDialog.waitFor();
	await cardDialog.screenshot({ path: `${output}/selection-controls-card-dialog.png` });
	console.log('[capture] card dialog captured');

	const arrowPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await arrowPage.addInitScript(() => localStorage.setItem('theme', 'dark'));
	await arrowPage.goto(url, { waitUntil: 'networkidle' });
	await chooseShapeTool(arrowPage, 'Arrow');
	await drag(arrowPage, { x: 320, y: 500 }, { x: 720, y: 500 });
	await selectAt(arrowPage, { x: 520, y: 500 });
	await arrowPage.getByRole('button', { name: 'Arrow settings' }).waitFor();
	await arrowPage.getByRole('button', { name: 'Arrow settings' }).click();
	await arrowPage.getByRole('heading', { name: 'Connections' }).waitFor();
	await arrowPage.screenshot({ path: `${output}/selection-controls-arrow.png` });
	console.log('[capture] arrow captured');

	const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await mobile.addInitScript(() => localStorage.setItem('theme', 'dark'));
	await mobile.goto(url, { waitUntil: 'networkidle' });
	await drawRectangle(mobile, { x: 120, y: 360 }, { x: 300, y: 470 });
	await selectAt(mobile, { x: 210, y: 415 });
	await mobile.getByRole('heading', { name: 'Appearance' }).waitFor();
	await mobile.screenshot({ path: `${output}/selection-controls-mobile.png`, fullPage: true });
	console.log('[capture] mobile captured');

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
