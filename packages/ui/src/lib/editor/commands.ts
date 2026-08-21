import {
	alignShapes,
	distributeShapes,
	groupShapes,
	reorderShapes,
	reorderShapesToEdge,
	setShapesAgentEditable,
	setShapesLocked,
	SnapshotCommand,
	ungroupShapes,
	type EditorState,
	type ShapeAlignment,
	type Store
} from '@inkfinite/core';

/** Commands shared by the selection toolbar and canvas context menu. */
export type SelectionCommand =
	| `align-${ShapeAlignment}`
	| 'distribute-horizontal'
	| 'distribute-vertical'
	| 'group'
	| 'ungroup'
	| 'forward'
	| 'backward'
	| 'front'
	| 'back'
	| 'lock'
	| 'unlock'
	| 'agent-editable'
	| 'agent-readonly';

/** User-facing names used for history entries and command menus. */
export const SELECTION_COMMAND_LABELS: Record<SelectionCommand, string> = {
	'align-left': 'Align Left',
	'align-center': 'Align Center',
	'align-right': 'Align Right',
	'align-top': 'Align Top',
	'align-middle': 'Align Middle',
	'align-bottom': 'Align Bottom',
	'distribute-horizontal': 'Distribute Horizontally',
	'distribute-vertical': 'Distribute Vertically',
	group: 'Group',
	ungroup: 'Ungroup',
	forward: 'Bring Forward',
	backward: 'Send Backward',
	front: 'Bring to Front',
	back: 'Send to Back',
	lock: 'Lock',
	unlock: 'Unlock',
	'agent-editable': 'Allow Agent Edits',
	'agent-readonly': 'Prevent Agent Edits'
};

/** Applies one selection command without adding a history entry. */
export function applySelectionCommand(state: EditorState, command: SelectionCommand): EditorState {
	const ids = state.ui.selectionIds;
	switch (command) {
		case 'group':
			return groupShapes(state, ids);
		case 'ungroup':
			return ungroupShapes(state, ids);
		case 'forward':
			return reorderShapes(state, ids, 'forward');
		case 'backward':
			return reorderShapes(state, ids, 'backward');
		case 'front':
			return reorderShapesToEdge(state, ids, 'front');
		case 'back':
			return reorderShapesToEdge(state, ids, 'back');
		case 'lock':
			return setShapesLocked(state, ids, true);
		case 'unlock':
			return setShapesLocked(state, ids, false);
		case 'agent-editable':
			return setShapesAgentEditable(state, ids, true);
		case 'agent-readonly':
			return setShapesAgentEditable(state, ids, false);
		case 'distribute-horizontal':
			return distributeShapes(state, ids, 'horizontal');
		case 'distribute-vertical':
			return distributeShapes(state, ids, 'vertical');
		default:
			return alignShapes(state, ids, command.slice('align-'.length) as ShapeAlignment);
	}
}

/** Applies a selection command as one undoable editor command. */
export function executeSelectionCommand(store: Store, command: SelectionCommand): boolean {
	const before = store.getState();
	const after = applySelectionCommand(before, command);
	if (after === before) return false;
	store.executeCommand(
		new SnapshotCommand(SELECTION_COMMAND_LABELS[command], 'doc', before, after)
	);
	return true;
}
