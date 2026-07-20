import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	use: { baseURL: 'http://127.0.0.1:4174', channel: 'chrome', trace: 'on-first-retry' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm build:workshop && pnpm preview --host 127.0.0.1 --port 4174',
		port: 4174,
		reuseExistingServer: !process.env.CI
	}
});
