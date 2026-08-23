import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
	expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
	use: {
		...devices['Desktop Chrome'],
		baseURL: 'http://127.0.0.1:4175',
		channel: 'chrome',
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
		viewport: { width: 1440, height: 960 }
	},
	projects: [{ name: 'chromium' }],
	webServer: {
		command: 'pnpm dev:plain --host 127.0.0.1 --port 4175',
		port: 4175,
		reuseExistingServer: !process.env.CI
	}
});
