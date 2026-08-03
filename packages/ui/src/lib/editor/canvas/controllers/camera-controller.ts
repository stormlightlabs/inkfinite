import {
	Camera,
	getSelectedShapes,
	getShapesOnCurrentPage,
	shapeBounds,
	type Action,
	type Box2,
	type Store,
	type Vec2,
	type Viewport
} from '@inkfinite/core';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.2;
const FIT_MARGIN = 80;

/** Coordinates every camera interaction exposed by the editor UI. */
export class CameraController {
	private fitMode: 'all' | 'selection' | null = null;

	constructor(
		private readonly store: Store,
		private readonly getViewport: () => Viewport
	) {}

	/** Returns the current zoom as a rounded percentage. */
	getZoomPercent(): number {
		const percent = this.store.getState().camera.zoom * 100;
		return Number.isFinite(percent) ? Math.round(percent) : 100;
	}

	/** Zooms one step toward the viewport center. */
	zoomIn(): void {
		this.zoomAt(ZOOM_STEP, this.viewportCenter());
	}

	/** Zooms one step away from the viewport center. */
	zoomOut(): void {
		this.zoomAt(1 / ZOOM_STEP, this.viewportCenter());
	}

	/** Sets an exact zoom while preserving the current viewport center. */
	setZoomPercent(percent: number): void {
		this.fitMode = null;
		const currentZoom = this.store.getState().camera.zoom;
		if (!Number.isFinite(currentZoom) || currentZoom <= 0) {
			this.store.setState((state) => ({
				...state,
				camera: Camera.create(state.camera.x, state.camera.y, 1)
			}));
			return;
		}
		const targetZoom = this.clampZoom(percent / 100);
		this.zoomAt(targetZoom / currentZoom, this.viewportCenter());
	}

	/** Restores the origin at 100% zoom. */
	reset(): void {
		this.fitMode = null;
		this.store.setState((state) => ({ ...state, camera: Camera.reset() }));
	}

	/** Frames every shape on the current page, or resets an empty page. */
	fitAll(): void {
		this.fitMode = 'all';
		this.fitAllNow();
	}

	/** Frames the selection, falling back to every shape on the page. */
	fitSelection(): void {
		this.fitMode = 'selection';
		this.fitSelectionNow();
	}

	/** Recalculates an active fitted view after the viewport changes size. */
	refit(): void {
		if (this.fitMode === 'selection') {
			this.fitSelectionNow();
		} else if (this.fitMode === 'all') {
			this.fitAllNow();
		}
	}

	/** Leaves fitted mode when another interaction takes control of the camera. */
	cancelFit(): void {
		this.fitMode = null;
	}

	private fitAllNow(): void {
		const shapes = getShapesOnCurrentPage(this.store.getState());
		const bounds = this.getCombinedBounds(shapes);
		if (bounds) {
			this.fitBounds(bounds);
		} else {
			this.store.setState((state) => ({ ...state, camera: Camera.reset() }));
		}
	}

	private fitSelectionNow(): void {
		const bounds = this.getCombinedBounds(getSelectedShapes(this.store.getState()));
		if (bounds) {
			this.fitBounds(bounds);
		} else {
			this.fitAllNow();
		}
	}

	/** Handles trackpad pan, modified wheel zoom, and camera keyboard shortcuts. */
	handleAction(action: Action): boolean {
		if (action.type === 'wheel') {
			if (action.modifiers.ctrl || action.modifiers.meta) {
				const factor = Math.exp(-action.deltaY * 0.0015);
				this.zoomAt(factor, action.screen);
			} else {
				const horizontalDelta =
					action.modifiers.shift && action.deltaX === 0 ? action.deltaY : action.deltaX;
				const verticalDelta =
					action.modifiers.shift && action.deltaX === 0 ? 0 : action.deltaY;
				this.panByWheel(horizontalDelta, verticalDelta);
			}
			return true;
		}

		if (action.type !== 'key-down' || action.repeat || action.modifiers.alt) {
			return false;
		}

		if (action.key === '+' || action.key === '=') {
			this.zoomIn();
			return true;
		}
		if (action.key === '-' || action.key === '_') {
			this.zoomOut();
			return true;
		}
		if (action.key === '0') {
			this.setZoomPercent(100);
			return true;
		}
		if (action.modifiers.shift && (action.key === '1' || action.code === 'Digit1')) {
			this.fitAll();
			return true;
		}
		if (action.modifiers.shift && (action.key === '2' || action.code === 'Digit2')) {
			this.fitSelection();
			return true;
		}

		return false;
	}

	private panByWheel(deltaX: number, deltaY: number): void {
		if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
		this.fitMode = null;
		this.store.setState((state) => ({
			...state,
			camera: Camera.pan(state.camera, { x: -deltaX, y: -deltaY })
		}));
	}

	private zoomAt(factor: number, anchor: Vec2): void {
		if (!Number.isFinite(factor) || factor <= 0) return;
		this.fitMode = null;
		const viewport = this.getViewport();
		this.store.setState((state) => {
			const currentZoom =
				Number.isFinite(state.camera.zoom) && state.camera.zoom > 0
					? state.camera.zoom
					: 1;
			const camera =
				currentZoom === state.camera.zoom
					? state.camera
					: { ...state.camera, zoom: currentZoom };
			const targetZoom = this.clampZoom(currentZoom * factor);
			return {
				...state,
				camera: Camera.zoomAt(camera, targetZoom / currentZoom, anchor, viewport)
			};
		});
	}

	private fitBounds(bounds: Box2): void {
		const viewport = this.getViewport();
		const width = Math.max(bounds.max.x - bounds.min.x, 1);
		const height = Math.max(bounds.max.y - bounds.min.y, 1);
		const availableWidth = Math.max(viewport.width - FIT_MARGIN, 1);
		const availableHeight = Math.max(viewport.height - FIT_MARGIN, 1);
		const zoom = this.clampZoom(Math.min(availableWidth / width, availableHeight / height));
		this.store.setState((state) => ({
			...state,
			camera: {
				x: (bounds.min.x + bounds.max.x) / 2,
				y: (bounds.min.y + bounds.max.y) / 2,
				zoom
			}
		}));
	}

	private getCombinedBounds(shapes: ReturnType<typeof getShapesOnCurrentPage>): Box2 | null {
		return shapes.reduce<Box2 | null>((combined, shape) => {
			const bounds = shapeBounds(shape);
			if (!combined) return bounds;
			return {
				min: {
					x: Math.min(combined.min.x, bounds.min.x),
					y: Math.min(combined.min.y, bounds.min.y)
				},
				max: {
					x: Math.max(combined.max.x, bounds.max.x),
					y: Math.max(combined.max.y, bounds.max.y)
				}
			};
		}, null);
	}

	private viewportCenter(): Vec2 {
		const viewport = this.getViewport();
		return { x: viewport.width / 2, y: viewport.height / 2 };
	}

	private clampZoom(zoom: number): number {
		return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
	}
}
