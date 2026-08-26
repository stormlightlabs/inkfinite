<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { untrack } from 'svelte';
	import IconButton from '../../components/IconButton.svelte';

	let { store }: { store: Store } = $props();
	let history = $state.raw(untrack(() => store.getHistory()));

	$effect(() =>
		store.subscribe(() => {
			history = store.getHistory();
		})
	);
</script>

<nav class="history-controls" aria-label="Edit history" data-agent-occlusion>
	<IconButton
		label="Undo"
		name="undo"
		title="Undo (Ctrl/Cmd+Z)"
		disabled={history.undoStack.length === 0}
		onclick={() => store.undo()} />
	<IconButton
		label="Redo"
		name="redo"
		title="Redo (Shift+Ctrl/Cmd+Z)"
		disabled={history.redoStack.length === 0}
		onclick={() => store.redo()} />
</nav>

<style>
	.history-controls {
		position: absolute;
		right: var(--ink-space-4);
		bottom: var(--ink-space-4);
		z-index: 4;
		display: flex;
		align-items: center;
		padding: var(--ink-space-1);
		border-radius: var(--ink-radius-panel-small);
		background: var(--ink-surface-raised);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 58%, transparent),
			var(--ink-shadow-control);
	}
</style>
