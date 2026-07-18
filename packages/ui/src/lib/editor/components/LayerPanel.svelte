<script lang="ts">
	import {
		createLayer,
		deleteLayer,
		getLayersOnCurrentPage,
		moveLayer,
		patchLayer,
		type EditorState,
		type Store
	} from '@inkfinite/core';
	import { onMount } from 'svelte';

	let {
		store,
		onCommit
	}: { store: Store; onCommit: (name: string, next: EditorState) => void } = $props();
	// svelte-ignore state_referenced_locally
	let editorState: EditorState = $state(store.getState());
	let deletingLayerId = $state<string | null>(null);
	let deleteDestinationId = $state<string | null>(null);
	let layers = $derived(getLayersOnCurrentPage(editorState));

	onMount(() => store.subscribe((next) => (editorState = next)));

	function commit(name: string, next: EditorState) {
		if (next !== editorState) onCommit(name, next);
	}
</script>

<aside class="layer-panel" aria-label="Layers">
	<header>
		<h2>Layers</h2>
		<button type="button" onclick={() => commit('Create Layer', createLayer(editorState))}
			>Add layer</button>
	</header>
	<ul aria-label="Page layers">
		{#each [...layers].reverse() as layer, visualIndex (layer.id)}
			<li class:active={editorState.ui.activeLayerId === layer.id}>
				<button
					type="button"
					class="layer-select"
					aria-pressed={editorState.ui.activeLayerId === layer.id}
					onclick={() =>
						onCommit('Select Layer', {
							...editorState,
							ui: { ...editorState.ui, activeLayerId: layer.id, selectionIds: [] }
						})}>
					{layer.name}
				</button>
				<input
					aria-label={`Name for ${layer.name}`}
					value={layer.name}
					onchange={(event) =>
						commit(
							'Rename Layer',
							patchLayer(editorState, layer.id, { name: event.currentTarget.value })
						)} />
				<div class="layer-actions">
					<button
						type="button"
						aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
						aria-pressed={!layer.visible}
						onclick={() =>
							commit(
								layer.visible ? 'Hide Layer' : 'Show Layer',
								patchLayer(editorState, layer.id, { visible: !layer.visible })
							)}>
						{layer.visible ? 'Visible' : 'Hidden'}
					</button>
					<button
						type="button"
						aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}
						aria-pressed={layer.locked}
						onclick={() =>
							commit(
								layer.locked ? 'Unlock Layer' : 'Lock Layer',
								patchLayer(editorState, layer.id, { locked: !layer.locked })
							)}>
						{layer.locked ? 'Locked' : 'Unlocked'}
					</button>
					<button
						type="button"
						aria-label={`Move ${layer.name} forward`}
						disabled={visualIndex === 0}
						onclick={() =>
							commit('Reorder Layer', moveLayer(editorState, layer.id, 'forward'))}
						>Up</button>
					<button
						type="button"
						aria-label={`Move ${layer.name} backward`}
						disabled={visualIndex === layers.length - 1}
						onclick={() =>
							commit('Reorder Layer', moveLayer(editorState, layer.id, 'backward'))}
						>Down</button>
					<button
						type="button"
						aria-label={`Delete ${layer.name}`}
						disabled={layers.length === 1}
						onclick={() => {
							deletingLayerId = layer.id;
							deleteDestinationId =
								layers.find(
									(candidate) => candidate.id !== layer.id && !candidate.locked
								)?.id ?? null;
						}}>Delete</button>
				</div>
				<label>
					Opacity
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={layer.opacity}
						aria-label={`Opacity for ${layer.name}`}
						onchange={(event) =>
							commit(
								'Change Layer Opacity',
								patchLayer(editorState, layer.id, {
									opacity: event.currentTarget.valueAsNumber
								})
							)} />
				</label>
				{#if deletingLayerId === layer.id}
					<div
						class="delete-options"
						role="group"
						aria-label={`Delete options for ${layer.name}`}>
						{#if layer.shapeIds.length > 0}
							<select
								aria-label="Move contents destination"
								bind:value={deleteDestinationId}>
								{#each layers.filter((candidate) => candidate.id !== layer.id && !candidate.locked) as destination}
									<option value={destination.id}>{destination.name}</option>
								{/each}
							</select>
							<button
								type="button"
								onclick={() => {
									if (deleteDestinationId)
										commit(
											'Delete Layer and Move Contents',
											deleteLayer(editorState, layer.id, {
												kind: 'move',
												destinationLayerId: deleteDestinationId
											})
										);
									deletingLayerId = null;
								}}>Move contents and delete</button>
							<button
								type="button"
								onclick={() => {
									commit(
										'Delete Layer and Contents',
										deleteLayer(editorState, layer.id, { kind: 'delete' })
									);
									deletingLayerId = null;
								}}>Delete contents and layer</button>
						{:else}
							<button
								type="button"
								onclick={() => {
									commit('Delete Layer', deleteLayer(editorState, layer.id));
									deletingLayerId = null;
								}}>Confirm delete</button>
						{/if}
						<button type="button" onclick={() => (deletingLayerId = null)}
							>Cancel</button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</aside>

<style>
	.layer-panel {
		position: absolute;
		right: 0.75rem;
		top: 0.75rem;
		z-index: 3;
		width: min(19rem, calc(100% - 1.5rem));
		max-height: calc(100% - 1.5rem);
		overflow: auto;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
	}
	header,
	.layer-actions,
	label,
	.delete-options {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	header {
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 1rem;
	}
	ul {
		display: grid;
		gap: 0.5rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		gap: 0.4rem;
		padding: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 0.35rem;
	}
	li.active {
		border-color: var(--accent);
	}
	.layer-select {
		text-align: left;
		font-weight: 600;
	}
	.layer-actions {
		flex-wrap: wrap;
	}
	label input {
		flex: 1;
	}
	.delete-options {
		align-items: stretch;
		flex-direction: column;
		padding-top: 0.4rem;
		border-top: 1px solid var(--border);
	}
	button,
	input,
	select {
		min-height: 2rem;
	}
</style>
