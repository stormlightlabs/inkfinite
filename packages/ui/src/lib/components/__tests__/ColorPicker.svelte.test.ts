import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import ColorPicker from '../ColorPicker.svelte';

describe('ColorPicker', () => {
	it('opens a compact quick palette with recent colors', async () => {
		const screen = render(ColorPicker, {
			label: 'Fill color',
			onchange: vi.fn(),
			recentColors: ['#ABC'],
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
		await expect.element(screen.getByRole('button', { name: 'blue 3' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Recent #aabbcc' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Custom…' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('link', { name: 'Reasonable Colors' }))
			.toHaveAttribute(
				'href',
				'https://www.reasonable.work/artifacts/ra005-reasonable-colors/'
			);
		const expandIcon = screen
			.getByRole('button', { name: 'Custom…' })
			.element()
			.querySelector('.i-bi-arrows-angle-expand');
		expect(expandIcon).not.toBeNull();
		await expect
			.element(screen.getByRole('group', { name: 'blue shades' }))
			.not.toBeInTheDocument();
		await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('opens all families and shades behind Custom', async () => {
		const onchange = vi.fn();
		const screen = render(ColorPicker, { label: 'Stroke color', onchange, value: '#0089fc' });
		await screen.getByRole('button', { name: 'Stroke color' }).click();
		await screen.getByRole('button', { name: 'Custom…' }).click();

		await expect
			.element(screen.getByRole('group', { name: 'Color families' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'pink' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('group', { name: 'blue shades' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('textbox', { name: 'Hex color' }))
			.toHaveValue('#0089fc');

		await screen.getByRole('button', { name: 'violet' }).click();
		await screen
			.getByRole('group', { name: 'violet shades' })
			.getByRole('button', { name: 'violet 6' })
			.click();
		expect(onchange).toHaveBeenLastCalledWith('#0b0074');

		await screen.getByRole('button', { name: 'Palette' }).click();
		await expect.element(screen.getByRole('button', { name: 'Custom…' })).toBeInTheDocument();
	});

	it('moves through quick swatches with arrow keys', async () => {
		const screen = render(ColorPicker, {
			label: 'Fill color',
			onchange: vi.fn(),
			value: '#0089fc'
		});
		await screen.getByRole('button', { name: 'Fill color' }).click();

		const gray = screen.getByRole('button', { name: 'gray 6' });
		gray.element().focus();
		await userEvent.keyboard('{ArrowRight}');

		await expect.element(screen.getByRole('button', { name: 'gray 3' })).toHaveFocus();
	});

	it('accepts valid custom hex values and explains invalid ones', async () => {
		const onchange = vi.fn();
		const screen = render(ColorPicker, { label: 'Fill color', onchange, value: '#0089fc' });
		await screen.getByRole('button', { name: 'Fill color' }).click();
		await screen.getByRole('button', { name: 'Custom…' }).click();

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

	it('selects transparent when the property allows none', async () => {
		const onchange = vi.fn();
		const screen = render(ColorPicker, {
			allowNone: true,
			label: 'Fill color',
			onchange,
			value: '#0089fc'
		});
		await screen.getByRole('button', { name: 'Fill color' }).click();
		await screen.getByRole('button', { name: 'Transparent' }).click();

		expect(onchange).toHaveBeenLastCalledWith('transparent');
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
