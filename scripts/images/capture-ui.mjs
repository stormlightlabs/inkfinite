/**
 * @todo make this more general purpose as a screenshot + verification tool.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '../../apps/web/node_modules/playwright/index.mjs';

/**
 * @fileoverview Captures the editor's default, hover, focus, theme, and mobile states.
 * The script starts the web app itself and writes ignored artifacts beside the script.
 */

const webApp = fileURLToPath(new URL('../../apps/web', import.meta.url));
const output = fileURLToPath(new URL('./__screenshots__/', import.meta.url));
const port = 4189;
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
server.on('exit', (code, signal) => console.log(`[server] exited code=${code} signal=${signal}`));

/**
 * Writes a named capture step so slow browser work is visible in the terminal.
 *
 * @param {string} message Progress text.
 */
function step(message) {
	console.log(`[capture] ${message}`);
}

/**
 * Fails an asynchronous capture operation instead of leaving the script hanging.
 *
 * @template T
 * @param {string} label Human-readable operation name used in timeout errors.
 * @param {Promise<T>} operation Operation to await.
 * @param {number} [timeoutMs=30000] Maximum wait in milliseconds.
 * @returns {Promise<T>} The completed operation result.
 */
async function withTimeout(label, operation, timeoutMs = 30_000) {
	let timer;
	try {
		return await Promise.race([
			operation,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Waits for the local editor server while reporting periodic progress.
 *
 * @param {string} url Editor URL to probe.
 * @returns {Promise<void>}
 */
async function waitForServer(url) {
	step(`waiting for ${url}`);
	for (let attempt = 1; attempt <= 60; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				step(`server ready after ${attempt} attempt(s)`);
				return;
			}
		} catch {}
		if (attempt % 10 === 0) step(`server not ready after ${attempt} attempts`);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`UI workshop did not start.\n${serverLog}`);
}

await mkdir(output, { recursive: true });
let browser;
try {
	const url = `http://127.0.0.1:${port}/app`;
	await waitForServer(url);
	step('launching Chrome');
	browser = await withTimeout('Chrome launch', chromium.launch({ channel: 'chrome', headless: true }));

	for (const theme of ['light', 'dark']) {
		step(`capturing ${theme} desktop states`);
		const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
		await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
		await withTimeout(`${theme} navigation`, page.goto(url, { waitUntil: 'networkidle' }));
		await withTimeout(
			`${theme} default screenshot`,
			page.screenshot({ path: `${output}/ui-audit-${theme}.png`, fullPage: true })
		);
		await withTimeout(`${theme} hover`, page.getByRole('button', { name: 'Direct Select', exact: true }).hover());
		await withTimeout(
			`${theme} hover screenshot`,
			page.screenshot({ path: `${output}/ui-audit-${theme}-hover.png`, fullPage: true })
		);
		await page.getByRole('button', { name: 'Direct Select', exact: true }).focus();
		await withTimeout(
			`${theme} focus screenshot`,
			page.screenshot({ path: `${output}/ui-audit-${theme}-focus.png`, fullPage: true })
		);
		await page.close();
	}

	step('capturing dark mobile state');
	const mobileContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true
	});
	const mobile = await mobileContext.newPage();
	await mobile.addInitScript(() => localStorage.setItem('theme', 'dark'));
	await withTimeout('mobile navigation', mobile.goto(url, { waitUntil: 'networkidle' }));
	await withTimeout(
		'mobile screenshot',
		mobile.screenshot({ path: `${output}/ui-audit-mobile.png`, fullPage: true })
	);
	await mobileContext.close();
	step('capture complete');
} finally {
	step('closing browser and development server');
	await withTimeout('browser close', browser?.close() ?? Promise.resolve(), 10_000).catch((error) =>
		console.error(`[capture] ${error.message}`)
	);
	server.kill('SIGTERM');
}
