import type { ToolId } from '@inkfinite/core';
import type { IconName } from '../icons';

export const HELP_LINKS = [
	{ label: 'README', href: 'https://github.com/stormlightlabs/inkfinite', external: true },
	{ label: 'Read the Docs', href: '/docs', external: true },
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

export const DEFAULT_FILL_COLOR = '#4a90e2';
export const DEFAULT_STROKE_COLOR = '#2e5c8a';

export const TOOLS: Array<{ id: ToolId; label: string; icon: IconName }> = [
	{ id: 'select', label: 'Select', icon: 'select' },
	{ id: 'rect', label: 'Rectangle', icon: 'rectangle' },
	{ id: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
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
