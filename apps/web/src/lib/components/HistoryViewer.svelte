<script lang="ts">
	/**
	 * History Viewer component
	 *
	 * Displays the undo/redo history in a Sheet (drawer).
	 * Shows command names and timestamps.
	 */

	import type { Store } from 'inkfinite-core';
	import Sheet from './Sheet.svelte';

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
				<button onclick={handleUndo} disabled={!store.canUndo()}>Undo</button>
				<button onclick={handleRedo} disabled={!store.canRedo()}>Redo</button>
			</div>
		</div>

		<div class="history-section">
			<h3>Undo Stack ({history.undoStack.length})</h3>
			{#if history.undoStack.length === 0}
				<p class="empty-state">No actions to undo</p>
			{:else}
				<ul class="history-list">
					{#each history.undoStack as entry, index}
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
					{#each history.redoStack as entry, index}
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
	}

	.history-content {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.history-header {
		padding: 16px;
		border-bottom: 1px solid #e0e0e0;
		background-color: #f5f5f5;
	}

	.history-header h2 {
		margin: 0 0 12px 0;
		font-size: 18px;
		font-weight: 600;
	}

	.history-actions {
		display: flex;
		gap: 8px;
	}

	.history-actions button {
		padding: 6px 12px;
		border: 1px solid #ccc;
		border-radius: 4px;
		background-color: white;
		cursor: pointer;
		font-size: 14px;
	}

	.history-actions button:hover:not(:disabled) {
		background-color: #f0f0f0;
	}

	.history-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.history-section {
		padding: 16px;
		border-bottom: 1px solid #e0e0e0;
	}

	.history-section h3 {
		margin: 0 0 12px 0;
		font-size: 14px;
		font-weight: 600;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.empty-state {
		margin: 0;
		padding: 12px;
		text-align: center;
		color: #999;
		font-size: 14px;
		font-style: italic;
	}

	.history-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.history-entry {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		margin-bottom: 4px;
		border-radius: 4px;
		background-color: #f9f9f9;
		border-left: 3px solid #4dabf7;
	}

	.history-entry.redo {
		border-left-color: #999;
		opacity: 0.7;
	}

	.entry-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.entry-name {
		font-size: 14px;
		font-weight: 500;
	}

	.entry-time {
		font-size: 12px;
		color: #666;
	}

	.entry-index {
		font-size: 12px;
		color: #999;
		font-weight: 500;
	}
</style>
