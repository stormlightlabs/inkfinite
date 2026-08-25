import { pathLength } from './path-metrics';
import type { EditorState } from './reactivity';
import { getSelectedShapes } from './reactivity';
import type { PathShape, TextShape } from './editor-model';

/** Return the selected text and supporting path when the attachment command applies. */
export function textPathSelectionTargets(state: EditorState): { text: TextShape; path: PathShape } | null {
	if (state.ui.selectionIds.length !== 2) return null;
	const selected = getSelectedShapes(state);
	const text = selected.find((shape): shape is TextShape => shape.type === 'text');
	const path = selected.find((shape): shape is PathShape => shape.type === 'path');
	return text && path && text.pageId === path.pageId ? { text, path } : null;
}

/** Whether the current selection can attach text to a native path. */
export function canTextPathSelection(state: EditorState): boolean {
	return textPathSelectionTargets(state) !== null;
}

/** Attach the selected text to the selected path as one immutable editor update. */
export function attachTextPathSelection(state: EditorState): EditorState | null {
	const targets = textPathSelectionTargets(state);
	if (!targets) return null;
	const { text, path } = targets;
	const textPath = {
		pathId: path.id,
		offset: pathLength(path.props) / 2,
		align: 'center' as const,
		side: 'left' as const,
		direction: 'forward' as const
	};
	const nextText = { ...text, props: { ...text.props, textPath } };
	return { ...state, doc: { ...state.doc, shapes: { ...state.doc.shapes, [text.id]: nextText } } };
}

/** Remove an existing text-path attachment without changing its text content. */
export function detachTextPath(state: EditorState, textId: string): EditorState | null {
	const text = state.doc.shapes[textId];
	if (!text || text.type !== 'text' || !text.props.textPath) return null;
	return {
		...state,
		doc: {
			...state.doc,
			shapes: { ...state.doc.shapes, [textId]: { ...text, props: { ...text.props, textPath: undefined } } }
		}
	};
}
