import { Action, EditorState, Store, type Tool } from '@inkfinite/core';
import { EditorRuntime, type SelectionTool } from '@inkfinite/editor/runtime';
import { describe, expect, it, vi } from 'vitest';

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

function runtimeWithBoardBrowser(onBrowseRequested: () => void) {
	const tool = Object.assign(new IdleSelectionTool(), {
		getHandleAtPoint: () => null
	}) satisfies SelectionTool;
	return new EditorRuntime({
		store: new Store(),
		tools: new Map([[tool.id, tool]]),
		selectionTool: tool,
		getSnapSettings: () => ({ snapEnabled: false, gridEnabled: false, gridSize: 25 }),
		onTransactionDraft: vi.fn(),
		onBrowseRequested
	});
}

describe('board browser keyboard shortcut', () => {
	it.each([
		{ label: 'Cmd+B', modifiers: { ctrl: false, shift: false, alt: false, meta: true } },
		{ label: 'Ctrl+B', modifiers: { ctrl: true, shift: false, alt: false, meta: false } }
	])('opens Boards with $label', ({ modifiers }) => {
		const onBrowseRequested = vi.fn();
		const runtime = runtimeWithBoardBrowser(onBrowseRequested);

		runtime.handleAction(Action.keyDown('b', 'KeyB', modifiers));

		expect(onBrowseRequested).toHaveBeenCalledOnce();
	});

	it.each([
		{ key: 'o', code: 'KeyO' },
		{ key: 'n', code: 'KeyN' },
		{ key: 'd', code: 'KeyD' },
		{ key: 'ArrowLeft', code: 'ArrowLeft' }
	])('does not open Boards for $code', ({ key, code }) => {
		const onBrowseRequested = vi.fn();
		const runtime = runtimeWithBoardBrowser(onBrowseRequested);

		runtime.handleAction(
			Action.keyDown(key, code, { ctrl: false, shift: false, alt: false, meta: true })
		);

		expect(onBrowseRequested).not.toHaveBeenCalled();
	});
});
