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
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('Editor server did not start');
}

async function captureMovedPanel(browser, theme) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
	await page.goto(url, { waitUntil: 'networkidle' });

	const panel = page.getByRole('complementary', { name: 'Layers' });
	const handle = page.getByRole('button', { name: 'Move layers panel' });
	const before = await panel.boundingBox();
	const handleBounds = await handle.boundingBox();
	if (!before || !handleBounds) throw new Error(`Could not locate the ${theme} layers panel`);

	await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(880, 300, { steps: 8 });
	await page.mouse.up();

	const after = await panel.boundingBox();
	if (!after || after.x >= before.x - 100) {
		throw new Error(`The ${theme} layers panel did not move far enough`);
	}

	await page.screenshot({ path: `${output}/layer-panel-moved-${theme}.png`, fullPage: true });
	await page.close();
	console.log(
		`[capture] ${theme} panel moved from (${Math.round(before.x)}, ${Math.round(before.y)}) to (${Math.round(after.x)}, ${Math.round(after.y)})`
	);
}

await mkdir(output, { recursive: true });
let browser;
try {
	await waitForServer();
	browser = await chromium.launch({ channel: 'chrome', headless: true });
	await captureMovedPanel(browser, 'light');
	await captureMovedPanel(browser, 'dark');
	console.log('[capture] layer panel verification complete');
} finally {
	await browser?.close();
	server.kill('SIGTERM');
}
