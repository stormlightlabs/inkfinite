import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createFileBrowserFixture } from '../../../../test/editor-fixtures';
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
});
