import { Store } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { CameraController } from './controllers/camera-controller';
import NavigationControls from './NavigationControls.svelte';

describe('NavigationControls', () => {
	it('offers zoom and fit controls with an updating zoom readout', async () => {
		const store = new Store();
		const camera = new CameraController(store, () => ({ width: 800, height: 600 }));
		const screen = render(NavigationControls, { store, camera });

		await expect
			.element(screen.getByRole('navigation', { name: 'Canvas navigation' }))
			.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Zoom in' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Reset zoom to 100%' }))
			.toHaveTextContent('120%');
		await screen.getByRole('button', { name: 'Reset zoom to 100%' }).click();
		expect(store.getState().camera.zoom).toBe(1);
	});
});
