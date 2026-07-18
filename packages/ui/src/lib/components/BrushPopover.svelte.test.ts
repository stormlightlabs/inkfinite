import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import BrushPopover, { type BrushSettings } from './BrushPopover.svelte';

const brush: BrushSettings = {
	color: '#88c0d0',
	simulatePressure: true,
	size: 16,
	smoothing: 0.5,
	streamline: 0.5,
	thinning: 0.5
};

describe('BrushPopover', () => {
	it('opens an accessible set of brush controls', async () => {
		const screen = render(BrushPopover, { brush, onBrushChange: vi.fn() });

		await screen.getByRole('button', { name: 'Brush settings' }).click();

		await expect
			.element(screen.getByRole('dialog', { name: 'Brush settings' }))
			.toBeInTheDocument();
		await expect.element(screen.getByLabelText('Brush size')).toHaveValue('16');
		await expect.element(screen.getByLabelText('Brush thinning')).toHaveValue('0.5');
		await expect.element(screen.getByLabelText('Simulate pressure')).toBeChecked();
	});

	it('reports completed brush changes', async () => {
		const onBrushChange = vi.fn();
		const screen = render(BrushPopover, { brush, onBrushChange });
		await screen.getByRole('button', { name: 'Brush settings' }).click();

		const size = screen.getByLabelText('Brush size').element() as HTMLInputElement;
		size.value = '25';
		size.dispatchEvent(new Event('input', { bubbles: true }));
		size.dispatchEvent(new Event('change', { bubbles: true }));

		expect(onBrushChange).toHaveBeenLastCalledWith({ ...brush, size: 25 });
	});

	it('does not open while disabled', async () => {
		const screen = render(BrushPopover, { brush, disabled: true, onBrushChange: vi.fn() });

		const button = screen.getByRole('button', { name: 'Brush settings' });
		await expect.element(button).toBeDisabled();
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});
});
