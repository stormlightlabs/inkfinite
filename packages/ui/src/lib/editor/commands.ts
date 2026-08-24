import {
	alignShapes,
	booleanPathSelection,
	canBooleanPathSelection,
	distributeShapes,
	graphLayout,
	gridShapes,
	stackShapes,
	tidyShapes,
	groupShapes,
	reorderShapes,
	reorderShapesToEdge,
	setShapesAgentEditable,
	setShapesLocked,
	SnapshotCommand,
	ungroupShapes,
	convertSelectedShapes
} from '@inkfinite/core';
import type {
	SelectionConversionTarget,
	EditorState,
	ShapeAlignment,
	Store
} from '@inkfinite/core';

/** Commands shared by the selection toolbar and canvas context menu. */
export type SelectionCommand =
	| `align-${ShapeAlignment}`
	| 'boolean-union'
	| 'boolean-intersection'
	| 'boolean-difference'
	| 'boolean-exclusion'
	| 'distribute-horizontal'
	| 'distribute-vertical'
	| 'stack-horizontal'
	| 'stack-vertical'
	| 'arrange-grid'
	| 'tidy'
	| 'graph-flow-top-to-bottom'
	| 'graph-flow-left-to-right'
	| 'graph-tree-top-to-bottom'
	| 'graph-tree-left-to-right'
	| 'graph-radial'
	| 'group'
	| 'ungroup'
	| 'forward'
	| 'backward'
	| 'front'
	| 'back'
	| 'lock'
	| 'unlock'
	| 'agent-editable'
	| 'agent-readonly'
	| `convert-to-${SelectionConversionTarget}`;

/** User-facing names used for history entries and command menus. */
export const SELECTION_COMMAND_LABELS: Record<SelectionCommand, string> = {
	'boolean-union': 'Union Paths',
	'boolean-intersection': 'Intersect Paths',
	'boolean-difference': 'Subtract Paths',
	'boolean-exclusion': 'Exclude Paths',
	'align-left': 'Align Left',
	'align-center': 'Align Center',
	'align-right': 'Align Right',
	'align-top': 'Align Top',
	'align-middle': 'Align Middle',
	'align-bottom': 'Align Bottom',
	'distribute-horizontal': 'Distribute Horizontally',
	'distribute-vertical': 'Distribute Vertically',
	'stack-horizontal': 'Stack Horizontally',
	'stack-vertical': 'Stack Vertically',
	'arrange-grid': 'Arrange in Grid',
	tidy: 'Tidy Up',
	'graph-flow-top-to-bottom': 'Flow Top to Bottom',
	'graph-flow-left-to-right': 'Flow Left to Right',
	'graph-tree-top-to-bottom': 'Tree Top to Bottom',
	'graph-tree-left-to-right': 'Tree Left to Right',
	'graph-radial': 'Radial Layout',
	group: 'Group',
	ungroup: 'Ungroup',
	forward: 'Bring Forward',
	backward: 'Send Backward',
	front: 'Bring to Front',
	back: 'Send to Back',
	lock: 'Lock',
	unlock: 'Unlock',
	'agent-editable': 'Allow Agent Edits',
	'agent-readonly': 'Prevent Agent Edits',
	'convert-to-rect': 'Convert to Rectangle',
	'convert-to-ellipse': 'Convert to Ellipse'
};

