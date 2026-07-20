<script lang="ts">
	import {
		activateLayer,
		createLayer,
		deleteLayer,
		getLayersOnCurrentPage,
		isWritableLayer,
		moveLayer,
		patchLayer,
		type EditorState,
		type LayerRecord,
		type Store
	} from '@inkfinite/core';
	import { onMount, tick } from 'svelte';

	import { Button, ContextMenu, Icon, IconButton, type ContextMenuEntry } from '../../index';

	let {
		store,
		onCommit
	}: { store: Store; onCommit: (name: string, next: EditorState) => void } = $props();

	// svelte-ignore state_referenced_locally
	let editorState: EditorState = $state(store.getState());
	let collapsed = $state(false);
	let renamingLayerId = $state<string | null>(null);
	let renameInputEl = $state<HTMLInputElement | null>(null);
	let deletingLayerId = $state<string | null>(null);
	let deleteDestinationId = $state<string | null>(null);
	let menuLayerId = $state<string | null>(null);
	let menuOpen = $state(false);
	let menuPoint = $state({ x: 0, y: 0 });
	let menuTrigger = $state<HTMLElement | null>(null);
	let layers = $derived(getLayersOnCurrentPage(editorState));
	let activeLayer = $derived(
		layers.find((layer) => layer.id === editorState.ui.activeLayerId) ?? null
	);
	let deletingLayer = $derived(layers.find((layer) => layer.id === deletingLayerId) ?? null);
	let menuLayer = $derived(layers.find((layer) => layer.id === menuLayerId) ?? null);
	let menuItems = $derived.by<ContextMenuEntry[]>(() => {
		if (!menuLayer) return [];
		const layerIndex = layers.findIndex((layer) => layer.id === menuLayer.id);
		return [
			{ id: 'rename', label: 'Rename layer' },
			{ id: 'visible', label: 'Visible', checked: menuLayer.visible, icon: 'eye' },
			{ id: 'locked', label: 'Locked', checked: menuLayer.locked, icon: 'lock' },
			{ type: 'separator' },
			{
				id: 'forward',
				label: 'Bring layer forward',
				icon: 'arrow-up',
				disabled: layerIndex === layers.length - 1
			},
			{
				id: 'backward',
				label: 'Send layer backward',
				icon: 'arrow-down',
				disabled: layerIndex === 0
			},
			{ type: 'separator' },
			{
				id: 'delete',
				label: 'Delete layer',
				icon: 'delete',
				danger: true,
				disabled: layers.length === 1
			}
		];
	});

	onMount(() => store.subscribe((next) => (editorState = next)));

	$effect(() => {
		if (!renamingLayerId) return;
		void tick().then(() => {
			renameInputEl?.focus();
			renameInputEl?.select();
		});
	});

	function commit(name: string, next: EditorState) {
		if (next !== editorState) onCommit(name, next);
	}

	function selectLayer(layer: LayerRecord) {
		commit('Select Layer', activateLayer(editorState, layer.id));
	}

	function beginRename(layerId: string) {
		renamingLayerId = layerId;
	}

	function finishRename(layer: LayerRecord, value: string) {
		commit('Rename Layer', patchLayer(editorState, layer.id, { name: value }));
		renamingLayerId = null;
	}

	function openMenu(layer: LayerRecord, event: MouseEvent | PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		menuLayerId = layer.id;
		menuTrigger = event.currentTarget as HTMLElement;
		if (event.type === 'contextmenu') {
			menuPoint = { x: event.clientX, y: event.clientY };
		} else {
			const bounds = menuTrigger.getBoundingClientRect();
			menuPoint = { x: bounds.right - 4, y: bounds.bottom + 4 };
		}
		menuOpen = true;
	}

	function beginDelete(layer: LayerRecord) {
		deletingLayerId = layer.id;
		deleteDestinationId = nearestWritableDestination(layer.id)?.id ?? null;
	}

	function nearestWritableDestination(sourceId: string): LayerRecord | null {
		const sourceIndex = layers.findIndex((layer) => layer.id === sourceId);
		return (
			[...layers]
				.filter((layer) => layer.id !== sourceId && isWritableLayer(layer))
				.sort(
					(a, b) =>
						Math.abs(layers.findIndex((layer) => layer.id === a.id) - sourceIndex) -
						Math.abs(layers.findIndex((layer) => layer.id === b.id) - sourceIndex)
				)[0] ?? null
		);
	}

	function handleMenuAction(id: string) {
		const layer = menuLayer;
		if (!layer) return;
		switch (id) {
			case 'rename':
				beginRename(layer.id);
				break;
			case 'visible':
				commit(
					layer.visible ? 'Hide Layer' : 'Show Layer',
					patchLayer(editorState, layer.id, { visible: !layer.visible })
				);
				break;
			case 'locked':
				commit(
					layer.locked ? 'Unlock Layer' : 'Lock Layer',
					patchLayer(editorState, layer.id, { locked: !layer.locked })
				);
				break;
			case 'forward':
				commit('Reorder Layer', moveLayer(editorState, layer.id, 'forward'));
				break;
			case 'backward':
				commit('Reorder Layer', moveLayer(editorState, layer.id, 'backward'));
				break;
			case 'delete':
				beginDelete(layer);
				break;
		}
	}
