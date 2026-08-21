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
	pointerDown: boolean,
	rotation = 0
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
		if (targetHandle in handleCursorMap && targetHandle !== 'rotate') {
			return resizeCursorForRotation(targetHandle, rotation);
		}
		return handleCursorMap[targetHandle] ?? 'default';
	}
	if (pointerDown) {
		return 'grabbing';
	}
	return 'default';
}

function resizeCursorForRotation(handle: string, rotation: number): string {
	const baseAngle =
		handle === 'n' || handle === 's'
			? 0
			: handle === 'e' || handle === 'w'
				? Math.PI / 2
				: handle === 'ne' || handle === 'sw'
					? Math.PI / 4
					: -Math.PI / 4;
	const octant = ((Math.round((rotation + baseAngle) / (Math.PI / 4)) % 4) + 4) % 4;
	return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][octant] ?? 'default';
}

export function isUserCancelled(error: unknown) {
	return error instanceof Error && /cancel/i.test(error.message);
}
