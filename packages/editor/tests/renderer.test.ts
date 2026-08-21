import { PageRecord, ShapeRecord, Store } from '@inkfinite/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer } from '../src/renderer';

describe('Renderer', () => {
	let canvas: HTMLCanvasElement;
	let context: CanvasRenderingContext2D;

	beforeEach(() => {
		canvas = document.createElement('canvas');
		canvas.width = 800;
		canvas.height = 600;

		context = {
			canvas,
			save: vi.fn(),
			restore: vi.fn(),
			scale: vi.fn(),
			translate: vi.fn(),
			rotate: vi.fn(),
			setTransform: vi.fn(),
			clearRect: vi.fn(),
			fillRect: vi.fn(),
			strokeRect: vi.fn(),
			fillText: vi.fn(),
			strokeText: vi.fn(),
			measureText: vi.fn(() => ({ width: 100 })),
			beginPath: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			quadraticCurveTo: vi.fn(),
			bezierCurveTo: vi.fn(),
			arc: vi.fn(),
			arcTo: vi.fn(),
			ellipse: vi.fn(),
			rect: vi.fn(),
			closePath: vi.fn(),
			fill: vi.fn(),
			stroke: vi.fn(),
			setLineDash: vi.fn(),
			getLineDash: vi.fn(() => []),
			globalAlpha: 1,
			fillStyle: '',
			strokeStyle: '',
			lineWidth: 1,
			font: '',
			textBaseline: 'alphabetic'
		} as unknown as CanvasRenderingContext2D;

		vi.spyOn(canvas, 'getContext').mockReturnValue(context);

		Object.defineProperty(canvas, 'getBoundingClientRect', {
			value: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 })
		});

		globalThis.requestAnimationFrame = vi.fn((callback) => {
			setTimeout(callback, 16);
			return 1;
		});

		globalThis.cancelAnimationFrame = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('createRenderer', () => {
		it('should create renderer with dispose method', () => {
			const store = new Store();
			const renderer = createRenderer(canvas, store);

			expect(renderer).toBeDefined();
			expect(renderer.dispose).toBeInstanceOf(Function);
			expect(renderer.markDirty).toBeInstanceOf(Function);

			renderer.dispose();
		});

		it('should throw error if canvas context is not available', () => {
			const badCanvas = document.createElement('canvas');
			vi.spyOn(badCanvas, 'getContext').mockReturnValue(null);

			const store = new Store();

			expect(() => createRenderer(badCanvas, store)).toThrow('Failed to get 2D context from canvas');
		});

		it('should mark dirty on initial render', () => {
			const store = new Store();
			const renderer = createRenderer(canvas, store);

			expect(globalThis.requestAnimationFrame).toHaveBeenCalled();

			renderer.dispose();
		});

		it('should unsubscribe from store on dispose', () => {
			const store = new Store();
			const renderer = createRenderer(canvas, store);

			const _unsubscribeSpy = vi.spyOn(store, 'subscribe');

			renderer.dispose();

			expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
		});
	});

	describe('rendering', () => {
		it('preserves explicit and blank lines in text shapes', async () => {
			const scheduledFrames: FrameRequestCallback[] = [];
			globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
				scheduledFrames.push(callback);
				return scheduledFrames.length;
			});
			const store = new Store();
			const page = PageRecord.create('Page', 'page');
			const text = ShapeRecord.createText(
				page.id,
				0,
				0,
				{ text: 'Overview\n\nIncidents', fontSize: 16, fontFamily: 'sans-serif', color: '#111827', w: 200 },
				'text'
			);
			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [text.id] } },
					shapes: { [text.id]: text },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);
			scheduledFrames.shift()?.(0);

			expect(context.fillText).toHaveBeenNthCalledWith(1, 'Overview', 0, 0);
			expect(context.fillText).toHaveBeenNthCalledWith(2, '', 0, 19.2);
			expect(context.fillText).toHaveBeenNthCalledWith(3, 'Incidents', 0, 38.4);
			renderer.dispose();
		});

		it('renders visible layers in order with isolated opacity and skips hidden layers', () => {
			const scheduledFrames: FrameRequestCallback[] = [];
			globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
				scheduledFrames.push(callback);
				return scheduledFrames.length;
			});
			let alpha = 1;
			const alphaWrites: number[] = [];
			Object.defineProperty(context, 'globalAlpha', {
				configurable: true,
				get: () => alpha,
				set: (value: number) => {
					alpha = value;
					alphaWrites.push(value);
				}
			});
			const page = PageRecord.create('Page', 'page');
			const visible = ShapeRecord.createRect(
				'page',
				0,
				0,
				{ w: 10, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
				'visible'
			);
			const hidden = ShapeRecord.createRect(
				'page',
				20,
				0,
				{ w: 10, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
				'hidden'
			);
			const store = new Store();
			store.setState((state) => ({
				...state,
				doc: {
					pages: {
						page: {
							...page,
							shapeIds: [visible.id, hidden.id],
							layerIds: ['visible-layer', 'hidden-layer']
						}
					},
					layers: {
						'visible-layer': {
							id: 'visible-layer',
							pageId: 'page',
							name: 'Visible',
							shapeIds: [visible.id],
							visible: true,
							locked: false,
							opacity: 0.4
						},
						'hidden-layer': {
							id: 'hidden-layer',
							pageId: 'page',
							name: 'Hidden',
							shapeIds: [hidden.id],
							visible: false,
							locked: false,
							opacity: 1
						}
					},
					shapes: {
						visible: { ...visible, layerId: 'visible-layer' },
						hidden: { ...hidden, layerId: 'hidden-layer' }
					},
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);
			scheduledFrames.shift()?.(0);
			expect(alphaWrites).toContain(0.4);
			expect(context.fill).toHaveBeenCalledTimes(2);
			expect(context.save).toHaveBeenCalledTimes(vi.mocked(context.restore).mock.calls.length);
			renderer.dispose();
		});

		it('composes shape, fill, and stroke opacity deterministically', () => {
			const scheduledFrames: FrameRequestCallback[] = [];
			globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
				scheduledFrames.push(callback);
				return scheduledFrames.length;
			});
			let alpha = 1;
			const alphaWrites: number[] = [];
			Object.defineProperty(context, 'globalAlpha', {
				configurable: true,
				get: () => alpha,
				set: (value: number) => {
					alpha = value;
					alphaWrites.push(value);
				}
			});
			const strokeAlphas: number[] = [];
			vi.mocked(context.stroke).mockImplementation(() => {
				strokeAlphas.push(alpha);
			});
			const page = PageRecord.create('Page', 'page');
			const shape = {
				...ShapeRecord.createRect(
					page.id,
					0,
					0,
					{ w: 10, h: 10, fill: '#fff', stroke: '#000', radius: 0 },
					'shape'
				),
				opacity: 0.8,
				fillOpacity: 0.25,
				strokeOpacity: 0.5
			};
			const store = new Store();
			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [shape.id] } },
					shapes: { [shape.id]: shape },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);
			scheduledFrames.shift()?.(0);
			expect(alphaWrites).toContain(0.2);
			expect(alphaWrites).toContain(0.4);
			expect(strokeAlphas).toContain(0.4);
			expect(context.fill).toHaveBeenCalledTimes(2);
			renderer.dispose();
		});

		it('resets and clears the full backing store before every frame', () => {
			const scheduledFrames: FrameRequestCallback[] = [];
			Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
			globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
				scheduledFrames.push(callback);
				return scheduledFrames.length;
			});
			const store = new Store();
			const renderer = createRenderer(canvas, store);

			scheduledFrames.shift()?.(0);
			store.setState((state) => ({ ...state, camera: { x: 120, y: -80, zoom: 1.5 } }));
			scheduledFrames.shift()?.(16);

			expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
			expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
			expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 1600, 1200);
			expect(context.translate).toHaveBeenCalledWith(-120, 80);
			expect(scheduledFrames).toHaveLength(0);
			renderer.dispose();
		});

		it('culls offscreen shapes while retaining offscreen selection overlays', () => {
			const scheduledFrames: FrameRequestCallback[] = [];
			globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
				scheduledFrames.push(callback);
				return scheduledFrames.length;
			});
			const page = PageRecord.create('Page 1', 'page:1');
			const visible = ShapeRecord.createRect(
				'page:1',
				0,
				0,
				{ w: 50, h: 50, fill: '#fff', stroke: '#000', radius: 0 },
				'shape:visible'
			);
			const selectedOffscreen = ShapeRecord.createRect(
				'page:1',
				10_000,
				10_000,
				{ w: 50, h: 50, fill: '#fff', stroke: '#000', radius: 0 },
				'shape:offscreen'
			);
			const store = new Store();
			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [visible.id, selectedOffscreen.id] } },
					shapes: { [visible.id]: visible, [selectedOffscreen.id]: selectedOffscreen },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id, selectionIds: [selectedOffscreen.id] }
			}));

			const renderer = createRenderer(canvas, store);
			scheduledFrames.shift()?.(0);

			expect(context.fill).toHaveBeenCalledTimes(2);
			expect(context.strokeRect).toHaveBeenCalledWith(0, 0, 50, 50);
			expect(context.translate).toHaveBeenCalledWith(10_000, 10_000);
			renderer.dispose();
		});

		it('should render empty scene with no shapes', async () => {
			const store = new Store();
			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should render scene with rect shape', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const rect = ShapeRecord.createRect(
				'page:1',
				100,
				100,
				{ w: 200, h: 100, fill: '#ff0000', stroke: '#000000', radius: 0 },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [rect.id] } },
					shapes: { [rect.id]: rect },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should render scene with ellipse shape', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const ellipse = ShapeRecord.createEllipse(
				'page:1',
				100,
				100,
				{ w: 200, h: 100, fill: '#00ff00', stroke: '#000000' },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [ellipse.id] } },
					shapes: { [ellipse.id]: ellipse },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('renders native path segments with the stored fill rule', () => {
			const scheduledFrames: FrameRequestCallback[] = [];
			globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
				scheduledFrames.push(callback);
				return scheduledFrames.length;
			});
			const page = PageRecord.create('Page 1', 'page:1');
			const path = ShapeRecord.createPath(
				'page:1',
				0,
				0,
				{
					subpaths: [
						{
							segments: [
								{ type: 'move', to: { x: 0, y: 0 } },
								{ type: 'line', to: { x: 40, y: 0 } },
								{ type: 'quadratic', control: { x: 50, y: 10 }, to: { x: 40, y: 20 } },
								{
									type: 'cubic',
									control_1: { x: 40, y: 30 },
									control_2: { x: 0, y: 30 },
									to: { x: 0, y: 20 }
								}
							],
							closed: true
						}
					],
					fill_rule: 'evenodd',
					fill: '#fff',
					stroke: '#000',
					stroke_width: 3
				},
				'path:1'
			);
			const store = new Store();
			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [path.id] } },
					shapes: { [path.id]: path },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);
			scheduledFrames.shift()?.(0);

			expect(context.quadraticCurveTo).toHaveBeenCalledWith(50, 10, 40, 20);
			expect(context.bezierCurveTo).toHaveBeenCalledWith(40, 30, 0, 30, 0, 20);
			expect(context.fill).toHaveBeenCalledWith('evenodd');
			expect(context.lineWidth).toBe(3);
			renderer.dispose();
		});

		it('should render scene with line shape', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const line = ShapeRecord.createLine(
				'page:1',
				0,
				0,
				{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, stroke: '#000000', width: 2 },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [line.id] } },
					shapes: { [line.id]: line },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should render scene with arrow shape', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const arrow = ShapeRecord.createArrow(
				'page:1',
				0,
				0,
				{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, stroke: '#000000', width: 2 },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [arrow.id] } },
					shapes: { [arrow.id]: arrow },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should render scene with text shape', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const text = ShapeRecord.createText(
				'page:1',
				100,
				100,
				{ text: 'Hello World', fontSize: 16, fontFamily: 'Arial', color: '#000000' },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [text.id] } },
					shapes: { [text.id]: text },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should render text shape with word wrapping', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const text = ShapeRecord.createText(
				'page:1',
				100,
				100,
				{
					text: 'Hello World this is a long text',
					fontSize: 16,
					fontFamily: 'Arial',
					color: '#000000',
					w: 100
				},
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [text.id] } },
					shapes: { [text.id]: text },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should render multiple shapes', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const rect = ShapeRecord.createRect(
				'page:1',
				100,
				100,
				{ w: 200, h: 100, fill: '#ff0000', stroke: '#000000', radius: 0 },
				'shape:1'
			);
			const ellipse = ShapeRecord.createEllipse(
				'page:1',
				400,
				200,
				{ w: 150, h: 100, fill: '#00ff00', stroke: '#000000' },
				'shape:2'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [rect.id, ellipse.id] } },
					shapes: { [rect.id]: rect, [ellipse.id]: ellipse },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('renders a high-contrast double outline for selected shapes', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const rect = ShapeRecord.createRect(
				'page:1',
				100,
				100,
				{ w: 200, h: 100, fill: '#ff0000', stroke: '#000000', radius: 0 },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [rect.id] } },
					shapes: { [rect.id]: rect },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id, selectionIds: [rect.id] }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));
			const selectionStrokes = vi
				.mocked(context.strokeRect)
				.mock.calls.filter(([x, y, width, height]) => x === 0 && y === 0 && width === 200 && height === 100);
			expect(selectionStrokes).toHaveLength(2);

			renderer.dispose();
		});

		it('renders direct-selection anchors and quadratic and cubic controls', () => {
			const scheduledFrames: FrameRequestCallback[] = [];
			globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
				scheduledFrames.push(callback);
				return scheduledFrames.length;
			});
			const page = PageRecord.create('Page', 'page:direct-render');
			const path = ShapeRecord.createPath(
				page.id,
				0,
				0,
				{
					subpaths: [
						{
							segments: [
								{ type: 'move', to: { x: 0, y: 0 } },
								{ type: 'line', to: { x: 40, y: 0 } },
								{ type: 'quadratic', control: { x: 60, y: 20 }, to: { x: 40, y: 40 } },
								{
									type: 'cubic',
									control_1: { x: 40, y: 60 },
									control_2: { x: 0, y: 60 },
									to: { x: 0, y: 40 }
								}
							],
							closed: true
						}
					],
					fill_rule: 'nonzero',
					stroke: '#000',
					stroke_width: 2
				},
				'path:direct-render'
			);
			const store = new Store();
			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [path.id] } },
					shapes: { [path.id]: path },
					bindings: {}
				},
				ui: {
					...state.ui,
					currentPageId: page.id,
					selectionIds: [path.id],
					toolId: 'direct-select',
					pathSelection: { pathId: path.id, anchors: [{ subpathIndex: 0, segmentIndex: 0 }] }
				}
			}));

			const renderer = createRenderer(canvas, store);
			scheduledFrames.shift()?.(0);

			const controlHandleArcs = vi.mocked(context.arc).mock.calls.filter((call) => call[2] === 4);
			expect(controlHandleArcs).toHaveLength(3);
			expect(context.rect).toHaveBeenCalledTimes(4);
			renderer.dispose();
		});

		it('should update render when store changes', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');

			store.setState((state) => ({
				...state,
				doc: { pages: { [page.id]: page }, shapes: {}, bindings: {} },
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			const rect = ShapeRecord.createRect(
				'page:1',
				100,
				100,
				{ w: 200, h: 100, fill: '#ff0000', stroke: '#000000', radius: 0 },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [rect.id] } },
					shapes: { [rect.id]: rect },
					bindings: {}
				}
			}));

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should apply camera transform correctly', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const rect = ShapeRecord.createRect(
				'page:1',
				0,
				0,
				{ w: 100, h: 100, fill: '#ff0000', stroke: '#000000', radius: 0 },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [rect.id] } },
					shapes: { [rect.id]: rect },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id },
				camera: { x: 100, y: 100, zoom: 2 }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should handle rounded rectangle', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const rect = ShapeRecord.createRect(
				'page:1',
				100,
				100,
				{ w: 200, h: 100, fill: '#ff0000', stroke: '#000000', radius: 10 },
				'shape:1'
			);

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [rect.id] } },
					shapes: { [rect.id]: rect },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});

		it('should render shapes with rotation', async () => {
			const store = new Store();

			const page = PageRecord.create('Page 1', 'page:1');
			const rect = ShapeRecord.createRect(
				'page:1',
				100,
				100,
				{ w: 200, h: 100, fill: '#ff0000', stroke: '#000000', radius: 0 },
				'shape:1'
			);
			rect.rot = Math.PI / 4;

			store.setState((state) => ({
				...state,
				doc: {
					pages: { [page.id]: { ...page, shapeIds: [rect.id] } },
					shapes: { [rect.id]: rect },
					bindings: {}
				},
				ui: { ...state.ui, currentPageId: page.id }
			}));

			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();
		});
	});

	describe('markDirty', () => {
		it('should allow manual dirty marking', async () => {
			const store = new Store();
			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');

			renderer.markDirty();

			expect(rafSpy).toHaveBeenCalled();

			renderer.dispose();
		});

		it('should not mark dirty after dispose', async () => {
			const store = new Store();
			const renderer = createRenderer(canvas, store);

			await new Promise((resolve) => setTimeout(resolve, 50));

			renderer.dispose();

			// @ts-expect-error mocked
			const rafCallCount = globalThis.requestAnimationFrame.mock.calls.length;

			renderer.markDirty();

			// @ts-expect-error mocked
			expect(globalThis.requestAnimationFrame.mock.calls.length).toBe(rafCallCount);
		});
	});
});
