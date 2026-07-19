<script lang="ts">
	/**
	 * History Viewer component
	 *
	 * Displays the undo/redo history in a Sheet (drawer).
	 * Shows command names and timestamps.
	 */

	import type { Store } from '@inkfinite/core';
	import { Sheet } from '../../index';

	type Props = { store: Store; open: boolean; onClose: () => void };

	let { store, open = $bindable(false), onClose }: Props = $props();

	let history = $derived.by(() => store.getHistory());

	$effect(() => {
		const unsubscribe = store.subscribe(() => {
			history = store.getHistory();
		});

		return unsubscribe;
	});

	function formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString();
	}

	function handleUndo() {
		store.undo();
	}

	function handleRedo() {
		store.redo();
	}
</script>

<Sheet {open} {onClose} title="History" side="right" class="history-viewer">
	<div class="history-content">
		<div class="history-header">
			<h2>History</h2>
			<div class="history-actions">
				<button onclick={handleUndo} disabled={history.undoStack.length === 0}
					>Undo</button>
				<button onclick={handleRedo} disabled={history.redoStack.length === 0}
					>Redo</button>
			</div>
		</div>

		<div class="history-section">
			<h3>Undo Stack ({history.undoStack.length})</h3>
			{#if history.undoStack.length === 0}
				<p class="empty-state">No actions to undo</p>
			{:else}
				<ul class="history-list">
					{#each history.undoStack as entry, index (`UNDO:${entry.command.kind}:${entry.timestamp}`)}
						<li class="history-entry">
							<div class="entry-info">
								<span class="entry-name">{entry.command.name}</span>
								<span class="entry-time">{formatTimestamp(entry.timestamp)}</span>
							</div>
							<span class="entry-index">#{history.undoStack.length - index}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="history-section">
			<h3>Redo Stack ({history.redoStack.length})</h3>
			{#if history.redoStack.length === 0}
				<p class="empty-state">No actions to redo</p>
			{:else}
				<ul class="history-list">
					{#each history.redoStack as entry, index (`REDO:${entry.command.kind}:${entry.timestamp}`)}
						<li class="history-entry redo">
							<div class="entry-info">
								<span class="entry-name">{entry.command.name}</span>
								<span class="entry-time">{formatTimestamp(entry.timestamp)}</span>
							</div>
							<span class="entry-index">#{index + 1}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</Sheet>

<style>
	:global(.history-viewer) {
		padding: 0;
		background: var(--ink-surface);
	}

	.history-content {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.history-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-4);
		padding: var(--ink-space-5);
		border-bottom: 1px solid color-mix(in srgb, var(--ink-border) 55%, transparent);
		background: var(--ink-surface-raised);
	}

	.history-header h2 {
		margin: 0;
		color: var(--ink-heading);
		font-family: var(--ink-font-display);
		font-size: var(--ink-type-lg);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.history-actions {
		display: flex;
		flex-shrink: 0;
		gap: 8px;
	}

	.history-actions button {
		min-width: 5rem;
		min-height: var(--ink-control-height);
		padding: var(--ink-space-2) var(--ink-space-4);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-wobbly-small);
		background: var(--ink-canvas);
		color: var(--ink-text);
		box-shadow: 2px 2px 0 color-mix(in srgb, var(--ink-shadow-color) 82%, transparent);
		cursor: pointer;
		font-family: inherit;
		font-size: var(--ink-type-sm);
		font-weight: 650;
		transition-property: background-color, border-color, box-shadow, transform;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.history-actions button:hover:not(:disabled) {
		background: var(--ink-surface-hover);
		border-color: var(--ink-border-strong);
		box-shadow: 3px 3px 0 color-mix(in srgb, var(--ink-shadow-color) 90%, transparent);
		transform: translate(-1px, -1px);
	}

	.history-actions button:active:not(:disabled) {
		transform: scale(0.96);
	}

	.history-actions button:focus-visible {
		outline: 2px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.history-actions button:disabled {
		opacity: 0.42;
		cursor: not-allowed;
		box-shadow: none;
	}

	.history-section {
		padding: var(--ink-space-5);
		border-bottom: 1px solid color-mix(in srgb, var(--ink-border) 42%, transparent);
	}

	.history-section h3 {
		margin: 0 0 var(--ink-space-3);
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		font-weight: 750;
		font-variant-numeric: tabular-nums;
		text-transform: uppercase;
		letter-spacing: 0.09em;
	}

	.empty-state {
		margin: 0;
		padding: var(--ink-space-4);
		text-align: center;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-sm);
		font-style: italic;
	}

	.history-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--ink-space-2);
	}

	.history-entry {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--ink-space-3);
		padding: var(--ink-space-3) var(--ink-space-4);
		border: 1px solid var(--ink-accent);
		border-radius: var(--ink-radius-panel-small);
		background: var(--ink-canvas);
		box-shadow: 0 2px 5px color-mix(in srgb, var(--ink-shadow-color) 16%, transparent);
	}

	.history-entry.redo {
		border-color: var(--ink-warning);
		opacity: 0.76;
	}

	.entry-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.entry-name {
		color: var(--ink-text);
		font-size: var(--ink-type-sm);
		font-weight: 650;
		text-wrap: pretty;
	}

	.entry-time {
		font-size: 0.75rem;
		color: var(--ink-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.entry-index {
		font-size: 0.75rem;
		color: var(--ink-text-muted);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-reduced-motion: reduce) {
		.history-actions button {
			transition: none;
		}

		.history-actions button:hover:not(:disabled) {
			transform: none;
		}
	}
</style>
