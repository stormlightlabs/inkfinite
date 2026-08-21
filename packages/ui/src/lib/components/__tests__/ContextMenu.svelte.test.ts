import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ContextMenu, { type ContextMenuEntry } from '../ContextMenu.svelte';

const items: ContextMenuEntry[] = [
	{ id: 'duplicate', label: 'Duplicate', icon: 'add', shortcut: '⌘D' },
	{ id: 'visible', label: 'Visible', checked: true },
	{ type: 'separator' },
	{ id: 'delete', label: 'Delete', icon: 'delete', danger: true },
	{ id: 'disabled', label: 'Unavailable', disabled: true }
];

describe('ContextMenu', () => {
	it('renders accessible items, state, shortcuts, and separators', async () => {
		const screen = render(ContextMenu, {
			open: true,
			x: 40,
			y: 40,
			items,
			onOpenChange: vi.fn(),
			onSelect: vi.fn()
		});

		await expect
			.element(screen.getByRole('menu', { name: 'Context menu' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('menuitemcheckbox', { name: 'Visible' }))
			.toBeChecked();
		await expect.element(screen.getByText('⌘D')).toBeInTheDocument();
		await expect.element(screen.getByRole('separator')).toBeInTheDocument();
		await expect.element(screen.getByRole('menuitem', { name: 'Unavailable' })).toBeDisabled();
	});

	it('selects an enabled command and asks the owner to close', async () => {
		const onOpenChange = vi.fn();
		const onSelect = vi.fn();
		const screen = render(ContextMenu, {
			open: true,
			x: 40,
			y: 40,
			items,
			onOpenChange,
			onSelect
		});

		await screen.getByRole('menuitem', { name: 'Delete' }).click();
		expect(onSelect).toHaveBeenCalledWith('delete');
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('moves focus with arrow keys and restores it on Escape', async () => {
		const trigger = document.createElement('button');
		trigger.textContent = 'Trigger';
		document.body.append(trigger);
		const onOpenChange = vi.fn();
		const screen = render(ContextMenu, {
			open: true,
			x: 40,
			y: 40,
			items,
			returnFocus: trigger,
			onOpenChange,
			onSelect: vi.fn()
		});

		await expect.element(screen.getByRole('menu')).toBeInTheDocument();
		const menu = screen.getByRole('menu').element() as HTMLElement;
		await expect.element(screen.getByRole('menuitem', { name: 'Duplicate' })).toHaveFocus();
		menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await expect
			.element(screen.getByRole('menuitemcheckbox', { name: 'Visible' }))
			.toHaveFocus();
		menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(document.activeElement).toBe(trigger);
		trigger.remove();
	});
});
