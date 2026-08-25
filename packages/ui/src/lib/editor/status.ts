import type { BrushConfig } from '@inkfinite/core';
import type { PersistenceStatus } from './statusbar';

export type { PersistenceStatus } from './statusbar';

type StatusListener = (status: PersistenceStatus) => void;

export type StatusStore = {
	get(): PersistenceStatus;
	subscribe(listener: StatusListener): () => void;
	update(updater: (status: PersistenceStatus) => PersistenceStatus): void;
};

export type SnapSettings = {
	snapEnabled: boolean;
	gridEnabled: boolean;
	gridSize: number;
	objectSnapEnabled?: boolean;
	snapDistance?: number;
};

export type SnapStore = {
	get(): SnapSettings;
	subscribe(listener: (snap: SnapSettings) => void): () => void;
	update(updater: (snap: SnapSettings) => SnapSettings): void;
	set(next: SnapSettings): void;
};

export type BrushSettings = BrushConfig & { color: string };

export type BrushStore = {
	get(): BrushSettings;
	subscribe(listener: (brush: BrushSettings) => void): () => void;
	update(updater: (brush: BrushSettings) => BrushSettings): void;
	set(next: BrushSettings): void;
};

export function createStatusStore(initial: PersistenceStatus): StatusStore {
	let value = initial;
	const listeners = new Set<StatusListener>();

	return {
		get() {
			return value;
		},
		subscribe(listener: StatusListener) {
			listeners.add(listener);
			listener(value);
			return () => {
				listeners.delete(listener);
			};
		},
		update(updater) {
			value = updater(value);
			for (const listener of listeners) {
				listener(value);
			}
		}
	};
}

/**
 * IMPORTANT: Default gridSize must match DEFAULT_GRID_SIZE renderer
 * to ensure grid lines and snapping positions align correctly
 */
const SNAP_PREFERENCES_KEY = 'inkfinite:editor-snap-settings';

export function createSnapStore(initial?: Partial<SnapSettings>): SnapStore {
	const defaults: SnapSettings = {
		snapEnabled: false,
		gridEnabled: true,
		gridSize: 25,
		objectSnapEnabled: true,
		snapDistance: 8
	};
	let saved: Partial<SnapSettings> = {};
	if (typeof localStorage !== 'undefined') {
		try {
			const parsed = JSON.parse(localStorage.getItem(SNAP_PREFERENCES_KEY) ?? '{}');
			if (parsed && typeof parsed === 'object') saved = parsed;
		} catch {
			saved = {};
		}
	}
	let value: SnapSettings = { ...defaults, ...saved, ...initial };
	const persist = (next: SnapSettings) => {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(SNAP_PREFERENCES_KEY, JSON.stringify(next));
		} catch {
			// Preferences are optional when storage is unavailable or full.
		}
	};
	const listeners = new Set<(snap: SnapSettings) => void>();

	return {
		get() {
			return value;
		},
		subscribe(listener) {
			listeners.add(listener);
			listener(value);
			return () => {
				listeners.delete(listener);
			};
		},
		update(updater) {
			value = updater(value);
			persist(value);
			for (const listener of listeners) {
				listener(value);
			}
		},
		set(next) {
			value = next;
			persist(value);
			for (const listener of listeners) {
				listener(value);
			}
		}
	};
}

export function createBrushStore(initial?: Partial<BrushSettings>): BrushStore {
	const defaults: BrushSettings = {
		size: 16,
		thinning: 0.5,
		smoothing: 0.5,
		streamline: 0.5,
		simulatePressure: true,
		color: '#88c0d0'
	};
	let value: BrushSettings = { ...defaults, ...initial };
	const listeners = new Set<(brush: BrushSettings) => void>();

	return {
		get() {
			return value;
		},
		subscribe(listener) {
			listeners.add(listener);
			listener(value);
			return () => {
				listeners.delete(listener);
			};
		},
		update(updater) {
			value = updater(value);
			for (const listener of listeners) {
				listener(value);
			}
		},
		set(next) {
			value = next;
			for (const listener of listeners) {
				listener(value);
			}
		}
	};
}
