import type { Action, EditorState, Modifiers } from '@inkfinite/core';
import {
	duplicateAndConnectSelection,
	duplicateSelection,
	getSelectionScopeShapes,
	groupShapes,
	reorderShapes,
	reorderShapesToEdge,
	setShapesLocked,
	translateShapes,
	ungroupShapes
} from '@inkfinite/core';
import type { EditorHostRequest } from './host.js';

/** Platform used when deciding whether a primary modifier is Cmd or Ctrl. */
export type PrimaryModifierPlatform = 'mac' | 'other';

/** Pure result of resolving one normalized keyboard action. */
export type KeyboardShortcutResult = { state: EditorState | null; request?: EditorHostRequest };

/** Resolve editor keyboard commands without dispatching browser or host effects. */
export function resolveKeyboardShortcut(state: EditorState, action: Action): KeyboardShortcutResult {
	if (action.type !== 'key-down') return { state: null };
	const primary = action.modifiers.meta || action.modifiers.ctrl;
	if (action.key === '?' || (action.key === '/' && action.modifiers.shift)) {
		return { state: null, request: { type: 'shortcuts' } };
	}
	if (primary && action.key.toLowerCase() === 'k') {
		return { state: null, request: { type: 'command-palette' } };
	}
	if (primary && action.key.toLowerCase() === 'z') {
		return { state: null, request: { type: action.modifiers.shift ? 'redo' : 'undo' } };
	}
	if (primary && action.key.toLowerCase() === 'y') {
		return { state: null, request: { type: 'redo' } };
	}
	if (primary && action.key.toLowerCase() === 'b') {
		return { state: null, request: { type: 'browse' } };
	}
	if (primary && action.key.toLowerCase() === 'c') {
		return { state: null, request: { type: 'copy' } };
	}
	if (primary && action.key.toLowerCase() === 'x') {
		return { state: null, request: { type: 'cut' } };
	}
	if (primary && action.key.toLowerCase() === 'v') {
		return { state: null, request: { type: 'paste' } };
	}
	if (primary && action.key.toLowerCase() === 'a') {
		const selectionIds = getSelectionScopeShapes(state).map((shape) => shape.id);
		return {
			state:
				selectionIds.length === 0 || selectionIds.every((id) => state.ui.selectionIds.includes(id))
					? null
					: { ...state, ui: { ...state.ui, selectionIds } }
		};
	}
	if (state.ui.selectionIds.length === 0) return { state: null };

	if (action.key.startsWith('Arrow')) {
		const delta = arrowDelta(action.key, action.modifiers.shift ? 10 : 1);
		if (delta) return { state: nullableState(translateShapes(state, state.ui.selectionIds, delta), state) };
	}
	if (primary && action.modifiers.alt && action.key.toLowerCase() === 'd') {
		return { state: duplicateAndConnectSelection(state) };
	}
	if (primary && action.key.toLowerCase() === 'd') {
		return { state: duplicateSelection(state) };
	}
	if (primary && action.key.toLowerCase() === 'g') {
		return {
			state: action.modifiers.shift
				? nullableState(ungroupShapes(state, state.ui.selectionIds), state)
				: nullableState(groupShapes(state, state.ui.selectionIds), state)
		};
	}
	if (primary && action.modifiers.shift && action.key.toLowerCase() === 'l') {
		const locked = state.ui.selectionIds.every((id) => state.doc.shapes[id]?.locked);
		return { state: nullableState(setShapesLocked(state, state.ui.selectionIds, !locked), state) };
	}
	if (primary && action.key === ']') {
		return {
			state: action.modifiers.shift
				? nullableState(reorderShapesToEdge(state, state.ui.selectionIds, 'front'), state)
				: nullableState(reorderShapes(state, state.ui.selectionIds, 'forward'), state)
		};
	}
	if (primary && action.key === '[') {
		return {
			state: action.modifiers.shift
				? nullableState(reorderShapesToEdge(state, state.ui.selectionIds, 'back'), state)
				: nullableState(reorderShapes(state, state.ui.selectionIds, 'backward'), state)
		};
	}
	return { state: null };
}

/** Decide whether the normalized key should not reach the browser. */
export function shouldPreventKeyboardDefault(
	key: string,
	code: string,
	modifiers: Modifiers,
	platform: PrimaryModifierPlatform
): boolean {
	if (key === ' ' || key.startsWith('Arrow')) return true;
	if (key === 'Backspace' || key === 'Delete' || key === 'Tab') return true;
	if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0') return true;
	if (modifiers.shift && (code === 'Digit1' || code === 'Digit2')) return true;
	if (isPrimaryModifier(modifiers, platform) && ['z', 'Z', 'y', 'Y'].includes(key)) return true;
	if (
		isPrimaryModifier(modifiers, platform) &&
		('abgldcxvzy'.includes(key.toLowerCase()) || key === '[' || key === ']')
	) {
		return true;
	}
	return key === '?' || (key === '/' && modifiers.shift);
}

function isPrimaryModifier(modifiers: Modifiers, platform: PrimaryModifierPlatform): boolean {
	return platform === 'mac' ? modifiers.meta : modifiers.ctrl;
}

function arrowDelta(key: string, step: number): { x: number; y: number } | null {
	switch (key) {
		case 'ArrowLeft':
			return { x: -step, y: 0 };
		case 'ArrowRight':
			return { x: step, y: 0 };
		case 'ArrowUp':
			return { x: 0, y: -step };
		case 'ArrowDown':
			return { x: 0, y: step };
		default:
			return null;
	}
}

function nullableState(next: EditorState, previous: EditorState): EditorState | null {
	return next === previous ? null : next;
}
