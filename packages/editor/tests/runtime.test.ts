import { Action, EditorState, ShapeRecord, Store, type Tool } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { EditorRuntime, type SelectionTool } from '../src/runtime';

class IdleSelectionTool implements Tool {
	readonly id = 'select' as const;

	onEnter(state: EditorState) {
		return state;
	}

	onExit(state: EditorState) {
		return state;
	}

	onAction(state: EditorState) {
		return state;
	}
}

function createRuntime(store: Store, options: Partial<ConstructorParameters<typeof EditorRuntime>[0]> = {}) {
	const tool = Object.assign(new IdleSelectionTool(), { getHandleAtPoint: () => null }) satisfies SelectionTool;
	return new EditorRuntime({
		store,
		tools: new Map([[tool.id, tool]]),
		selectionTool: tool,
		getSnapSettings: () => ({ snapEnabled: false, gridEnabled: false, gridSize: 25 }),
		onTransactionDraft: vi.fn(),
		...options
	});
}

function selectedStore() {
	const state = EditorState.create();
	state.doc.pages.page = { id: 'page', name: 'Page', shapeIds: ['one', 'two'] };
	state.doc.shapes.one = ShapeRecord.createRect(
		'page',
		0,
		0,
		{ w: 10, h: 10, fill: '#000', stroke: '#000', radius: 0 },
		'one'
	);
	state.doc.shapes.two = ShapeRecord.createRect(
		'page',
		20,
		0,
		{ w: 10, h: 10, fill: '#000', stroke: '#000', radius: 0 },
		'two'
	);
	state.ui.currentPageId = 'page';
	state.ui.selectionIds = ['one', 'two'];
	return new Store(state);
}

describe('editor keyboard commands', () => {
	it('groups the selection as one undoable draft', () => {
		const store = selectedStore();
		const onTransactionDraft = vi.fn();
		const runtime = createRuntime(store, { onTransactionDraft });

		runtime.handleAction(Action.keyDown('g', 'KeyG', { ctrl: false, shift: false, alt: false, meta: true }));

		expect(onTransactionDraft).toHaveBeenCalledWith(expect.objectContaining({ name: 'Group', kind: 'doc' }));
		const draft = onTransactionDraft.mock.calls[0][0];
		expect(draft.after.ui.selectionIds).toHaveLength(1);
		expect(draft.after.doc.shapes[draft.after.ui.selectionIds[0]].type).toBe('container');
	});

	it('routes undo, redo, clipboard, and shortcut-panel keys to the host', () => {
		const store = new Store();
		const handlers = {
			onUndoRequested: vi.fn(),
			onRedoRequested: vi.fn(),
			onCopyRequested: vi.fn(),
			onCutRequested: vi.fn(),
			onPasteRequested: vi.fn(),
			onShortcutsRequested: vi.fn(),
			onCommandPaletteRequested: vi.fn()
		};
		const runtime = createRuntime(store, handlers);
		const primary = { ctrl: false, shift: false, alt: false, meta: true };

		runtime.handleAction(Action.keyDown('z', 'KeyZ', primary));
		runtime.handleAction(Action.keyDown('z', 'KeyZ', { ...primary, shift: true }));
		runtime.handleAction(Action.keyDown('y', 'KeyY', primary));
		runtime.handleAction(Action.keyDown('c', 'KeyC', primary));
		runtime.handleAction(Action.keyDown('x', 'KeyX', primary));
		runtime.handleAction(Action.keyDown('v', 'KeyV', primary));
		runtime.handleAction(Action.keyDown('?', 'Slash', { ctrl: false, shift: true, alt: false, meta: false }));
		runtime.handleAction(Action.keyDown('k', 'KeyK', primary));

		expect(handlers.onUndoRequested).toHaveBeenCalledOnce();
		expect(handlers.onRedoRequested).toHaveBeenCalledTimes(2);
		expect(handlers.onCopyRequested).toHaveBeenCalledOnce();
		expect(handlers.onCutRequested).toHaveBeenCalledOnce();
		expect(handlers.onPasteRequested).toHaveBeenCalledOnce();
		expect(handlers.onShortcutsRequested).toHaveBeenCalledOnce();
		expect(handlers.onCommandPaletteRequested).toHaveBeenCalledOnce();
	});

	it('creates a connected duplicate as one document draft', () => {
		const store = selectedStore();
		store.setState((state) => ({ ...state, ui: { ...state.ui, selectionIds: ['one'] } }));
		const onTransactionDraft = vi.fn();
		const runtime = createRuntime(store, { onTransactionDraft });

		runtime.handleAction(Action.keyDown('d', 'KeyD', { ctrl: false, shift: false, alt: true, meta: true }));

		expect(onTransactionDraft).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Duplicate and connect', kind: 'doc' })
		);
		const draft = onTransactionDraft.mock.calls[0][0];
		expect(Object.values(draft.after.doc.shapes).filter((shape) => shape.type === 'arrow')).toHaveLength(1);
	});
});
