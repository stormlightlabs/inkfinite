import { Action, EditorShapeRecord, EditorState } from '@inkfinite/core';
import { describe, expect, it, vi } from 'vitest';
import { dispatchHostRequest } from '../src/host';
import { resolveKeyboardShortcut, shouldPreventKeyboardDefault } from '../src/shortcuts';

function selectedState(): EditorState {
	const state = EditorState.create();
	state.doc.pages.page = { id: 'page', name: 'Page', shapeIds: ['shape'] };
	state.doc.shapes.shape = EditorShapeRecord.createRect(
		'page',
		0,
		0,
		{ w: 10, h: 10, fill: '#000', stroke: '#000', radius: 0 },
		'shape'
	);
	state.ui.currentPageId = 'page';
	state.ui.selectionIds = ['shape'];
	return state;
}

describe('keyboard shortcut resolution', () => {
	it('resolves document edits without dispatching host effects', () => {
		const result = resolveKeyboardShortcut(
			selectedState(),
			Action.keyDown('ArrowRight', 'ArrowRight', { ctrl: false, shift: false, alt: false, meta: true })
		);

		expect(result.request).toBeUndefined();
		expect(result.state?.doc.shapes.shape?.x).toBe(1);
	});

	it('returns a host request for application-owned actions', () => {
		const result = resolveKeyboardShortcut(
			EditorState.create(),
			Action.keyDown('b', 'KeyB', { ctrl: false, shift: false, alt: false, meta: true })
		);

		expect(result).toEqual({ state: null, request: { type: 'browse' } });
	});

	it('dispatches host requests through the browser boundary', () => {
		const handlers = { onUndoRequested: vi.fn(), onPasteRequested: vi.fn() };
		dispatchHostRequest({ type: 'undo' }, handlers);
		dispatchHostRequest({ type: 'paste' }, handlers);
		expect(handlers.onUndoRequested).toHaveBeenCalledOnce();
		expect(handlers.onPasteRequested).toHaveBeenCalledOnce();
	});

	it('keeps keyboard default prevention independent from DOM events', () => {
		const modifiers = { ctrl: true, shift: false, alt: false, meta: false };
		expect(shouldPreventKeyboardDefault('z', 'KeyZ', modifiers, 'other')).toBe(true);
		expect(shouldPreventKeyboardDefault('o', 'KeyO', modifiers, 'other')).toBe(false);
	});
});
