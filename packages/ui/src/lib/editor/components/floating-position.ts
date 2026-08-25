export type FloatingSize = { width: number; height: number };
export type FloatingBounds = FloatingSize & {
	availableWidth: number;
	availableHeight: number;
	gutter?: number;
};

/** Keeps a floating control inside its available rectangle. */
export function clampFloatingPosition(
	left: number,
	top: number,
	bounds: FloatingBounds
): { left: number; top: number } {
	const gutter = bounds.gutter ?? 8;
	return {
		left: Math.min(
			Math.max(gutter, left),
			Math.max(gutter, bounds.availableWidth - bounds.width - gutter)
		),
		top: Math.min(
			Math.max(gutter, top),
			Math.max(gutter, bounds.availableHeight - bounds.height - gutter)
		)
	};
}

/** Moves a floating control by a delta while applying the same edge clamping. */
export function moveFloatingPosition(
	position: { left: number; top: number },
	delta: { x: number; y: number },
	bounds: FloatingBounds
): { left: number; top: number } {
	return clampFloatingPosition(position.left + delta.x, position.top + delta.y, bounds);
}
