import type { SnapGuide } from '@inkfinite/core';

export class PointerState {
	isPointerDown = $state(false);
	snappedWorld = $state<{ x: number; y: number } | null>(null);
	snapGuides = $state<SnapGuide[]>([]);
}
