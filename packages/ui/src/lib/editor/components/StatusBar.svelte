<script lang="ts">
	import type {
		CursorState,
		CursorStore,
		EditorState,
		PersistenceStatus,
		Store
	} from '@inkfinite/core';
	import { EditorState as EditorStateOps, buildStatusBarVM } from '@inkfinite/core';
	import Dialog from '../../components/Dialog.svelte';
	import Icon from '../../components/Icon.svelte';
	import { HELP_LINKS, KEYBOARD_TIPS } from '../constants';
	import type { EditorPlatform } from '../platform';
	import type { SnapSettings, SnapStore, StatusStore } from '../status';
	import { themeStore } from '../theme.svelte';

	type Props = {
		store: Store;
		cursor: CursorStore;
		persistence: StatusStore;
		snap: SnapStore;
		platform?: EditorPlatform;
		draft?: boolean;
		onOpenBrowser?: () => void;
		onHistoryClick?: () => void;
	};

	let {
		store,
		cursor,
		persistence,
		snap,
		platform = 'web',
		draft = false,
		onOpenBrowser,
		onHistoryClick
	}: Props = $props();

	let infoOpen = $state(false);

	let editorSnapshot: EditorState = EditorStateOps.create();
	let cursorSnapshot: CursorState = { cursorWorld: { x: 0, y: 0 }, lastMoveAt: Date.now() };
	let persistenceSnapshot: PersistenceStatus = {
		backend: 'indexeddb',
		state: 'saved',
		pendingWrites: 0
	};
	let snapSnapshot = $state<SnapSettings>({
		snapEnabled: false,
		gridEnabled: true,
		gridSize: 25
	});
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
		const savedLabel = draft ? 'Draft saved' : 'Saved';
		if (state.state === 'error') {
			return state.errorMsg ? `Error: ${state.errorMsg}` : 'Error';
		}
		if (state.state === 'saving' || (state.pendingWrites ?? 0) > 0) {
			return draft ? 'Saving draft…' : 'Saving…';
		}
		if (state.lastSavedAt) {
			const seconds = Math.floor((Date.now() - state.lastSavedAt) / 1000);
			if (seconds < 1) {
				return `${savedLabel} just now`;
			}
			if (seconds < 60) {
				return `${savedLabel} ${seconds}s ago`;
			}
			const minutes = Math.floor(seconds / 60);
			return `${savedLabel} ${minutes}m ago`;
		}
		return savedLabel;
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
			{formatCursorCoord(statusVm.cursorWorld.x)}, {formatCursorCoord(
				statusVm.cursorWorld.y
			)}
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
		<span class="status-bar__label">Save</span>
		<span
			class="status-bar__value"
			class:status-bar__value--error={statusVm.persistence.state === 'error'}>
			{formatPersistenceSummary()}
		</span>
	</div>

	<div class="status-bar__actions" aria-label="Editor utilities">
		<button
			class="status-bar__action"
			onclick={() => themeStore.toggle()}
			aria-label="Toggle Dark Mode"
			title="Toggle Dark Mode">
			<Icon name={themeStore.current === 'dark' ? 'sun' : 'moon'} size={15} />
			<span>{themeStore.current === 'dark' ? 'Light' : 'Dark'}</span>
		</button>
		{#if platform === 'web' && onOpenBrowser}
			<button class="status-bar__action" onclick={onOpenBrowser} aria-label="Browse boards">
				<Icon name="folder" size={15} />
				<span>Boards</span>
			</button>
		{/if}
		<button
			class="status-bar__action"
			onclick={() => (infoOpen = true)}
			aria-label="About Inkfinite">
			<Icon name="info-circle" size={15} />
			<span>Info</span>
		</button>
		{#if onHistoryClick}
			<button class="status-bar__action" onclick={onHistoryClick} aria-label="History">
				<Icon name="history" size={15} />
				<span>History</span>
			</button>
		{/if}
	</div>
</div>

<Dialog bind:open={infoOpen} onClose={() => (infoOpen = false)} title="About Inkfinite">
	<section class="about">
		<h1>About Inkfinite</h1>
		<p>
			Inkfinite is an infinite canvas prototype. The goal is to build a cross-platform editor
			with a framework-agnostic core so the same engine powers both the web and desktop apps.
		</p>
		<div class="about__section">
			<h2>Quick Tips</h2>
			<ul>
				{#each KEYBOARD_TIPS as tip (tip)}<li>{tip}</li>{/each}
			</ul>
		</div>
		<div class="about__section">
			<h2>Need help?</h2>
			<ul>
				{#each HELP_LINKS as link (link.href)}
					<li>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a
							href={link.href}
							target={link.external ? '_blank' : undefined}
							rel="noreferrer">{link.label}</a>
					</li>
				{/each}
			</ul>
		</div>
	</section>
</Dialog>

<style>
	.status-bar {
		display: grid;
		grid-template-columns: repeat(4, minmax(120px, 1fr)) auto auto;
		gap: 1.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--ink-surface-raised);
		border-top: 1px solid color-mix(in srgb, var(--ink-border) 46%, transparent);
		box-shadow: 0 -8px 24px color-mix(in srgb, var(--ink-shadow-color) 10%, transparent);
		font-size: 0.75rem;
		align-items: center;
		min-height: 48px;
	}

	.status-bar__actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--ink-space-1);
	}

	.status-bar__action {
		display: inline-flex;
		min-height: 32px;
		align-items: center;
		gap: var(--ink-space-1);
		padding: var(--ink-space-1) var(--ink-space-2);
		border: 1px solid transparent;
		border-radius: var(--ink-radius-wobbly-small);
		color: var(--ink-text-muted);
		background: transparent;
		cursor: pointer;
		transition-property: color, background-color, border-color, transform;
		transition-duration: var(--ink-duration-fast);
	}

	.status-bar__action:hover {
		border-color: color-mix(in srgb, var(--ink-border) 55%, transparent);
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.status-bar__action:active {
		transform: scale(0.96);
	}

	.status-bar__action:focus-visible {
		outline: 2px solid var(--ink-accent);
		outline-offset: 2px;
	}

	.status-bar__action span {
		font-size: var(--ink-type-xs);
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
		color: var(--ink-text);
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
		outline: 2px solid var(--ink-accent);
		outline-offset: 2px;
	}

	.status-bar__label {
		font-size: 0.6875rem;
		color: var(--ink-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.075em;
		font-weight: 600;
	}

	.status-bar__value {
		font-weight: 500;
		color: var(--ink-text);
		font-variant-numeric: tabular-nums;
	}

	.status-bar__value--error {
		color: var(--ink-danger);
	}

	.status-bar__mode {
		font-size: 0.75rem;
		color: var(--ink-text-muted);
	}

	.about {
		max-width: 480px;
		padding: var(--ink-space-5);
	}

	.about h1 {
		margin-top: 0;
	}

	.about__section {
		margin-top: var(--ink-space-5);
	}

	.about__section h2 {
		font-size: var(--ink-type-base);
	}

	@media (max-width: 960px) {
		.status-bar {
			display: flex;
			min-height: 48px;
			gap: var(--ink-space-4);
			padding: var(--ink-space-1) var(--ink-space-3);
			overflow-x: auto;
			overflow-y: hidden;
			white-space: nowrap;
			scrollbar-width: thin;
		}

		.status-bar__section,
		.status-bar__actions {
			flex: 0 0 auto;
		}

		.status-bar__actions {
			justify-content: flex-start;
			margin-left: auto;
		}
	}

	@media (max-width: 720px) {
		.status-bar {
			gap: var(--ink-space-3);
		}

		.status-bar__label,
		.status-bar__mode {
			display: none;
		}

		.status-bar__section {
			gap: var(--ink-space-1);
		}

		.status-bar__toggle-row {
			gap: var(--ink-space-3);
		}
	}
</style>
