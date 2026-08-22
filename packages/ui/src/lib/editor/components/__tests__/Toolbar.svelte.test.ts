import { PageRecord, ShapeRecord, Store } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createBrushStore } from '../../status';
import Toolbar from '../Toolbar.svelte';

function createSelectedRectStore() {
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
	return store;
}

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
		await expect
			.element(screen.getByRole('button', { name: 'Zoom level' }))
			.not.toBeInTheDocument();
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

		handle.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
		);

		await vi.waitFor(() => expect(toolbar.style.left).toBe('8px'));
	});

	it('rotates the tool dock from its handle', async () => {
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store: new Store(),
			brushStore: createBrushStore()
		});
		const toolbar = screen.getByRole('toolbar', { name: 'Drawing tools' }).element();
		const handle = screen.getByRole('button', { name: 'Drag toolbar' });
		const initialHorizontal = toolbar.classList.contains('toolbar--horizontal');

		await handle.click();
		await vi.waitFor(() =>
			expect(toolbar.classList.contains('toolbar--horizontal')).toBe(!initialHorizontal)
		);
	});

	it('rotates the drag icon for a vertical tool dock', async () => {
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store: new Store(),
			brushStore: createBrushStore()
		});
		const toolbar = screen.getByRole('toolbar', { name: 'Drawing tools' }).element();
		const handle = screen.getByRole('button', { name: 'Drag toolbar' });
		if (toolbar.classList.contains('toolbar--horizontal')) await handle.click();

		const icon = toolbar.querySelector('.toolbar__drag-icon');
		expect(icon).not.toBeNull();
		expect(getComputedStyle(icon as HTMLElement).transform).not.toBe('none');
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
		await expect
			.element(screen.getByRole('menuitem', { name: 'Editable document' }))
			.toBeInTheDocument();
		(
			screen
				.getByRole('menuitem', { name: 'Editable document' })
				.element() as HTMLButtonElement
		).click();
		expect(onImportEditable).toHaveBeenCalledOnce();

		(screen.getByRole('button', { name: 'Import' }).element() as HTMLButtonElement).click();
		(
			screen.getByRole('menuitem', { name: 'SVG file' }).element() as HTMLButtonElement
		).click();
		expect(onImportSvg).toHaveBeenCalledOnce();

		(screen.getByRole('button', { name: 'Import' }).element() as HTMLButtonElement).click();
		(
			screen
				.getByRole('menuitem', { name: 'SVG code / markup' })
				.element() as HTMLButtonElement
		).click();
		expect(onImportSvgMarkup).toHaveBeenCalledOnce();

		(
			screen.getByRole('button', { name: 'Export drawing' }).element() as HTMLButtonElement
		).click();
		await expect
			.element(
				screen.getByRole('menuitem', { name: 'Export as Excalidraw editable document' })
			)
			.toBeInTheDocument();
		(
			screen
				.getByRole('menuitem', { name: 'Export as Excalidraw editable document' })
				.element() as HTMLButtonElement
		).click();
		expect(onExportEditable).toHaveBeenCalledWith('excalidraw');

		(
			screen.getByRole('button', { name: 'Export drawing' }).element() as HTMLButtonElement
		).click();
		await expect
			.element(
				screen.getByRole('menuitem', {
					name: 'Export as Obsidian Canvas editable document'
				})
			)
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

		const penBounds = screen
			.getByRole('button', { name: 'Pen' })
			.element()
			.getBoundingClientRect();
		const brushBounds = screen
			.getByRole('button', { name: 'Brush settings' })
			.element()
			.getBoundingClientRect();

		expect(brushBounds.top).toBeGreaterThan(penBounds.bottom);
		expect(
			screen
				.getByRole('button', { name: 'Brush settings' })
				.element()
				.closest('.toolbar__pen-context')
		).toBeTruthy();
	});

	it('changes selected colors and opacity through labeled undoable controls', async () => {
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

		await screen.getByRole('button', { name: 'Fill color' }).click();
		await screen
			.getByRole('group', { name: 'Quick colors' })
			.getByRole('button', { name: 'blue 3' })
			.click();
		const fillShape = store.getState().doc.shapes.shape;
		if (fillShape.type !== 'rect') throw new Error('Expected a rectangle shape');
		expect(fillShape.props.fill).toBe('#0089fc');

		await screen.getByRole('button', { name: 'Transparent' }).click();
		const transparentFillShape = store.getState().doc.shapes.shape;
		if (transparentFillShape.type !== 'rect') throw new Error('Expected a rectangle shape');
		expect(transparentFillShape.props.fill).toBe('transparent');
		await screen.getByRole('button', { name: 'blue 3' }).click();

		await screen.getByRole('button', { name: 'Stroke color' }).click();
		await screen
			.getByRole('group', { name: 'Quick colors' })
			.getByRole('button', { name: 'red 3' })
			.click();
		const strokeShape = store.getState().doc.shapes.shape;
		if (strokeShape.type !== 'rect') throw new Error('Expected a rectangle shape');
		expect(strokeShape.props.stroke).toBe('#ff4647');

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

	it('hides the agent edit control when it is not enabled', async () => {
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store: createSelectedRectStore(),
			brushStore: createBrushStore(),
			showAgentControl: false
		});

		await expect
			.element(screen.getByRole('checkbox', { name: 'Agent editable' }))
			.not.toBeInTheDocument();
	});

	it('changes whether agents may edit selected shapes', async () => {
		const store = createSelectedRectStore();
		const screen = render(Toolbar, {
			currentTool: 'select',
			onToolChange: vi.fn(),
			store,
			brushStore: createBrushStore(),
			showAgentControl: true
		});

		const control = screen.getByRole('checkbox', { name: 'Agent editable' });
		await expect.element(control).toBeChecked();
		await control.click();

		expect(store.getState().doc.shapes.shape.agentEditable).toBe(false);
		expect(store.canUndo()).toBe(true);
	});
});
