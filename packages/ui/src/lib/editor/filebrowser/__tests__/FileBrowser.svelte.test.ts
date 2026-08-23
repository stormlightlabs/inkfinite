import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createFileBrowserFixture } from '../../../../test/editor-fixtures';
import { createStatusStore } from '../../status';
import FileBrowser from '../FileBrowser.svelte';

describe('FileBrowser', () => {
	it('filters boards and reports the updated view model', async () => {
		const onUpdate = vi.fn();
		const { vm } = createFileBrowserFixture();
		const screen = render(FileBrowser, { vm, open: true, onUpdate });

		await screen.getByRole('searchbox', { name: 'Search boards' }).fill('Second');

		await expect.element(screen.getByText('First board')).not.toBeInTheDocument();
		await expect.element(screen.getByText('Second board')).toBeInTheDocument();
		expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Second' }));
	});

	it('creates and opens a named board before closing', async () => {
		const onClose = vi.fn();
		const { repo, vm } = createFileBrowserFixture();
		const screen = render(FileBrowser, { vm, open: true, onClose });

		await screen.getByRole('button', { name: 'Create new board' }).click();
		await screen.getByRole('textbox', { name: 'New board name' }).fill('New map');
		await screen.getByRole('button', { name: 'Create', exact: true }).click();

		expect(repo.createBoard).toHaveBeenCalledWith('New map');
		expect(repo.openBoard).toHaveBeenCalledWith('board:new');
		expect(onClose).toHaveBeenCalledOnce();
	});

	it('shows the active board storage and save state', async () => {
		const { vm } = createFileBrowserFixture();
		const persistence = createStatusStore({
			backend: 'indexeddb',
			state: 'saving',
			pendingWrites: 1
		});
		const screen = render(FileBrowser, {
			vm,
			open: true,
			activeBoardId: 'board:two',
			persistence
		});

		await expect.element(screen.getByText('Active board')).toBeInTheDocument();
		await expect.element(screen.getByText('This browser')).toBeInTheDocument();
		await expect.element(screen.getByText('Saving…')).toBeInTheDocument();
	});

	it('moves focus through boards with arrow keys', async () => {
		const { vm } = createFileBrowserFixture();
		const screen = render(FileBrowser, { vm, open: true });
		const first = screen.getByRole('button', { name: 'Open Second board' });

		first.element().focus();
		first
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.activeElement?.getAttribute('aria-label')).toBe('Open First board');
	});
});
