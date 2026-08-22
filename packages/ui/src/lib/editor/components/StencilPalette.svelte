<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { stencils } from '@inkfinite/core';
	import { Icon, Sheet } from '../../index';
	import { startDrag, endDrag, draggingStencil } from '../dnd.svelte';

	type Stencil = stencils.Stencil;
	const { registry, registerBuiltinStencils } = stencils;

	let {
		open = $bindable(false),
		onClose,
		onStencilClick
	}: {
		open: boolean;
		onClose: () => void;
		onStencilClick?: (stencil: Stencil) => void;
	} = $props();

	let categories = $state([] as string[]);
	let stencilsByCategory = $state({} as Record<string, Stencil[]>);
	let searchQuery = $state('');

	onMount(() => {
		registerBuiltinStencils();
		refreshStencils();
	});

	function refreshStencils() {
		const allStencils = registry.search(searchQuery);
		const grouped: Record<string, Stencil[]> = {};
		const cats = new SvelteSet<string>();

		for (const stencil of allStencils) {
			if (!grouped[stencil.category]) {
				grouped[stencil.category] = [];
				cats.add(stencil.category);
			}
			grouped[stencil.category].push(stencil);
		}

		categories = Array.from(cats).sort();
		stencilsByCategory = grouped;
	}

	function handleSearchInput(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		refreshStencils();
	}

	function onDragStart(e: DragEvent, stencil: Stencil) {
		console.log('[StencilPalette] Drag started for stencil:', stencil.id);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'copy';
			e.dataTransfer.setData('application/x-inkfinite-stencil', stencil.id);
		}
		startDrag(stencil);
	}

	function closePalette() {
		open = false;
		onClose?.();
	}
</script>