/** Applies one selection command without adding a history entry. */
export function applySelectionCommand(state: EditorState, command: SelectionCommand): EditorState {
	const ids = state.ui.selectionIds;
	switch (command) {
		case 'boolean-union':
			return booleanPathSelection(state, 'union') ?? state;
		case 'boolean-intersection':
			return booleanPathSelection(state, 'intersection') ?? state;
		case 'boolean-difference':
			return booleanPathSelection(state, 'difference') ?? state;
		case 'boolean-exclusion':
			return booleanPathSelection(state, 'exclusion') ?? state;
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
		case 'convert-to-rect':
			return convertSelectedShapes(state, 'rect');
		case 'convert-to-ellipse':
			return convertSelectedShapes(state, 'ellipse');
		case 'distribute-horizontal':
			return distributeShapes(state, ids, 'horizontal');
		case 'distribute-vertical':
			return distributeShapes(state, ids, 'vertical');
		case 'stack-horizontal':
			return stackShapes(state, ids, 'horizontal');
		case 'stack-vertical':
			return stackShapes(state, ids, 'vertical');
		case 'arrange-grid':
			return gridShapes(state, ids);
		case 'tidy':
			return tidyShapes(state, ids);
		case 'graph-flow-top-to-bottom':
			return graphLayout(state, ids, 'flow', 'top-to-bottom');
		case 'graph-flow-left-to-right':
			return graphLayout(state, ids, 'flow', 'left-to-right');
		case 'graph-tree-top-to-bottom':
			return graphLayout(state, ids, 'tree', 'top-to-bottom');
		case 'graph-tree-left-to-right':
			return graphLayout(state, ids, 'tree', 'left-to-right');
		case 'graph-radial':
			return graphLayout(state, ids, 'radial');
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

/** One searchable action shown in the editor command palette. */
export type CommandPaletteEntry = {
	id: string;
	label: string;
	group: 'Selection' | 'Viewport';
	shortcut?: string;
	keywords?: string;
	disabled?: boolean;
};

/**
 * Returns the selection and viewport actions available for the current state.
 * Disabled actions remain visible so keyboard users can discover the complete
 * command surface without guessing why a command is unavailable.
 */
export function getCommandPaletteEntries(
	state: EditorState,
	platform: 'web' | 'desktop' = 'web'
): CommandPaletteEntry[] {
	const selectedCount = state.ui.selectionIds.length;
	const alignmentEntries: CommandPaletteEntry[] = (
		[
			'align-left',
			'align-center',
			'align-right',
			'align-top',
			'align-middle',
			'align-bottom',
			'distribute-horizontal',
			'distribute-vertical',
			'stack-horizontal',
			'stack-vertical',
			'arrange-grid',
			'tidy',
			'graph-flow-top-to-bottom',
			'graph-flow-left-to-right',
			'graph-tree-top-to-bottom',
			'graph-tree-left-to-right',
			'graph-radial'
		] as SelectionCommand[]
	).map((id) => ({
		id,
		label: SELECTION_COMMAND_LABELS[id],
		group: 'Selection',
		disabled: selectedCount < (id.startsWith('distribute-') ? 3 : 2),
		keywords: 'align distribute layout'
	}));
	const booleanEntries: CommandPaletteEntry[] = (
		[
			'boolean-union',
			'boolean-intersection',
			'boolean-difference',
			'boolean-exclusion'
		] as SelectionCommand[]
	).map((id) => ({
		id,
		label: SELECTION_COMMAND_LABELS[id],
		group: 'Selection' as const,
		disabled: !canBooleanPathSelection(state),
		keywords: 'boolean path vector'
	}));
	const entries: CommandPaletteEntry[] = [
		{ id: 'select-all', label: 'Select all shapes', group: 'Selection', shortcut: '⌘/Ctrl A' },
		{
			id: 'clear-selection',
			label: 'Clear selection',
			group: 'Selection',
			shortcut: 'Escape'
		},
		{
			id: 'duplicate',
			label: 'Duplicate selection',
			group: 'Selection',
			shortcut: '⌘/Ctrl D',
			disabled: selectedCount === 0,
			keywords: 'copy'
		},
		{
			id: 'duplicate-and-connect',
			label: 'Duplicate and connect',
			group: 'Selection',
			shortcut: '⌥⌘/Ctrl D',
			disabled: selectedCount === 0,
			keywords: 'copy connector arrow'
		},
		...alignmentEntries,
		...booleanEntries,
		{
			id: 'convert-to-rect',
			label: SELECTION_COMMAND_LABELS['convert-to-rect'],
			group: 'Selection',
			disabled: selectedCount === 0,
			keywords: 'shape convert rectangle'
		},
		{
			id: 'convert-to-ellipse',
			label: SELECTION_COMMAND_LABELS['convert-to-ellipse'],
			group: 'Selection',
			disabled: selectedCount === 0,
			keywords: 'shape convert ellipse oval'
		},
		{
			id: 'group',
			label: SELECTION_COMMAND_LABELS.group,
			group: 'Selection',
			disabled: selectedCount < 2
		},
		{
			id: 'ungroup',
			label: SELECTION_COMMAND_LABELS.ungroup,
			group: 'Selection',
			disabled: selectedCount === 0
		},
		{
			id: 'forward',
			label: SELECTION_COMMAND_LABELS.forward,
			group: 'Selection',
			disabled: selectedCount === 0,
			shortcut: '⌘/Ctrl ]'
		},
		{
			id: 'backward',
			label: SELECTION_COMMAND_LABELS.backward,
			group: 'Selection',
			disabled: selectedCount === 0,
			shortcut: '⌘/Ctrl ['
		},
		{
			id: 'front',
			label: SELECTION_COMMAND_LABELS.front,
			group: 'Selection',
			disabled: selectedCount === 0,
			shortcut: '⇧⌘/Ctrl ]'
		},
		{
			id: 'back',
			label: SELECTION_COMMAND_LABELS.back,
			group: 'Selection',
			disabled: selectedCount === 0,
			shortcut: '⇧⌘/Ctrl ['
		},
		{
			id: 'lock',
			label: SELECTION_COMMAND_LABELS.lock,
			group: 'Selection',
			disabled: selectedCount === 0
		},
		{
			id: 'unlock',
			label: SELECTION_COMMAND_LABELS.unlock,
			group: 'Selection',
			disabled: selectedCount === 0
		},
		...(platform === 'desktop'
			? [
					{
						id: 'agent-editable',
						label: SELECTION_COMMAND_LABELS['agent-editable'],
						group: 'Selection' as const,
						disabled: selectedCount === 0
					},
					{
						id: 'agent-readonly',
						label: SELECTION_COMMAND_LABELS['agent-readonly'],
						group: 'Selection' as const,
						disabled: selectedCount === 0
					}
				]
			: []),
		{
			id: 'delete',
			label: 'Delete selection',
			group: 'Selection',
			shortcut: 'Backspace',
			disabled: selectedCount === 0,
			keywords: 'remove'
		},
		{ id: 'zoom-in', label: 'Zoom in', group: 'Viewport', shortcut: '+' },
		{ id: 'zoom-out', label: 'Zoom out', group: 'Viewport', shortcut: '−' },
		{ id: 'zoom-fit', label: 'Zoom to fit drawing', group: 'Viewport', shortcut: '⇧1' },
		{
			id: 'zoom-selection',
			label: 'Zoom to selection',
			group: 'Viewport',
			shortcut: '⇧2',
			disabled: selectedCount === 0
		},
		{ id: 'reset-zoom', label: 'Reset zoom', group: 'Viewport', shortcut: '0' }
	];
	return entries;
}
