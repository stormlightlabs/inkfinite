<script lang="ts">
	import type { SnapSettings, SnapStore, StatusStore } from '$lib/status';
	import {
		type CursorState,
		type CursorStore,
		type EditorState,
		type PersistenceStatus,
		type Store,
		EditorState as EditorStateOps,
		buildStatusBarVM
	} from 'inkfinite-core';

	type Props = { store: Store; cursor: CursorStore; persistence: StatusStore; snap: SnapStore };

	let { store, cursor, persistence, snap }: Props = $props();

	let editorSnapshot: EditorState = EditorStateOps.create();
	let cursorSnapshot: CursorState = { cursorWorld: { x: 0, y: 0 }, lastMoveAt: Date.now() };
	let persistenceSnapshot: PersistenceStatus = {
		backend: 'indexeddb',
		state: 'saved',
		pendingWrites: 0
	};
	let snapSnapshot = $state<SnapSettings>({ snapEnabled: false, gridEnabled: true, gridSize: 25 });
	let statusVm = $state(buildStatusBarVM(editorSnapshot, cursorSnapshot, persistenceSnapshot));

	function updateVm() {
		statusVm = buildStatusBarVM(editorSnapshot, cursorSnapshot, persistenceSnapshot);
	}

	$effect(() => {
		const currentStore = store;
		editorSnapshot = currentStore.getState();
		updateVm();
		const unsubscribe = currentStore.subscribe((state) => {
			editorSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	$effect(() => {
		const currentCursor = cursor;
		cursorSnapshot = currentCursor.getState();
		updateVm();
		const unsubscribe = currentCursor.subscribe((state) => {
			cursorSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	$effect(() => {
		const currentPersistence = persistence;
		persistenceSnapshot = currentPersistence.get();
		updateVm();
		const unsubscribe = currentPersistence.subscribe((state) => {
			persistenceSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	$effect(() => {
		const currentSnap = snap;
		snapSnapshot = currentSnap.get();
		updateVm();
		const unsubscribe = currentSnap.subscribe((state) => {
			snapSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	function formatCursorCoord(value: number): string {
		return Math.round(value).toString();
	}

	function formatSelection(): string {
		const selection = statusVm.selection;
		if (selection.count === 0) {
			return 'No selection';
		}
		if (selection.count === 1) {
			const bounds = selection.bounds;
			const size = bounds ? ` ${Math.round(bounds.w)}×${Math.round(bounds.h)}` : '';
			return `${selection.kind ?? 'shape'}${size}`;
		}
		return `${selection.count} items`;
	}

	function formatPersistenceSummary(): string {
		const state = statusVm.persistence;
		if (state.state === 'error') {
			return state.errorMsg ? `Error: ${state.errorMsg}` : 'Error';
		}
		if (state.state === 'saving' || (state.pendingWrites ?? 0) > 0) {
			return 'Saving…';
		}
		if (state.lastSavedAt) {
			const seconds = Math.floor((Date.now() - state.lastSavedAt) / 1000);
			if (seconds < 1) {
				return 'Saved just now';
			}
			if (seconds < 60) {
				return `Saved ${seconds}s ago`;
			}
			const minutes = Math.floor(seconds / 60);
			return `Saved ${minutes}m ago`;
		}
		return 'Saved';
	}

	function handleSnapToggle(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		snap.update((current) => ({ ...current, snapEnabled: target.checked }));
	}

	function handleGridToggle(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		snap.update((current) => ({ ...current, gridEnabled: target.checked }));
	}
</script>

<div class="status-bar">
	<div class="status-bar__section">
		<span class="status-bar__label">Tool</span>
		<span class="status-bar__value">{statusVm.toolId}</span>
		<span class="status-bar__mode">{statusVm.mode}</span>
	</div>

	<div class="status-bar__section">
		<span class="status-bar__label">Cursor</span>
		<span class="status-bar__value">
			{formatCursorCoord(statusVm.cursorWorld.x)}, {formatCursorCoord(statusVm.cursorWorld.y)}
		</span>
	</div>

	<div class="status-bar__section">
		<span class="status-bar__label">Selection</span>
		<span class="status-bar__value">{formatSelection()}</span>
	</div>

	<div class="status-bar__section">
		<div class="status-bar__toggle-row">
			<label class="status-bar__toggle">
				<span>Snap</span>
				<input
					type="checkbox"
					checked={snapSnapshot.snapEnabled}
					onchange={handleSnapToggle}
					aria-label="Enable main snapping" />
			</label>
			<label class="status-bar__toggle">
				<span>Show Grid</span>
				<input
					type="checkbox"
					checked={snapSnapshot.gridEnabled}
					onchange={handleGridToggle}
					aria-label="Enable grid snapping" />
			</label>
		</div>
	</div>

	<div class="status-bar__section status-bar__section--persistence">
		<span class="status-bar__label">Sync</span>
		<span
			class="status-bar__value"
			class:status-bar__value--error={statusVm.persistence.state === 'error'}>
			{formatPersistenceSummary()}
		</span>
	</div>
</div>

<style>
	.status-bar {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--surface-elevated);
		border-top: 1px solid var(--border);
		font-size: 0.75rem;
		align-items: center;
		min-height: 48px;
	}

	.status-bar__section {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.75rem;
		position: relative;
	}

	.status-bar__toggle-row {
		display: flex;
		gap: 1.25rem;
	}

	.status-bar__toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text);
	}

	.status-bar__toggle input {
		margin: 0;
		cursor: pointer;
        opacity: 0.8;
	}

    .status-bar__toggle:hover input {
        opacity: 1;
    }

	.status-bar__toggle input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.status-bar__label {
		font-size: 0.6875rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.075em;
        font-weight: 600;
	}

	.status-bar__value {
		font-weight: 500;
		color: var(--text);
        font-variant-numeric: tabular-nums;
	}

	.status-bar__value--error {
		color: var(--color-error);
	}

	.status-bar__mode {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
</style>