<Sheet
	bind:open
	onClose={closePalette}
	side="left"
	title="Stencils"
	class="stencil-palette-sheet"
	backdropClass={draggingStencil.current
		? 'pointer-events-none bg-transparent transition-none'
		: ''}>
	<div class="palette">
		<div class="palette__header">
			<div class="palette__title-row">
				<h2 class="palette__title">Components</h2>
				<button
					class="palette__close"
					type="button"
					onclick={closePalette}
					aria-label="Close stencil palette">
					<Icon name="close" size={20} color="var(--ink-danger)" />
				</button>
			</div>
		</div>

		<div class="palette__search">
			<div class="palette__search-wrapper">
				<div class="palette__search-icon">
					<Icon name="search" size={14} />
				</div>
				<input
					type="text"
					class="palette__search-input"
					placeholder="Filter components..."
					bind:value={searchQuery}
					oninput={handleSearchInput}
					aria-label="Filter components" />
			</div>
		</div>

		<div class="palette__content custom-scrollbar">
			<div class="palette__list">
				{#each categories as category (category)}
					<div class="palette__category">
						<h3 class="palette__category-title">
							<span class="palette__category-dot"></span>
							{category}
						</h3>
						<div class="palette__grid">
							{#each stencilsByCategory[category] as stencil (stencil.id)}
								<div
									role="button"
									tabindex="0"
									draggable="true"
									ondragstart={(e) => onDragStart(e, stencil)}
									ondragend={endDrag}
									onclick={() => onStencilClick?.(stencil)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											onStencilClick?.(stencil);
										}
									}}
									class="palette__item"
									title={stencil.name}>
									<div class="palette__item-preview">
										<div class="palette__item-preview-content">
											<!-- Built-in previews are source-controlled SVG strings. -->
											<!-- eslint-disable-next-line svelte/no-at-html-tags -->
											{@html stencil.preview.data}
										</div>
									</div>
									<span class="palette__item-name">
										{stencil.name}
									</span>

									<div class="palette__item-hover-ring"></div>
								</div>
							{/each}
						</div>
					</div>
				{/each}

				{#if categories.length === 0}
					<div class="palette__empty">
						<Icon name="search" size={24} color="var(--ink-text-muted)" />
						<span>No components found</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</Sheet>

<style>
	:global(.stencil-palette-sheet) {
		padding: 0;
		width: 18rem;
	}

	.palette {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--ink-canvas);
		color: var(--ink-text);
	}

	.palette__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--ink-space-4);
		border-bottom: var(--ink-line-width) solid var(--ink-border);
		background-color: var(--ink-canvas);
	}

	.palette__title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.palette__title {
		margin: 0;
		font-size: var(--ink-type-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-text-muted);
	}

	.palette__close {
		background: none;
		border: 1px solid transparent;
		cursor: pointer;
		padding: 0.25rem;
		border-radius: var(--ink-radius-control-small);
		display: flex;
		align-items: center;
	}

	.palette__close:hover {
		background-color: var(--ink-surface-hover);
	}

	.palette__search {
		padding: var(--ink-space-3) var(--ink-space-4);
		border-bottom: var(--ink-line-width) solid var(--ink-border);
		background-color: var(--ink-canvas);
	}

	.palette__search-wrapper {
		position: relative;
	}

	.palette__search-icon {
		position: absolute;
		left: 0.625rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		color: var(--ink-text-muted);
		display: flex;
	}

	.palette__search-input {
		width: 100%;
		padding: 0.375rem 0.75rem 0.375rem 2.25rem;
		font-size: var(--ink-type-sm);
		background-color: var(--ink-surface);
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		transition:
			border-color var(--ink-duration-fast) var(--ink-ease-out),
			background-color var(--ink-duration-fast) var(--ink-ease-out);
		box-sizing: border-box;
	}

	.palette__search-input:focus-visible {
		border-color: var(--ink-accent);
		background-color: var(--ink-canvas);
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.palette__content {
		flex: 1;
		overflow-y: auto;
	}

	.palette__list {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.palette__category {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.palette__category-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.625rem; /* ~10px */
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--ink-text-muted);
		padding-left: 0.25rem;
		margin: 0;
	}

	.palette__category-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background-color: var(--ink-border);
	}

	.palette__grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}

	.palette__item {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.5rem;
		background-color: var(--ink-canvas);
		border: 1px solid var(--ink-border);
		border-radius: var(--ink-radius-control);
		cursor: grab;
		user-select: none;
		transition:
			border-color var(--ink-duration-fast) var(--ink-ease-out),
			background-color var(--ink-duration-fast) var(--ink-ease-out),
			box-shadow var(--ink-duration-fast) var(--ink-ease-out);
	}

	.palette__item:hover,
	.palette__item:focus-visible {
		border-color: var(--ink-accent);
		box-shadow: var(--ink-shadow-control);
	}

	.palette__item:active {
		cursor: grabbing;
	}

	.palette__item-preview {
		width: 100%;
		aspect-ratio: 4/3;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.5rem;
		background-color: var(--ink-surface);
		border-radius: var(--ink-radius-control-small);
		overflow: hidden;
		transition: background-color 0.2s;
	}

	.palette__item:hover .palette__item-preview {
		background-color: var(--ink-surface-hover);
	}

	.palette__item-preview-content {
		transform: scale(0.75);
		transform-origin: center;
		pointer-events: none;
		color: var(--ink-text);
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.palette__item-preview-content :global(svg) {
		width: 100%;
		height: 100%;
	}

	.palette__item-name {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--ink-text-muted);
		width: 100%;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.2s;
	}

	.palette__item:hover .palette__item-name {
		color: var(--ink-accent);
	}

	.palette__item-hover-ring {
		position: absolute;
		inset: 0;
		border: var(--ink-line-width-strong) solid var(--ink-accent);
		border-radius: var(--ink-radius-control);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
	}

	.palette__item:hover .palette__item-hover-ring {
		opacity: 0.1;
	}

	.palette__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 0;
		color: var(--ink-text-muted);
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		opacity: 0.7;
	}

	/* Scrollbar styling to match Tailwind's scrollbar-thin */
	.custom-scrollbar::-webkit-scrollbar {
		width: 6px;
	}

	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}

	.custom-scrollbar::-webkit-scrollbar-thumb {
		background-color: var(--ink-border);
		border-radius: var(--ink-radius-control-small);
	}

	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background-color: var(--ink-text-muted);
	}
</style>
