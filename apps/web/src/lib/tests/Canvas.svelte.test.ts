import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Canvas from '$editor/canvas/Canvas.svelte';
import { createTestPlatformAdapter } from './test-platform';

const renderCanvas = () => render(Canvas, { platform: createTestPlatformAdapter() });

vi.mock('$editor/status', () => {
	return {
		createStatusStore: () => ({
			get: () => ({ backend: 'indexeddb', state: 'saved', pendingWrites: 0 }),
			subscribe: () => () => {},
			update: () => {}
		}),
		createSnapStore: () => ({
			get: () => ({ snapEnabled: false, gridEnabled: true, gridSize: 25 }),
			subscribe: () => () => {},
			update: () => {},
			set: () => {}
		}),
		createBrushStore: () => ({
			get: () => ({
				size: 16,
				thinning: 0.5,
				smoothing: 0.5,
				streamline: 0.5,
				simulatePressure: true,
				color: '#88c0d0'
			}),
			subscribe: () => () => {},
			update: () => {},
			set: () => {}
		})
	};
});

describe('Canvas component', () => {
	beforeEach(() => {
		cleanup();
	});

	it('should render a canvas element', () => {
		const { container } = renderCanvas();
		const canvas = container.querySelector('canvas');

		expect(canvas).toBeTruthy();
		expect(canvas?.tagName).toBe('CANVAS');
	});

	it('should create canvas with full dimensions', () => {
		const { container } = renderCanvas();
		const canvas = container.querySelector('canvas') as HTMLCanvasElement;

		const style = window.getComputedStyle(canvas);
		expect(style.width).toBeTruthy();
		expect(style.height).toBeTruthy();
		expect(style.display).toBe('block');
	});

	it('should have touch-action: none for pointer events', () => {
		const { container } = renderCanvas();
		const canvas = container.querySelector('canvas') as HTMLCanvasElement;

		const style = window.getComputedStyle(canvas);
		expect(style.touchAction).toBe('none');
	});

	it('should get 2D rendering context', () => {
		const { container } = renderCanvas();
		const canvas = container.querySelector('canvas') as HTMLCanvasElement;

		const context = canvas.getContext('2d');
		expect(context).toBeTruthy();
		expect(context).toBeInstanceOf(CanvasRenderingContext2D);
	});

	it('should initialize with test shapes', async () => {
		const { component } = renderCanvas();

		// Canvas component initializes store with test shapes
		// FIXME: We can't directly access the store
		expect(component).toBeTruthy();
	});

	it('should render the Toolbar component', () => {
		const { container } = renderCanvas();
		const toolbar = container.querySelector('.toolbar');

		expect(toolbar).toBeTruthy();
		expect(toolbar?.getAttribute('role')).toBe('toolbar');
	});

	it('should render editor wrapper with correct layout', () => {
		const { container } = renderCanvas();
		const editor = container.querySelector('.editor');

		expect(editor).toBeTruthy();
		const style = window.getComputedStyle(editor as Element);
		expect(style.display).toBe('flex');
		expect(style.flexDirection).toBe('column');
	});

	it('should render the status bar', () => {
		const { container } = renderCanvas();
		const statusBar = container.querySelector('.status-bar');

		expect(statusBar).toBeTruthy();
	});

	it('should render editor utilities in the status bar', () => {
		const { container } = renderCanvas();
		const statusBar = container.querySelector('.status-bar');
		expect(statusBar?.querySelector('[aria-label="About Inkfinite"]')).toBeTruthy();
		expect(statusBar?.querySelector('[aria-label="History"]')).toBeTruthy();
	});

	it('should render all tool buttons in toolbar', () => {
		const { container } = renderCanvas();
		const toolButtons = container.querySelectorAll('.tool-button');

		expect(toolButtons.length).toBe(9);

		const toolIds = Array.from(toolButtons).map((btn) => btn.getAttribute('data-tool-id'));
		const coreToolIds = toolIds.filter((id) => id && id !== 'history');
		expect(coreToolIds).toEqual([
			'select',
			'rect',
			'ellipse',
			'line',
			'arrow',
			'text',
			'markdown',
			'pen'
		]);

		const historyButton = container.querySelector('.status-bar__action[aria-label="History"]');
		expect(historyButton).toBeTruthy();
	});

	it('should have select tool active by default', () => {
		const { container } = renderCanvas();
		const selectButton = container.querySelector('.tool-button[data-tool-id="select"]');

		expect(selectButton?.classList.contains('active')).toBe(true);
	});

	it('should change active tool when toolbar button is clicked', async () => {
		const { container } = renderCanvas();

		const selectButton = container.querySelector('.tool-button[data-tool-id="select"]');
		const rectButton = container.querySelector(
			'.tool-button[data-tool-id="rect"]'
		) as HTMLButtonElement;

		expect(selectButton?.classList.contains('active')).toBe(true);
		expect(rectButton?.classList.contains('active')).toBe(false);

		rectButton.click();

		await new Promise((resolve) => setTimeout(resolve, 50));

		const selectButtonAfter = container.querySelector('.tool-button[data-tool-id="select"]');
		const rectButtonAfter = container.querySelector('.tool-button[data-tool-id="rect"]');

		expect(selectButtonAfter?.classList.contains('active')).toBe(false);
		expect(rectButtonAfter?.classList.contains('active')).toBe(true);
	});

	it('ends panning when the pointer is released outside the canvas', async () => {
		const { container } = renderCanvas();
		const canvas = container.querySelector('canvas') as HTMLCanvasElement;

		expect(window.getComputedStyle(canvas).cursor).toContain('data:image/svg+xml');

		window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
		await vi.waitFor(() => expect(canvas.style.cursor).toBe('grab'));
		canvas.dispatchEvent(
			new PointerEvent('pointerdown', {
				clientX: 100,
				clientY: 100,
				button: 0,
				buttons: 1,
				pointerId: 17,
				bubbles: true
			})
		);
		expect(canvas.style.cursor).toBe('grabbing');

		window.dispatchEvent(
			new PointerEvent('pointerup', {
				clientX: -20,
				clientY: -20,
				button: 0,
				buttons: 0,
				pointerId: 17,
				bubbles: true
			})
		);
		expect(canvas.style.cursor).toBe('grab');

		window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }));
		expect(canvas.style.cursor).toBe('');
	});
});
