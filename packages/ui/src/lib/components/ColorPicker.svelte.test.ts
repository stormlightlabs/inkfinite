import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import ColorPicker from './ColorPicker.svelte';

describe('ColorPicker', () => {
	it('opens an accessible Reasonable Colors palette', async () => {
		const screen = render(ColorPicker, {
			label: 'Fill color',
			onchange: vi.fn(),
			value: '#0089fc'
		});

		const trigger = screen.getByRole('button', { name: 'Fill color' });
		await trigger.click();

		await expect
			.element(screen.getByRole('dialog', { name: 'Fill color' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('group', { name: 'Quick colors' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'blue 1' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('textbox', { name: 'Hex color' }))
			.toHaveValue('#0089fc');
		await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('reports quick, shade, and recent color selections', async () => {
		const onchange = vi.fn();
		const screen = render(ColorPicker, {
			label: 'Stroke color',
			onchange,
			recentColors: ['#ABC'],
			value: '#0089fc'
		});
		await screen.getByRole('button', { name: 'Stroke color' }).click();

		const violetQuickColor = screen
			.getByRole('group', { name: 'Quick colors' })
			.getByRole('button', { name: 'violet 3' });
		violetQuickColor.element().focus();
		await expect
			.element(screen.getByRole('group', { name: 'violet shades' }))
			.toBeInTheDocument();

		await violetQuickColor.click();
		expect(onchange).toHaveBeenLastCalledWith('#9b70ff');

		await screen
			.getByRole('group', { name: 'violet shades' })
			.getByRole('button', { name: 'violet 6' })
			.click();
		expect(onchange).toHaveBeenLastCalledWith('#0b0074');

		await screen
			.getByRole('group', { name: 'Recent colors' })
			.getByRole('button', { name: 'Recent #aabbcc' })
			.click();
		expect(onchange).toHaveBeenLastCalledWith('#aabbcc');
	});

	it('accepts valid custom hex values and explains invalid ones', async () => {
		const onchange = vi.fn();
		const screen = render(ColorPicker, { label: 'Fill color', onchange, value: '#0089fc' });
		await screen.getByRole('button', { name: 'Fill color' }).click();

		const hex = screen.getByRole('textbox', { name: 'Hex color' });
		await hex.fill('#abc');
		await screen.getByRole('button', { name: 'Apply' }).click();
		expect(onchange).toHaveBeenLastCalledWith('#aabbcc');

		await hex.fill('not-a-color');
		await screen.getByRole('button', { name: 'Apply' }).click();
		await expect.element(hex).toHaveAttribute('aria-invalid', 'true');
		await expect
			.element(screen.getByText('Enter a 3- or 6-digit hex color.'))
			.toBeInTheDocument();
	});

	it('closes on Escape, restores focus, and respects disabled state', async () => {
		const screen = render(ColorPicker, {
			disabled: true,
			label: 'Disabled color',
			onchange: vi.fn(),
			value: '#0089fc'
		});
		const disabledTrigger = screen.getByRole('button', { name: 'Disabled color' });
		await expect.element(disabledTrigger).toBeDisabled();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();

		const enabledScreen = render(ColorPicker, {
			label: 'Enabled color',
			onchange: vi.fn(),
			value: '#0089fc'
		});
		const trigger = enabledScreen.getByRole('button', { name: 'Enabled color' });
		await trigger.click();
		await userEvent.keyboard('{Escape}');

		await expect.element(enabledScreen.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(trigger).toHaveFocus();
	});
});
