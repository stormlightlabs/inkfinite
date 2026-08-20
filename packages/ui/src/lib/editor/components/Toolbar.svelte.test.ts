import { PageRecord, ShapeRecord, Store } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createBrushStore } from '../status';
import Toolbar from './Toolbar.svelte';

describe('Editor Toolbar', () => {
	it('selects tools through accessible controls', async () => {
		const onToolChange = vi.fn();
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange,
			store: new Store(),
			brushStore: createBrushStore()
		});

		await screen.getByRole('button', { name: 'Rectangle' }).click();
		expect(onToolChange).toHaveBeenCalledWith('rect');
		await expect.element(screen.getByRole('button', { name: 'Zoom level' })).not.toBeInTheDocument();
	});

	it('keeps drawing tools in one row when the window narrows', async () => {
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store: new Store(),
			brushStore: createBrushStore()
		});

		await expect
			.element(screen.getByRole('toolbar', { name: 'Drawing tools' }))
			.toHaveStyle({ flexWrap: 'nowrap' });
	});

	it('moves the floating toolbar from its accessible drag handle', async () => {
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store: new Store(),
			brushStore: createBrushStore()
		});
		const toolbar = screen.getByRole('toolbar', { name: 'Drawing tools' }).element();
		const handle = screen.getByRole('button', { name: 'Drag toolbar' }).element();

		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));

		await vi.waitFor(() => expect(toolbar.style.left).toBe('8px'));
	});

	it('offers import choices and editable export actions', async () => {
		const onImportEditable = vi.fn();
		const onImportSvg = vi.fn();
		const onImportSvgMarkup = vi.fn();
		const onExportEditable = vi.fn();
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store: new Store(),
			brushStore: createBrushStore(),
			onImportEditable,
			onImportSvg,
			onImportSvgMarkup,
			onExportEditable
		});

		(screen.getByRole('button', { name: 'Import' }).element() as HTMLButtonElement).click();
		await expect.element(screen.getByRole('menuitem', { name: 'Editable document' })).toBeInTheDocument();
		(screen.getByRole('menuitem', { name: 'Editable document' }).element() as HTMLButtonElement).click();
		expect(onImportEditable).toHaveBeenCalledOnce();

		(screen.getByRole('button', { name: 'Import' }).element() as HTMLButtonElement).click();
		(screen.getByRole('menuitem', { name: 'SVG file' }).element() as HTMLButtonElement).click();
		expect(onImportSvg).toHaveBeenCalledOnce();

		(screen.getByRole('button', { name: 'Import' }).element() as HTMLButtonElement).click();
		(screen.getByRole('menuitem', { name: 'SVG code / markup' }).element() as HTMLButtonElement).click();
		expect(onImportSvgMarkup).toHaveBeenCalledOnce();

		(screen.getByRole('button', { name: 'Export drawing' }).element() as HTMLButtonElement).click();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Export as Excalidraw editable document' }))
			.toBeInTheDocument();
		(
			screen
				.getByRole('menuitem', { name: 'Export as Excalidraw editable document' })
				.element() as HTMLButtonElement
		).click();
		expect(onExportEditable).toHaveBeenCalledWith('excalidraw');

		(screen.getByRole('button', { name: 'Export drawing' }).element() as HTMLButtonElement).click();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Export as Obsidian Canvas editable document' }))
			.toBeInTheDocument();
		(
			screen
				.getByRole('menuitem', { name: 'Export as Obsidian Canvas editable document' })
				.element() as HTMLButtonElement
		).click();
		expect(onExportEditable).toHaveBeenCalledWith('json-canvas');
	});

	it('anchors pen settings directly below the pen tool', async () => {
		const screen = render(Toolbar, {
			currentTool: 'pen',
			onToolChange: vi.fn(),
			store: new Store(),
			brushStore: createBrushStore()
		});

		const penBounds = screen.getByRole('button', { name: 'Pen' }).element().getBoundingClientRect();
		const brushBounds = screen.getByRole('button', { name: 'Brush settings' }).element().getBoundingClientRect();

		expect(brushBounds.top).toBeGreaterThan(penBounds.bottom);
		expect(brushBounds.right).toBeCloseTo(penBounds.right, 0);
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
			brushStore: createBrushStore()
		});

		const fill = screen.getByRole('slider', { name: 'Fill opacity' }).element() as HTMLInputElement;
		fill.value = '0.4';
		fill.dispatchEvent(new Event('change', { bubbles: true }));
		const stroke = screen.getByRole('slider', { name: 'Stroke opacity' }).element() as HTMLInputElement;
		stroke.value = '0.65';
		stroke.dispatchEvent(new Event('change', { bubbles: true }));

		expect(store.getState().doc.shapes.shape.fillOpacity).toBe(0.4);
		expect(store.getState().doc.shapes.shape.strokeOpacity).toBe(0.65);
		expect(store.canUndo()).toBe(true);
	});

	it('changes whether agents may edit selected shapes', async () => {
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
			brushStore: createBrushStore()
		});

		const control = screen.getByRole('checkbox', { name: 'Agent editable' });
		await expect.element(control).toBeChecked();
		await control.click();

		expect(store.getState().doc.shapes.shape.agentEditable).toBe(false);
		expect(store.canUndo()).toBe(true);
	});
});
