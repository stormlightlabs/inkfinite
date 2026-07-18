import { PageRecord, ShapeRecord, Store } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createBrushStore } from '../status';
import Toolbar from './Toolbar.svelte';

describe('Editor Toolbar', () => {
	it('selects tools and opens the zoom menu through accessible controls', async () => {
		const onToolChange = vi.fn();
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange,
			store: new Store(),
			getViewport: () => ({ width: 1024, height: 768 }),
			brushStore: createBrushStore()
		});

		await screen.getByRole('button', { name: 'Rectangle' }).click();
		expect(onToolChange).toHaveBeenCalledWith('rect');

		(
			screen.getByRole('button', { name: 'Zoom level' }).element() as HTMLButtonElement
		).click();
		await expect
			.element(screen.getByRole('menu', { name: 'Zoom options' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Zoom to 100%' }))
			.toBeInTheDocument();
	});

	it('changes selected fill and stroke opacity through labeled undoable controls', async () => {
		const page = PageRecord.create('Page', 'page');
		const shape = ShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 20, h: 20, fill: '#fff', stroke: '#000', radius: 0 },
			'shape'
		);
		const store = new Store();
		store.setState((state) => ({
			...state,
			doc: {
				pages: { [page.id]: { ...page, shapeIds: [shape.id] } },
				shapes: { [shape.id]: shape },
				bindings: {}
			},
			ui: { ...state.ui, currentPageId: page.id, selectionIds: [shape.id] }
		}));
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store,
			getViewport: () => ({ width: 1024, height: 768 }),
			brushStore: createBrushStore()
		});

		const fill = screen
			.getByRole('slider', { name: 'Fill opacity' })
			.element() as HTMLInputElement;
		fill.value = '0.4';
		fill.dispatchEvent(new Event('change', { bubbles: true }));
		const stroke = screen
			.getByRole('slider', { name: 'Stroke opacity' })
			.element() as HTMLInputElement;
		stroke.value = '0.65';
		stroke.dispatchEvent(new Event('change', { bubbles: true }));

		expect(store.getState().doc.shapes.shape.fillOpacity).toBe(0.4);
		expect(store.getState().doc.shapes.shape.strokeOpacity).toBe(0.65);
		expect(store.canUndo()).toBe(true);
	});
});
