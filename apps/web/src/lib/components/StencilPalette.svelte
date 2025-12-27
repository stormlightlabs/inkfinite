<script lang="ts">
	import { onMount } from 'svelte';
	import { stencils } from 'inkfinite-core';
	import { startDrag, endDrag, draggingStencil } from '../dnd.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import Icon from '$lib/components/Icon.svelte';

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
		const cats = new Set<string>();

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
					<Icon name="close" size={20} color="#e27878" />
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
				{#each categories as category}
					<div class="palette__category">
						<h3 class="palette__category-title">
							<span class="palette__category-dot"></span>
							{category}
						</h3>
						<div class="palette__grid">
							{#each stencilsByCategory[category] as stencil}
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
						<Icon name="search" size={24} color="var(--text-muted, #6c757d)" />
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
		width: 288px; /* w-72 */
	}

	.palette {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--surface, #ffffff);
		color: var(--text, #333333);
	}

	.palette__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
		background-color: var(--surface, #ffffff);
	}

	.palette__title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.palette__title {
		margin: 0;
		font-size: 0.75rem; /* text-xs */
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary, #666);
	}

	.palette__close {
		background: none;
		border: 1px solid transparent;
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 0.25rem;
		display: flex;
		align-items: center;
	}

	.palette__close:hover {
		background-color: var(--surface-hover, #f5f5f5);
	}

	.palette__search {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border, #e0e0e0);
		background-color: var(--surface, #ffffff);
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
		color: var(--text-muted, #9ca3af);
		display: flex;
	}

	.palette__search-input {
		width: 100%;
		padding: 0.375rem 0.75rem 0.375rem 2.25rem;
		font-size: 0.875rem;
		background-color: var(--surface-secondary, #f9f9f9);
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 0.375rem;
		color: var(--text, #333);
		transition: all 0.2s;
		box-sizing: border-box;
	}

	.palette__search-input:focus {
		outline: none;
		border-color: var(--primary, #007bff);
		background-color: var(--surface, #ffffff);
		box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.1);
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
		color: var(--text-muted, #9ca3af);
		padding-left: 0.25rem;
		margin: 0;
	}

	.palette__category-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background-color: var(--border-dark, #cbd5e1);
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
		background-color: var(--surface, #ffffff);
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 0.5rem;
		cursor: grab;
		user-select: none;
		transition: all 0.2s;
	}

	.palette__item:hover {
		border-color: var(--primary-light, #60a5fa);
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
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
		background-color: var(--surface-secondary, #f9f9f9);
		border-radius: 0.25rem;
		overflow: hidden;
		transition: background-color 0.2s;
	}

	.palette__item:hover .palette__item-preview {
		background-color: var(--surface-hover, #f0f9ff);
	}

	.palette__item-preview-content {
		transform: scale(0.75);
		transform-origin: center;
		pointer-events: none;
		color: var(--text, #333);
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
		color: var(--text-secondary, #4b5563);
		width: 100%;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.2s;
	}

	.palette__item:hover .palette__item-name {
		color: var(--primary, #007bff);
	}

	.palette__item-hover-ring {
		position: absolute;
		inset: 0;
		border: 2px solid var(--primary, #007bff);
		border-radius: 0.5rem;
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
		color: var(--text-muted, #9ca3af);
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
		background-color: var(--border, #e0e0e0);
		border-radius: 3px;
	}

	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background-color: var(--text-muted, #9ca3af);
	}
</style>
