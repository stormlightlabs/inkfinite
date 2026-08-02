import { CursorStore, Store } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createSnapStore, createStatusStore } from '../status';
import StatusBar from './StatusBar.svelte';

describe('StatusBar', () => {
	it('updates snapping preferences from accessible controls', async () => {
		const snap = createSnapStore();
		const screen = render(StatusBar, {
			store: new Store(),
			cursor: new CursorStore(),
			persistence: createStatusStore({
				backend: 'indexeddb',
				state: 'saved',
				pendingWrites: 0
			}),
			snap
		});

		await screen.getByRole('checkbox', { name: 'Enable main snapping' }).click();
		await screen.getByRole('checkbox', { name: 'Enable grid snapping' }).click();

		expect(snap.get()).toMatchObject({ snapEnabled: true, gridEnabled: false });
	});

	it('surfaces persistence failures', async () => {
		const screen = render(StatusBar, {
			store: new Store(),
			cursor: new CursorStore(),
			persistence: createStatusStore({
				backend: 'indexeddb',
				state: 'error',
				pendingWrites: 0,
				errorMsg: 'Storage unavailable'
			}),
			snap: createSnapStore()
		});

		await expect.element(screen.getByText(/error/i)).toHaveClass('status-bar__value--error');
	});

	it('identifies a safely persisted desktop draft', async () => {
		const onOpenBrowser = vi.fn();
		const screen = render(StatusBar, {
			store: new Store(),
			cursor: new CursorStore(),
			persistence: createStatusStore({
				backend: 'filesystem',
				state: 'saved',
				pendingWrites: 0
			}),
			snap: createSnapStore(),
			platform: 'desktop',
			draft: true,
			onOpenBrowser
		});

		await expect.element(screen.getByText('Draft saved')).toBeInTheDocument();
		await screen.getByRole('button', { name: 'Browse boards' }).click();
		expect(onOpenBrowser).toHaveBeenCalledOnce();
	});

	it('keeps editor utilities together and opens the info dialog', async () => {
		const onOpenBrowser = vi.fn();
		const onHistoryClick = vi.fn();
		const screen = render(StatusBar, {
			store: new Store(),
			cursor: new CursorStore(),
			persistence: createStatusStore({
				backend: 'indexeddb',
				state: 'saved',
				pendingWrites: 0
			}),
			snap: createSnapStore(),
			onOpenBrowser,
			onHistoryClick
		});

		await screen.getByRole('button', { name: 'Browse boards' }).click();
		await screen.getByRole('button', { name: 'History' }).click();
		await screen.getByRole('button', { name: 'About Inkfinite' }).click();

		expect(onOpenBrowser).toHaveBeenCalledOnce();
		expect(onHistoryClick).toHaveBeenCalledOnce();
		const dialog = screen.getByRole('dialog', { name: 'About Inkfinite' });
		await expect.element(dialog).toBeInTheDocument();
		expect(window.getComputedStyle(dialog.element()).borderRadius).toBe('16px');
	});
});
