import { Action, Camera, Modifiers, PageRecord, ShapeRecord, Store } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';

import { CameraController } from '../camera-controller';

const viewport = { width: 800, height: 600 };

describe('CameraController', () => {
	it('zooms toward the cursor without moving the anchored world point', () => {
		const store = new Store();
		const controller = new CameraController(store, () => viewport);
		const anchor = { x: 180, y: 140 };
		const before = Camera.screenToWorld(store.getState().camera, anchor, viewport);

		expect(
			controller.handleAction(
				Action.wheel(anchor, before, -120, Modifiers.create(true, false, false, false))
			)
		).toBe(true);

		const after = Camera.screenToWorld(store.getState().camera, anchor, viewport);
		expect(store.getState().camera.zoom).toBeGreaterThan(1);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('pans in both axes for ordinary wheel and trackpad input', () => {
		const store = new Store();
		const controller = new CameraController(store, () => viewport);

		controller.handleAction(
			Action.wheel({ x: 400, y: 300 }, { x: 0, y: 0 }, { x: 40, y: -60 }, Modifiers.create())
		);

		expect(store.getState().camera).toEqual({ x: 40, y: -60, zoom: 1 });
	});

	it('supports bounded keyboard zoom and a 100% reset', () => {
		const store = new Store();
		const controller = new CameraController(store, () => viewport);

		controller.handleAction(
			Action.keyDown('+', 'Equal', Modifiers.create(false, true, false, false))
		);
		expect(store.getState().camera.zoom).toBeGreaterThan(1);

		controller.handleAction(Action.keyDown('0', 'Digit0', Modifiers.create()));
		expect(store.getState().camera.zoom).toBe(1);

		controller.setZoomPercent(100_000);
		expect(store.getState().camera.zoom).toBe(10);
		controller.setZoomPercent(0.001);
		expect(store.getState().camera.zoom).toBe(0.05);
	});

	it('fits the current drawing inside the viewport', () => {
		const page = PageRecord.create('Page', 'page');
		const shape = ShapeRecord.createRect(
			page.id,
			100,
			200,
			{ w: 400, h: 200, fill: '#fff', stroke: '#000', radius: 0 },
			'shape'
		);
		const store = new Store();
		store.setState((state) => ({
			...state,
			doc: {
				...state.doc,
				pages: { [page.id]: { ...page, shapeIds: [shape.id] } },
				shapes: { [shape.id]: shape }
			},
			ui: { ...state.ui, currentPageId: page.id }
		}));
		const controller = new CameraController(store, () => viewport);

		controller.fitAll();

		expect(store.getState().camera).toEqual({ x: 300, y: 300, zoom: 1.8 });
	});

	it('keeps a fitted drawing framed when the viewport changes size', () => {
		const page = PageRecord.create('Page', 'page');
		const shape = ShapeRecord.createRect(
			page.id,
			100,
			200,
			{ w: 400, h: 200, fill: '#fff', stroke: '#000', radius: 0 },
			'shape'
		);
		const store = new Store();
		store.setState((state) => ({
			...state,
			doc: {
				...state.doc,
				pages: { [page.id]: { ...page, shapeIds: [shape.id] } },
				shapes: { [shape.id]: shape }
			},
			ui: { ...state.ui, currentPageId: page.id }
		}));
		const fittedViewport = { ...viewport };
		const controller = new CameraController(store, () => fittedViewport);
		controller.fitAll();

		fittedViewport.width = 400;
		fittedViewport.height = 300;
		controller.refit();

		expect(store.getState().camera).toEqual({ x: 300, y: 300, zoom: 0.8 });
	});
});
