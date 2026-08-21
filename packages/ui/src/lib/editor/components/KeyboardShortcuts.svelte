<script lang="ts">
	import { tick } from 'svelte';
	import Dialog from '../../components/Dialog.svelte';
	import { KEYBOARD_SHORTCUTS } from '../constants';

	let { open = $bindable(false) }: { open: boolean } = $props();
	let query = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	let filtered = $derived(
		KEYBOARD_SHORTCUTS.filter((shortcut) =>
			`${shortcut.group} ${shortcut.label} ${shortcut.keys}`
				.toLowerCase()
				.includes(query.trim().toLowerCase())
		)
	);

	$effect(() => {
		if (!open) {
			query = '';
			return;
		}
		void tick().then(() => searchInput?.focus());
	});
</script>

<Dialog bind:open title="Keyboard shortcuts" class="keyboard-shortcuts-dialog">
	<section class="shortcuts" aria-labelledby="shortcuts-title">
		<header class="shortcuts__header">
			<div>
				<p class="shortcuts__eyebrow">Editor commands</p>
				<h2 id="shortcuts-title">Keyboard shortcuts</h2>
			</div>
			<button
				type="button"
				class="shortcuts__close"
				onclick={() => (open = false)}
				aria-label="Close shortcuts">
				×
			</button>
		</header>
		<label class="shortcuts__search">
			<span>Search shortcuts</span>
			<input
				bind:this={searchInput}
				bind:value={query}
				type="search"
				placeholder="Try “group” or “zoom”" />
		</label>
		{#if filtered.length > 0}
			<ul class="shortcuts__list">
				{#each filtered as shortcut (shortcut.label)}
					<li>
						<span>
							<small>{shortcut.group}</small>
							{shortcut.label}
						</span>
						<kbd>{shortcut.keys}</kbd>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="shortcuts__empty">No shortcuts match “{query}”.</p>
		{/if}
	</section>
</Dialog>

<style>
	:global(.dialog__content.keyboard-shortcuts-dialog) {
		width: min(38rem, calc(100vw - 2rem));
	}

	.shortcuts {
		padding: var(--ink-space-6);
	}

	.shortcuts__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--ink-space-4);
	}

	.shortcuts__eyebrow {
		margin: 0 0 var(--ink-space-1);
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.shortcuts h2 {
		margin: 0;
		font: 700 var(--ink-type-xl) / 1.15 var(--ink-font-display);
	}

	.shortcuts__close {
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: var(--ink-radius-wobbly-small);
		color: var(--ink-text-muted);
		background: transparent;
		font-size: 1.5rem;
		cursor: pointer;
	}

	.shortcuts__close:hover {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.shortcuts__close:focus-visible,
	.shortcuts__search input:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.shortcuts__search {
		display: grid;
		gap: var(--ink-space-2);
		margin-top: var(--ink-space-5);
		color: var(--ink-text-muted);
		font: 650 var(--ink-type-sm) / 1.2 var(--ink-font-body);
	}

	.shortcuts__search input {
		min-height: 2.75rem;
		padding: 0 var(--ink-space-3);
		border: 1px solid var(--ink-border-strong);
		border-radius: var(--ink-radius-wobbly-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 500 var(--ink-type-sm) / 1 var(--ink-font-body);
	}

	.shortcuts__list {
		display: grid;
		gap: 2px;
		max-height: min(26rem, 52vh);
		margin: var(--ink-space-4) 0 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}

	.shortcuts__list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-4);
		min-height: 2.75rem;
		padding: var(--ink-space-2) var(--ink-space-3);
		border-radius: var(--ink-radius-wobbly-small);
		background: color-mix(in srgb, var(--ink-canvas) 68%, transparent);
	}

	.shortcuts__list li span {
		display: grid;
		gap: 2px;
	}

	.shortcuts__list small {
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
	}

	.shortcuts kbd {
		color: var(--ink-text-muted);
		font: 600 var(--ink-type-xs) / 1.2 var(--ink-font-body);
		text-align: right;
	}

	.shortcuts__empty {
		margin: var(--ink-space-5) 0 0;
		color: var(--ink-text-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.shortcuts__close {
			transition: none;
		}
	}
</style>
