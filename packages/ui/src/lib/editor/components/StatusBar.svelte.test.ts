import { CursorStore, Store } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
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
});