</script>

<aside class="layer-panel" class:layer-panel--collapsed={collapsed} aria-label="Layers">
	<header class="layer-panel__header">
		<div class="layer-panel__title">
			{#if !collapsed}<Icon name="layers" size="1rem" />{/if}
			<h2>Layers</h2>
		</div>
		<div class="layer-panel__header-actions">
			{#if !collapsed}
				<IconButton
					label="Add layer"
					name="add"
					onclick={() => commit('Create Layer', createLayer(editorState))} />
			{/if}
			<IconButton
				label={collapsed ? 'Expand layers' : 'Collapse layers'}
				name={collapsed ? 'chevron-left' : 'chevron-right'}
				onclick={() => (collapsed = !collapsed)} />
		</div>
	</header>

	{#if !collapsed}
		<ul class="layer-panel__list" aria-label="Page layers">
			{#each [...layers].reverse() as layer (layer.id)}
				<li
					class="layer-panel__item"
					class:layer-panel__item--active={editorState.ui.activeLayerId === layer.id}
					class:layer-panel__item--muted={!layer.visible}
					oncontextmenu={(event) => openMenu(layer, event)}>
					<div class="layer-panel__row">
						<span class="layer-panel__glyph" aria-hidden="true">
							<Icon name="layers" size="0.9rem" />
						</span>
						{#if renamingLayerId === layer.id}
							<input
								bind:this={renameInputEl}
								class="layer-panel__rename"
								aria-label={`Name for ${layer.name}`}
								value={layer.name}
								onblur={(event) => finishRename(layer, event.currentTarget.value)}
								onkeydown={(event) => {
									if (event.key === 'Enter') event.currentTarget.blur();
									if (event.key === 'Escape') {
										renamingLayerId = null;
										event.preventDefault();
									}
								}} />
						{:else}
							<button
								type="button"
								class="layer-panel__name"
								aria-pressed={editorState.ui.activeLayerId === layer.id}
								aria-disabled={!isWritableLayer(layer)}
								onclick={() => selectLayer(layer)}
								ondblclick={() => beginRename(layer.id)}>
								<span>{layer.name}</span>
								<small>{layer.shapeIds.length}</small>
							</button>
						{/if}
						<div class="layer-panel__actions">
							<IconButton
								label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
								name={layer.visible ? 'eye' : 'eye-off'}
								selected={!layer.visible}
								onclick={() =>
									commit(
										layer.visible ? 'Hide Layer' : 'Show Layer',
										patchLayer(editorState, layer.id, {
											visible: !layer.visible
										})
									)} />
							<IconButton
								label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}
								name={layer.locked ? 'lock' : 'lock-open'}
								selected={layer.locked}
								onclick={() =>
									commit(
										layer.locked ? 'Unlock Layer' : 'Lock Layer',
										patchLayer(editorState, layer.id, {
											locked: !layer.locked
										})
									)} />
							<IconButton
								label={`More actions for ${layer.name}`}
								name="dots-vertical"
								onclick={(event) => openMenu(layer, event)} />
						</div>
					</div>
				</li>
			{/each}
		</ul>

		{#if activeLayer}
			<div class="layer-panel__details">
				<div class="layer-panel__details-copy">
					<span>Layer opacity</span>
					<output>{Math.round(activeLayer.opacity * 100)}%</output>
				</div>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={activeLayer.opacity}
					aria-label={`Opacity for ${activeLayer.name}`}
					onchange={(event) =>
						commit(
							'Change Layer Opacity',
							patchLayer(editorState, activeLayer.id, {
								opacity: event.currentTarget.valueAsNumber
							})
						)} />
			</div>
		{/if}

		{#if deletingLayer}
			<div
				class="layer-panel__delete"
				role="group"
				aria-label={`Delete ${deletingLayer.name}`}>
				<div>
					<strong>Delete “{deletingLayer.name}”?</strong>
					<p>
						{deletingLayer.shapeIds.length === 0
							? 'This layer is empty.'
							: `It contains ${deletingLayer.shapeIds.length} ${deletingLayer.shapeIds.length === 1 ? 'shape' : 'shapes'}.`}
					</p>
				</div>
				{#if deletingLayer.shapeIds.length > 0 && deleteDestinationId}
					<label>
						Move shapes to
						<select
							aria-label="Move contents destination"
							bind:value={deleteDestinationId}>
							{#each layers.filter((candidate) => candidate.id !== deletingLayer.id && isWritableLayer(candidate)) as destination}
								<option value={destination.id}>{destination.name}</option>
							{/each}
						</select>
					</label>
					<Button
						label="Move shapes and delete"
						size="small"
						onclick={() => {
							if (deleteDestinationId)
								commit(
									'Delete Layer and Move Contents',
									deleteLayer(editorState, deletingLayer.id, {
										kind: 'move',
										destinationLayerId: deleteDestinationId
									})
								);
							deletingLayerId = null;
						}} />
				{/if}
				<Button
					label={deletingLayer.shapeIds.length === 0
						? 'Delete layer'
						: 'Delete layer and shapes'}
					variant="danger"
					size="small"
					onclick={() => {
						commit(
							deletingLayer.shapeIds.length === 0
								? 'Delete Layer'
								: 'Delete Layer and Contents',
							deleteLayer(
								editorState,
								deletingLayer.id,
								deletingLayer.shapeIds.length > 0 ? { kind: 'delete' } : undefined
							)
						);
						deletingLayerId = null;
					}} />
				<Button
					label="Cancel"
					variant="ghost"
					size="small"
					onclick={() => (deletingLayerId = null)} />
			</div>
		{/if}
	{/if}
</aside>

<ContextMenu
	items={menuItems}
	label={menuLayer ? `Actions for ${menuLayer.name}` : 'Layer actions'}
	open={menuOpen}
	returnFocus={menuTrigger}
	x={menuPoint.x}
	y={menuPoint.y}
	onOpenChange={(value) => (menuOpen = value)}
	onSelect={handleMenuAction} />

<style>
	.layer-panel {
		position: absolute;
		right: var(--ink-space-3, 0.75rem);
		bottom: var(--ink-space-3, 0.75rem);
		z-index: 30;
		display: grid;
		width: min(19rem, calc(100% - 1.5rem));
		max-height: calc(100% - 1.5rem);
		overflow: auto;
		border-radius: var(--ink-radius-panel);
		color: var(--ink-text);
		background: color-mix(in srgb, var(--ink-surface-raised) 94%, transparent);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 65%, transparent),
			0 12px 30px color-mix(in srgb, var(--ink-shadow-color) 24%, transparent),
			0 2px 7px color-mix(in srgb, var(--ink-shadow-color) 18%, transparent);
		backdrop-filter: blur(14px);
		transition-property: width, box-shadow;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.layer-panel--collapsed {
		width: 7.5rem;
	}

	.layer-panel__header {
		display: flex;
		min-height: 3.25rem;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-2);
		padding: var(--ink-space-2);
		border-bottom: 1px solid color-mix(in srgb, var(--ink-border) 55%, transparent);
	}

	.layer-panel__title,
	.layer-panel__header-actions,
	.layer-panel__actions,
	.layer-panel__details-copy {
		display: flex;
		align-items: center;
	}

	.layer-panel__title {
		gap: var(--ink-space-2);
		min-width: 0;
		padding-inline-start: var(--ink-space-1);
		color: var(--ink-heading);
	}

	.layer-panel__title h2 {
		margin: 0;
		font: 650 var(--ink-type-base) / 1 var(--ink-font-display);
		letter-spacing: -0.02em;
	}

	.layer-panel__header-actions {
		gap: 2px;
	}

	.layer-panel__list {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: var(--ink-space-2);
		list-style: none;
	}

	.layer-panel__item {
		border-radius: calc(var(--ink-radius-panel-small) - 2px);
		transition-property: background-color, box-shadow, opacity;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.layer-panel__item:hover {
		background: color-mix(in srgb, var(--ink-surface-hover) 72%, transparent);
	}

	.layer-panel__item--active {
		background: color-mix(in srgb, var(--ink-accent) 14%, transparent);
		box-shadow: inset 3px 0 0 var(--ink-accent);
	}

	.layer-panel__item--muted {
		opacity: 0.58;
	}

	.layer-panel__row {
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr) auto;
		min-height: 2.75rem;
		align-items: center;
		padding: 2px var(--ink-space-1);
	}

	.layer-panel__glyph {
		display: grid;
		place-items: center;
		color: var(--ink-text-muted);
		opacity: 0.42;
	}

	.layer-panel__name {
		display: flex;
		min-width: 0;
		min-height: 2.5rem;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-2);
		padding: 0 var(--ink-space-2);
		border: 0;
		color: var(--ink-text);
		background: transparent;
		font: 600 var(--ink-type-sm) / 1.2 var(--ink-font-body);
		text-align: left;
		cursor: pointer;
	}

	.layer-panel__name[aria-disabled='true'] {
		cursor: default;
	}

	.layer-panel__name span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.layer-panel__name small {
		color: var(--ink-text-muted);
		font: 500 var(--ink-type-xs) / 1 var(--ink-font-body);
		font-variant-numeric: tabular-nums;
	}

	.layer-panel__name:focus-visible,
	.layer-panel__rename:focus-visible,
	select:focus-visible,
	input[type='range']:focus-visible {
		border-radius: var(--ink-radius-wobbly-small);
		outline: 3px solid var(--ink-focus);
		outline-offset: 1px;
	}

	.layer-panel__rename {
		width: 100%;
		min-width: 0;
		height: 2rem;
		padding: 0 var(--ink-space-2);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-wobbly-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 600 var(--ink-type-sm) / 1 var(--ink-font-body);
	}

	.layer-panel__actions {
		gap: 0;
	}

	.layer-panel__actions :global(.ink-icon-button) {
		width: 2.5rem;
		height: 2.5rem;
	}

	.layer-panel__details,
	.layer-panel__delete {
		margin: 0 var(--ink-space-2) var(--ink-space-2);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-canvas) 78%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink-border) 48%, transparent);
	}

	.layer-panel__details {
		display: grid;
		gap: var(--ink-space-2);
		padding: var(--ink-space-3);
	}

	.layer-panel__details-copy {
		justify-content: space-between;
		gap: var(--ink-space-3);
		font: 600 var(--ink-type-xs) / 1 var(--ink-font-body);
	}

	.layer-panel__details-copy output {
		color: var(--ink-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.layer-panel__details input {
		width: 100%;
		accent-color: var(--ink-accent);
	}

	.layer-panel__delete {
		display: grid;
		gap: var(--ink-space-2);
		padding: var(--ink-space-3);
	}

	.layer-panel__delete strong {
		font: 650 var(--ink-type-sm) / 1.2 var(--ink-font-body);
	}

	.layer-panel__delete p,
	.layer-panel__delete label {
		margin: var(--ink-space-1) 0 0;
		color: var(--ink-text-muted);
		font: 500 var(--ink-type-xs) / 1.4 var(--ink-font-body);
	}

	.layer-panel__delete label {
		display: grid;
		gap: var(--ink-space-1);
	}

	.layer-panel__delete select {
		min-height: var(--ink-control-height-sm);
		padding-inline: var(--ink-space-2);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-wobbly-small);
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		font: 600 var(--ink-type-xs) / 1 var(--ink-font-body);
	}

	@media (max-width: 720px) {
		.layer-panel {
			top: 4.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.layer-panel,
		.layer-panel__item {
			transition-duration: 0.01ms;
		}
	}
</style>
