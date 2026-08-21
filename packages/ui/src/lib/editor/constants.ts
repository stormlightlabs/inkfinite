import type { ToolId } from '@inkfinite/core';
import type { IconName } from '../icons';

export const HELP_LINKS = [
	{ label: 'README', href: 'https://github.com/stormlightlabs/inkfinite', external: true },
	{ label: 'Read the Docs', href: '/', external: false },
	{
		label: 'Issue Tracker',
		href: 'https://github.com/stormlightlabs/inkfinite/issues',
		external: true
	}
];

export const KEYBOARD_TIPS = [
	'⌘/Ctrl + Z to undo, ⇧ + ⌘/Ctrl + Z to redo',
	'Hold space to pan the canvas',
	'Scroll to pan; pinch or Ctrl/Cmd+scroll to zoom'
];

/** Searchable editor keyboard commands shown by the `?` panel. */
export const KEYBOARD_SHORTCUTS = [
	{ group: 'Selection', label: 'Select all shapes', keys: '⌘/Ctrl A' },
	{ group: 'Selection', label: 'Clear selection', keys: 'Escape' },
	{ group: 'Selection', label: 'Nudge selection', keys: 'Arrow keys' },
	{ group: 'Selection', label: 'Nudge by 10 px', keys: 'Shift + Arrow keys' },
	{ group: 'Editing', label: 'Copy selection', keys: '⌘/Ctrl C' },
	{ group: 'Editing', label: 'Cut selection', keys: '⌘/Ctrl X' },
	{ group: 'Editing', label: 'Paste selection', keys: '⌘/Ctrl V' },
	{ group: 'Editing', label: 'Duplicate selection', keys: '⌘/Ctrl D' },
	{ group: 'Editing', label: 'Group selection', keys: '⌘/Ctrl G' },
	{ group: 'Editing', label: 'Ungroup selection', keys: '⇧⌘/Ctrl G' },
	{ group: 'Editing', label: 'Lock selection', keys: '⇧⌘/Ctrl L' },
	{ group: 'Editing', label: 'Undo', keys: '⌘/Ctrl Z' },
	{ group: 'Editing', label: 'Redo', keys: '⇧⌘/Ctrl Z or ⌘/Ctrl Y' },
	{ group: 'Order', label: 'Bring forward / send backward', keys: '⌘/Ctrl ] / [' },
	{ group: 'Order', label: 'Bring to front / send to back', keys: '⇧⌘/Ctrl ] / [' },
	{ group: 'Canvas', label: 'Pan canvas', keys: 'Space + drag' },
	{ group: 'Canvas', label: 'Zoom in / out', keys: '+ / −' },
	{ group: 'Canvas', label: 'Fit drawing', keys: 'Shift + 1' },
	{ group: 'Canvas', label: 'Fit selection', keys: 'Shift + 2' },
	{ group: 'Navigation', label: 'Open boards', keys: '⌘/Ctrl B' },
	{ group: 'Navigation', label: 'Show keyboard shortcuts', keys: '?' }
] as const;

export const DEFAULT_FILL_COLOR = '#4a90e2';
export const DEFAULT_STROKE_COLOR = '#2e5c8a';

export const TOOLS: Array<{ id: ToolId; label: string; icon: IconName }> = [
	{ id: 'select', label: 'Select', icon: 'select' },
	{ id: 'direct-select', label: 'Direct Select', icon: 'direct-select' },
	{ id: 'rect', label: 'Rectangle', icon: 'rectangle' },
	{ id: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
	{ id: 'frame', label: 'Frame', icon: 'rectangle' },
	{ id: 'line', label: 'Line', icon: 'line' },
	{ id: 'arrow', label: 'Arrow', icon: 'arrow-right' },
	{ id: 'text', label: 'Text', icon: 'text' },
	{ id: 'markdown', label: 'Markdown', icon: 'markdown' },
	{ id: 'pen', label: 'Pen', icon: 'pencil' }
];

export const ZOOM_PRESETS = [
	{ label: '50%', value: 50 },
	{ label: '100%', value: 100 },
	{ label: '200%', value: 200 }
];
