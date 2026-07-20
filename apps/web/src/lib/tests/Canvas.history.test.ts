/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Action, Store } from '@inkfinite/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';

const actionHandlers: Array<(action: Action) => void> = [];
const testState = vi.hoisted(() => ({ sinkEnqueueSpy: vi.fn(), storeInstances: [] as Store[] }));
vi.mock('$editor/input', () => {
	return {
		createInputAdapter: vi.fn((config) => {
			actionHandlers.push(config.onAction);
			return { dispose: vi.fn() };
		})
	};
});

vi.mock('$editor/status', () => ({
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
}));

vi.mock('@inkfinite/renderer', () => {
	return {
		createRenderer: vi.fn((_canvas, store) => {
			testState.storeInstances.push(store);
			return { dispose: vi.fn(), markDirty: vi.fn() };
		})
	};
});

const createDoc = () => ({
	pages: { 'page:1': { id: 'page:1', name: 'Page 1', shapeIds: ['shape:1'] } },
	shapes: {
		'shape:1': {
			id: 'shape:1',
			type: 'rect' as const,
			pageId: 'page:1',
			x: 0,
			y: 0,
			rot: 0,
			props: { w: 20, h: 20, fill: '#000', stroke: '#000', radius: 0 }
		}
	},
	bindings: {},
	order: { pageIds: ['page:1'], shapeOrder: { 'page:1': ['shape:1'] } }
});

vi.mock('$lib/persistence/database', () => ({ InkfiniteDB: class {} }));

vi.mock('$lib/persistence/repository', () => ({
	createDexieDocRepo: vi.fn(() => ({
		listBoards: vi.fn(async () => [
			{ id: 'board:1', name: 'Board 1', createdAt: 0, updatedAt: 0 }
		]),
		createBoard: vi.fn(async () => 'board:new'),
		openBoard: vi.fn(async () => {}),
		renameBoard: vi.fn(),
		deleteBoard: vi.fn(),
		loadDoc: vi.fn(async () => createDoc()),
		applyDocPatch: vi.fn(),
		exportBoard: vi.fn(async () => ({
			board: { id: 'board:1', name: '', createdAt: 0, updatedAt: 0 },
			doc: createDoc(),
			order: { pageIds: [], shapeOrder: {} }
		})),
		importBoard: vi.fn(async () => 'board:new')
	})),
	createPersistenceSink: vi.fn(() => ({
		enqueueDocPatch: testState.sinkEnqueueSpy,
		flush: vi.fn()
	}))
}));
import Canvas from '$editor/canvas/Canvas.svelte';
import { createTestPlatformAdapter } from './test-platform';
const { sinkEnqueueSpy, storeInstances } = testState;

describe('Canvas history integration', () => {
	beforeEach(() => {
		cleanup();
		actionHandlers.length = 0;
		storeInstances.length = 0;
		sinkEnqueueSpy.mockClear();
	});

	it('wraps pointer actions in SnapshotCommands and enqueues persistence', async () => {
		render(Canvas, { platform: createTestPlatformAdapter() });

		await vi.waitFor(() => {
			expect(actionHandlers.length).toBeGreaterThan(0);
		});
		await vi.waitFor(() => {
			expect(storeInstances.at(-1)?.getState().ui.currentPageId).toBe('page:1');
		});
		const handler = actionHandlers.at(-1);
		expect(handler).toBeTypeOf('function');

		handler?.({
			type: 'pointer-down',
			screen: { x: 10, y: 10 },
			world: { x: 10, y: 10 },
			button: 0,
			buttons: { left: true, middle: false, right: false },
			modifiers: { ctrl: false, shift: false, alt: false, meta: false },
			timestamp: Date.now()
		});

		handler?.({
			type: 'pointer-move',
			screen: { x: 20, y: 20 },
			world: { x: 20, y: 20 },
			buttons: { left: true, middle: false, right: false },
			modifiers: { ctrl: false, shift: false, alt: false, meta: false },
			timestamp: Date.now()
		});

		handler?.({
			type: 'pointer-up',
			screen: { x: 20, y: 20 },
			world: { x: 20, y: 20 },
			button: 0,
			buttons: { left: false, middle: false, right: false },
			modifiers: { ctrl: false, shift: false, alt: false, meta: false },
			timestamp: Date.now()
		});

		const history = storeInstances.at(-1)?.getHistory();
		expect(history?.undoStack).toHaveLength(1);
		expect(history?.undoStack[0].command.kind).toBe('doc');
		expect(sinkEnqueueSpy).toHaveBeenCalledTimes(1);
	});
});
