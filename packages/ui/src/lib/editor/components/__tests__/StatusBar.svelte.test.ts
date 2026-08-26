import { CursorStore, Store } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createSnapStore, createStatusStore } from '../../status';
import StatusBar from '../StatusBar.svelte';

describe('StatusBar', () => {
	it('shows the world-space viewport origin beside the cursor position', async () => {
		const store = new Store();
		store.setState((state) => ({ ...state, camera: { x: 100, y: 200, zoom: 2 } }));
		const screen = render(StatusBar, {
			store,
			cursor: new CursorStore(),
			persistence: createStatusStore({
				backend: 'indexeddb',
				state: 'saved',
				pendingWrites: 0
			}),
			snap: createSnapStore(),
			viewport: { width: 800, height: 600 }
		});

		await expect.element(screen.getByText('-100, 50')).toBeInTheDocument();
	});

	it('keeps changing coordinate segments at a fixed width', async () => {
		const cursor = new CursorStore();
		const screen = render(StatusBar, {
			store: new Store(),
			cursor,
			persistence: createStatusStore({
				backend: 'indexeddb',
				state: 'saved',
				pendingWrites: 0
			}),
			snap: createSnapStore()
		});
		const segment = screen
			.getByText('Cursor')
			.element()
			.closest<HTMLElement>('.status-bar__section--coordinates');
		if (!segment) throw new Error('Expected a coordinate status segment');
		const initialWidth = segment.getBoundingClientRect().width;

		cursor.updateCursor({ x: -123456, y: 987654 });
		await expect.element(screen.getByText('-123456, 987654')).toBeInTheDocument();
		expect(segment.getBoundingClientRect().width).toBe(initialWidth);
	});

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

	it('hides grid size when the grid is disabled', async () => {
		const snap = createSnapStore({ gridEnabled: true });
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

		await expect
			.element(screen.getByRole('spinbutton', { name: 'Grid size' }))
			.toBeInTheDocument();
		await screen.getByRole('checkbox', { name: 'Enable grid snapping' }).click();
		await expect
			.element(screen.getByRole('spinbutton', { name: 'Grid size' }))
			.not.toBeInTheDocument();
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
			version: 'v1.2.3-4+gabc1234',
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
		await expect.element(screen.getByText('Version v1.2.3-4+gabc1234')).toBeInTheDocument();
		await expect
			.element(screen.getByRole('link', { name: 'Changelog' }))
			.toHaveAttribute('href', 'https://ink.stormlightlabs.org/docs/changelog/');
		expect(window.getComputedStyle(dialog.element()).borderRadius).toBe('16px');
	});
});
