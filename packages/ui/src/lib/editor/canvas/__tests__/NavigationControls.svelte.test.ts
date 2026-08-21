import { Store } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { CameraController } from '../controllers/camera-controller';
import NavigationControls from '../NavigationControls.svelte';

describe('NavigationControls', () => {
	it('offers zoom presets and fit controls with an updating zoom readout', async () => {
		const store = new Store();
		const camera = new CameraController(store, () => ({ width: 800, height: 600 }));
		const screen = render(NavigationControls, { store, camera });

		await expect
			.element(screen.getByRole('navigation', { name: 'Canvas navigation' }))
			.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Zoom in' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Zoom level' }))
			.toHaveTextContent('120%');
		await screen.getByRole('button', { name: 'Zoom level' }).click();
		await expect
			.element(screen.getByRole('menu', { name: 'Zoom options' }))
			.toBeInTheDocument();
		await screen.getByRole('menuitem', { name: 'Zoom to 100%' }).click();
		expect(store.getState().camera.zoom).toBe(1);
		await screen.getByRole('button', { name: 'Zoom level' }).click();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Zoom to fit' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Zoom to selection' }))
			.toBeInTheDocument();
	});
});
