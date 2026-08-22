<script module lang="ts">
	import type { CommandPaletteEntry as PaletteEntry } from '../commands';

	/** Props for the searchable editor command palette. */
	export type CommandPaletteProps = {
		commands: readonly PaletteEntry[];
		onSelect: (id: string) => void;
		open: boolean;
	};
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import Dialog from '../../components/Dialog.svelte';
	import type { CommandPaletteEntry } from '../commands';

	let { commands, onSelect, open = $bindable(false) }: CommandPaletteProps = $props();
	let query = $state('');
	let activeIndex = $state(0);
	let searchInput = $state<HTMLInputElement | null>(null);
	let filtered = $derived(
		commands.filter((command) =>
			`${command.group} ${command.label} ${command.shortcut ?? ''} ${command.keywords ?? ''}`
				.toLowerCase()
				.includes(query.trim().toLowerCase())
		)
	);

	$effect(() => {
		if (!open) {
			query = '';
			activeIndex = 0;
			return;
		}
		void tick().then(() => searchInput?.focus());
	});

	function choose(command: CommandPaletteEntry | undefined) {
		if (!command || command.disabled) return;
		onSelect(command.id);
		open = false;
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (filtered.length === 0) return;
			const direction = event.key === 'ArrowDown' ? 1 : -1;
			activeIndex = (activeIndex + direction + filtered.length) % filtered.length;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			choose(filtered[activeIndex]);
		}
	}
</script>

<Dialog bind:open title="Command palette" class="command-palette-dialog">
	<section class="command-palette" aria-labelledby="command-palette-title">
		<header class="command-palette__header">
			<div>
				<p class="command-palette__eyebrow">Editor actions</p>
				<h2 id="command-palette-title">Command palette</h2>
			</div>
			<button
				type="button"
				class="command-palette__close"
				onclick={() => (open = false)}
				aria-label="Close command palette">×</button>
		</header>
		<label class="command-palette__search">
			<span>Search commands</span>
			<input
				bind:this={searchInput}
				bind:value={query}
				oninput={() => (activeIndex = 0)}
				onkeydown={handleKeyDown}
				type="search"
				placeholder="Try “align” or “zoom”"
				aria-controls="command-palette-list" />
		</label>
		{#if filtered.length > 0}
			<ul
				id="command-palette-list"
				class="command-palette__list"
				role="listbox"
				aria-label="Commands">
				{#each filtered as command, index (command.id)}
					<li>
						<button
							type="button"
							class:command-palette__item--active={index === activeIndex}
							class="command-palette__item"
							role="option"
							aria-selected={index === activeIndex}
							disabled={command.disabled}
							onmouseenter={() => (activeIndex = index)}
							onclick={() => choose(command)}>
							<span>
								<small>{command.group}</small>
								{command.label}
							</span>
							{#if command.shortcut}<kbd>{command.shortcut}</kbd>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="command-palette__empty">No commands match “{query}”.</p>
		{/if}
		<p class="command-palette__hint">Use ↑ ↓ to navigate · Enter to run</p>
	</section>
</Dialog>

<style>
	:global(.dialog__content.command-palette-dialog) {
		width: min(38rem, calc(100vw - 2rem));
	}

	.command-palette {
		padding: var(--ink-space-6);
	}

	.command-palette__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--ink-space-4);
	}

	.command-palette__eyebrow {
		margin: 0 0 var(--ink-space-1);
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.command-palette h2 {
		margin: 0;
		font: 700 var(--ink-type-xl) / 1.15 var(--ink-font-display);
	}

	.command-palette__close {
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text-muted);
		background: transparent;
		font-size: 1.5rem;
		cursor: pointer;
	}

	.command-palette__close:hover {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.command-palette__close:focus-visible,
	.command-palette__search input:focus-visible,
	.command-palette__item:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.command-palette__search {
		display: grid;
		gap: var(--ink-space-2);
		margin-top: var(--ink-space-5);
		color: var(--ink-text-muted);
		font: 650 var(--ink-type-sm) / 1.2 var(--ink-font-body);
	}

	.command-palette__search input {
		min-height: 2.75rem;
		padding: 0 var(--ink-space-3);
		border: 1px solid var(--ink-border-strong);
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: var(--ink-canvas);
		font: 500 var(--ink-type-sm) / 1 var(--ink-font-body);
	}

	.command-palette__list {
		display: grid;
		gap: 2px;
		max-height: min(28rem, 52vh);
		margin: var(--ink-space-4) 0 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}

	.command-palette__item {
		display: flex;
		width: 100%;
		min-height: 2.75rem;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-4);
		padding: var(--ink-space-2) var(--ink-space-3);
		border: 0;
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text);
		background: color-mix(in srgb, var(--ink-canvas) 68%, transparent);
		font: 600 var(--ink-type-sm) / 1.2 var(--ink-font-body);
		text-align: left;
		cursor: pointer;
	}

	.command-palette__item:hover:not(:disabled),
	.command-palette__item--active:not(:disabled) {
		background: var(--ink-surface-hover);
	}

	.command-palette__item:disabled {
		opacity: 0.42;
		cursor: not-allowed;
	}

	.command-palette__item span {
		display: grid;
		gap: 2px;
	}

	.command-palette__item small {
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
	}

	.command-palette kbd {
		color: var(--ink-text-muted);
		font: 600 var(--ink-type-xs) / 1.2 var(--ink-font-body);
		text-align: right;
	}

	.command-palette__empty {
		margin: var(--ink-space-5) 0 0;
		color: var(--ink-text-muted);
	}

	.command-palette__hint {
		margin: var(--ink-space-4) 0 0;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
	}

	@media (pointer: coarse) {
		.command-palette__item {
			min-height: 3rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.command-palette__close {
			transition: none;
		}
	}
</style>
