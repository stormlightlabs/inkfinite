export const handleCursorMap: Record<string, string> = {
	n: 'ns-resize',
	s: 'ns-resize',
	e: 'ew-resize',
	w: 'ew-resize',
	ne: 'nesw-resize',
	sw: 'nesw-resize',
	nw: 'nwse-resize',
	se: 'nwse-resize',
	rotate: 'alias',
	'line-start': 'crosshair',
	'line-end': 'crosshair'
};

export function computeCursor(
	textEditing: boolean,
	pan: { isPanning: boolean; spaceHeld: boolean },
	handle: { hover: string | null; active: string | null },
	pointerDown: boolean
): string {
	if (textEditing) {
		return 'text';
	}
	if (pan.isPanning) {
		return 'grabbing';
	}
	if (pan.spaceHeld) {
		return 'grab';
	}
	const targetHandle = handle.active ?? handle.hover;
	if (targetHandle) {
		return handleCursorMap[targetHandle] ?? 'default';
	}
	if (pointerDown) {
		return 'grabbing';
	}
	return 'default';
}

export function isUserCancelled(error: unknown) {
	return error instanceof Error && /cancel/i.test(error.message);
}
