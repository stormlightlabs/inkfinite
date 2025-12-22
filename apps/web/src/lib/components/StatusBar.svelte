<script lang="ts">
	import type { SnapSettings, SnapStore, StatusStore } from '$lib/status';
	import {
		type Box2,
		type CursorState,
		type CursorStore,
		type EditorState,
		type PersistenceStatus,
		type Store,
		EditorState as EditorStateOps,
		buildStatusBarVM,
		getSelectedShapes,
		getShapesOnCurrentPage,
		shapeBounds
	} from 'inkfinite-core';

	type Viewport = { width: number; height: number };
	const defaultViewport = () => ({ width: 1, height: 1 });

	type Props = {
		store: Store;
		cursor: CursorStore;
		persistence: StatusStore;
		snap: SnapStore;
		getViewport?: () => Viewport;
	};

	let { store, cursor, persistence, snap, getViewport = defaultViewport }: Props = $props();

	let editorSnapshot: EditorState = EditorStateOps.create();
	let cursorSnapshot: CursorState = { cursorWorld: { x: 0, y: 0 }, lastMoveAt: Date.now() };
	let persistenceSnapshot: PersistenceStatus = { backend: 'indexeddb', state: 'saved', pendingWrites: 0 };
	let snapSnapshot = $state<SnapSettings>({ snapEnabled: false, gridEnabled: true, gridSize: 25 });
	let statusVm = $state(buildStatusBarVM(editorSnapshot, cursorSnapshot, persistenceSnapshot));
	let zoomMenuOpen = $state(false);
	let zoomMenuEl = $state<HTMLDivElement | null>(null);
	let zoomButtonEl = $state<HTMLButtonElement | null>(null);

	function updateVm() {
		statusVm = buildStatusBarVM(editorSnapshot, cursorSnapshot, persistenceSnapshot);
	}

	$effect(() => {
		const currentStore = store;
		editorSnapshot = currentStore.getState();
		const unsubscribe = currentStore.subscribe((state) => {
			editorSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	$effect(() => {
		const currentCursor = cursor;
		cursorSnapshot = currentCursor.getState();
		const unsubscribe = currentCursor.subscribe((state) => {
			cursorSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	$effect(() => {
		const currentPersistence = persistence;
		persistenceSnapshot = currentPersistence.get();
		const unsubscribe = currentPersistence.subscribe((state) => {
			persistenceSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	$effect(() => {
		const currentSnap = snap;
		snapSnapshot = currentSnap.get();
		const unsubscribe = currentSnap.subscribe((state) => {
			snapSnapshot = state;
			updateVm();
		});
		return () => unsubscribe();
	});

	$effect(() => {
		if (!zoomMenuOpen || typeof document === 'undefined') {
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}
			if (zoomMenuEl?.contains(target) || zoomButtonEl?.contains(target)) {
				return;
			}
			zoomMenuOpen = false;
		};

		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	});

	function getViewportSize(): Viewport {
		return getViewport();
	}

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

	function setZoomPercent(percent: number) {
		const zoom = percent / 100;
		store.setState((state) => ({ ...state, camera: { ...state.camera, zoom } }));
		zoomMenuOpen = false;
	}

	function zoomToBounds(bounds: Box2) {
		const viewport = getViewportSize();
		const width = bounds.max.x - bounds.min.x || 1;
		const height = bounds.max.y - bounds.min.y || 1;
		const margin = 80;
		const scaleX = (viewport.width - margin) / width;
		const scaleY = (viewport.height - margin) / height;
		const zoom = Math.max(Math.min(scaleX, scaleY), 0.05);
		const center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
		store.setState((state) => ({ ...state, camera: { x: center.x, y: center.y, zoom } }));
		zoomMenuOpen = false;
	}

	function zoomToFit() {
		const shapes = getShapesOnCurrentPage(editorSnapshot);
		if (shapes.length === 0) {
			setZoomPercent(100);
			return;
		}
		const bounds = shapes.reduce<Box2 | null>((acc, shape) => {
			const shapeBox = shapeBounds(shape);
			if (!acc) {
				return shapeBox;
			}
			return {
				min: { x: Math.min(acc.min.x, shapeBox.min.x), y: Math.min(acc.min.y, shapeBox.min.y) },
				max: { x: Math.max(acc.max.x, shapeBox.max.x), y: Math.max(acc.max.y, shapeBox.max.y) }
			};
		}, null);

		if (bounds) {
			zoomToBounds(bounds);
		}
	}

	function zoomToSelection() {
		const shapes = getSelectedShapes(editorSnapshot);
		if (shapes.length === 0) {
			zoomToFit();
			return;
		}

		const bounds = shapes.reduce<Box2 | null>((acc, shape) => {
			const shapeBox = shapeBounds(shape);
			if (!acc) {
				return shapeBox;
			}
			return {
				min: { x: Math.min(acc.min.x, shapeBox.min.x), y: Math.min(acc.min.y, shapeBox.min.y) },
				max: { x: Math.max(acc.max.x, shapeBox.max.x), y: Math.max(acc.max.y, shapeBox.max.y) }
			};
		}, null);

		if (bounds) {
			zoomToBounds(bounds);
		}
	}

	const zoomPresets = [
		{ label: '50%', value: 50 },
		{ label: '100%', value: 100 },
		{ label: '200%', value: 200 }
	];

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
	<div class="status-section">
		<span class="label">Tool</span>
		<span class="value">{statusVm.toolId}</span>
		<span class="mode">{statusVm.mode}</span>
	</div>

	<div class="status-section">
		<span class="label">Cursor</span>
		<span class="value">
			{formatCursorCoord(statusVm.cursorWorld.x)}, {formatCursorCoord(statusVm.cursorWorld.y)}
		</span>
	</div>

	<div class="status-section">
		<span class="label">Selection</span>
		<span class="value">{formatSelection()}</span>
	</div>

	<div class="status-section snap">
		<span class="label">Snap</span>
		<div class="toggle-row">
			<label class="toggle">
				<input type="checkbox" checked={snapSnapshot.snapEnabled} onchange={handleSnapToggle} />
				<span>Main</span>
			</label>
			<label class="toggle">
				<input type="checkbox" checked={snapSnapshot.gridEnabled} onchange={handleGridToggle} />
				<span>Grid</span>
			</label>
		</div>
	</div>

	<div class="status-section zoom">
		<span class="label">Zoom</span>
		<button class="zoom-button" bind:this={zoomButtonEl} onclick={() => (zoomMenuOpen = !zoomMenuOpen)}>
			{statusVm.zoomPct}%
		</button>

		{#if zoomMenuOpen}
			<div class="zoom-menu" bind:this={zoomMenuEl}>
				{#each zoomPresets as preset}
					<button onclick={() => setZoomPercent(preset.value)}>{preset.label}</button>
				{/each}
				<div class="menu-divider"></div>
				<button onclick={zoomToFit}>Zoom to fit</button>
				<button onclick={zoomToSelection}>Zoom to selection</button>
			</div>
		{/if}
	</div>

	<div class="status-section persistence">
		<span class="label">Sync</span>
		<span class="value" class:error={statusVm.persistence.state === 'error'}>{formatPersistenceSummary()}</span>
	</div>
</div>

<style>
	.status-bar {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		padding: 8px 16px;
		background: var(--surface-elevated);
		border-top: 1px solid var(--border);
		font-size: 13px;
		align-items: center;
		min-height: 48px;
	}

	.status-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
		position: relative;
	}

	.status-section.snap,
	.status-section.zoom {
		align-items: flex-start;
	}

	.toggle-row {
		display: flex;
		gap: 8px;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--text);
	}

	.toggle input {
		margin: 0;
	}

	.label {
		font-size: 11px;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.value {
		font-weight: 500;
		color: var(--text);
	}

	.value.error {
		color: var(--error, #d14343);
	}

	.mode {
		font-size: 12px;
		color: var(--text-muted);
	}

	.zoom-button {
		border: 1px solid var(--border);
		background: var(--surface);
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
	}

	.zoom-button:hover {
		background: var(--surface-elevated);
	}

	.zoom-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 10;
	}

	.zoom-menu button {
		border: none;
		background: transparent;
		padding: 4px 8px;
		border-radius: 4px;
		text-align: left;
		cursor: pointer;
	}

	.zoom-menu button:hover {
		background: var(--surface-elevated);
	}

	.menu-divider {
		height: 1px;
		background: var(--border);
		margin: 6px 0;
	}
</style>
