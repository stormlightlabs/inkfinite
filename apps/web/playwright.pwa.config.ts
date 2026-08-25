import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	testMatch: 'pwa.spec.ts',
	fullyParallel: false,
	workers: 1,
	reporter: 'list',
	snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
	expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
	use: {
		...devices['Desktop Chrome'],
		baseURL: 'http://127.0.0.1:4375',
		channel: 'chrome',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium' }],
	webServer: {
		command: 'pnpm preview --host 127.0.0.1 --port 4375',
		port: 4375,
		reuseExistingServer: false
	}
});
