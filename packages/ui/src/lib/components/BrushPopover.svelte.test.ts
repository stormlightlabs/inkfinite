import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
		const user = userEvent.setup();
		render(BrushPopover, { brush, onBrushChange: vi.fn() });

		await user.click(screen.getByRole('button', { name: 'Brush settings' }));

		expect(screen.getByRole('dialog', { name: 'Brush settings' })).toBeInTheDocument();
		expect(screen.getByLabelText('Brush size')).toHaveValue('16');
		expect(screen.getByLabelText('Brush thinning')).toHaveValue('0.5');
		expect(screen.getByLabelText('Simulate pressure')).toBeChecked();
	});

	it('reports completed brush changes', async () => {
		const user = userEvent.setup();
		const onBrushChange = vi.fn();
		render(BrushPopover, { brush, onBrushChange });
		await user.click(screen.getByRole('button', { name: 'Brush settings' }));

		const size = screen.getByLabelText('Brush size');
		await fireEvent.input(size, { target: { value: '25' } });
		await fireEvent.change(size);

		expect(onBrushChange).toHaveBeenLastCalledWith({ ...brush, size: 25 });
	});

	it('does not open while disabled', async () => {
		const user = userEvent.setup();
		render(BrushPopover, { brush, disabled: true, onBrushChange: vi.fn() });

		const button = screen.getByRole('button', { name: 'Brush settings' });
		await user.click(button);

		expect(button).toBeDisabled();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
