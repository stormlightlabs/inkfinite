<script module lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Props for a grouped set of editor controls. */
	export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children: Snippet;
		label: string;
		orientation?: 'horizontal' | 'vertical';
	}
</script>

<script lang="ts">
	let {
		children,
		class: className = '',
		label,
		orientation = 'horizontal',
		...rest
	}: ToolbarProps = $props();

	let viewport: HTMLDivElement | undefined = $state();
	let canMoveBack = $state(false);
	let canMoveForward = $state(false);

	function updateOverflowState() {
		if (!viewport || orientation !== 'horizontal') return;
		canMoveBack = viewport.scrollLeft > 1;
		canMoveForward = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1;
	}

	function shift(direction: -1 | 1) {
		viewport?.scrollBy({
			left: direction * Math.max(160, viewport.clientWidth * 0.75),
			behavior: 'smooth'
		});
	}

	$effect(() => {
		if (!viewport || orientation !== 'horizontal') return;
		const observer = new ResizeObserver(updateOverflowState);
		observer.observe(viewport);
		for (const child of viewport.children) observer.observe(child);
		updateOverflowState();
		return () => observer.disconnect();
	});
</script>

<div
	{...rest}
	aria-label={label}
	aria-orientation={orientation}
	class={['ink-toolbar', className]}
	data-orientation={orientation}
	role="toolbar">
	{#if orientation === 'horizontal'}
		<button
			class="ink-toolbar__arrow"
			aria-label={`Show previous ${label.toLowerCase()}`}
			disabled={!canMoveBack}
			onclick={() => shift(-1)}>‹</button>
	{/if}
	<div bind:this={viewport} class="ink-toolbar__viewport" onscroll={updateOverflowState}>
		{@render children()}
	</div>
	{#if orientation === 'horizontal'}
		<button
			class="ink-toolbar__arrow"
			aria-label={`Show more ${label.toLowerCase()}`}
			disabled={!canMoveForward}
			onclick={() => shift(1)}>›</button>
	{/if}
</div>

<style>
	.ink-toolbar {
		display: flex;
		width: fit-content;
		max-width: min(32rem, calc(100vw - 2rem));
		align-items: center;
		padding: var(--ink-space-1);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-surface-raised) 92%, transparent);
		box-shadow: var(--ink-shadow-toolbar);
		backdrop-filter: blur(12px);
	}

	.ink-toolbar__viewport {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: var(--ink-space-1);
		overflow: hidden;
		scrollbar-width: none;
	}

	.ink-toolbar__viewport::-webkit-scrollbar {
		display: none;
	}

	.ink-toolbar__arrow {
		flex: 0 0 auto;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 0;
		border-radius: var(--ink-radius-control-small);
		background: transparent;
		color: var(--ink-text);
		font: 700 1.25rem/1 var(--ink-font-body);
		cursor: pointer;
	}

	.ink-toolbar__arrow:hover:not(:disabled) {
		background: var(--ink-surface-hover);
	}
	.ink-toolbar__arrow:focus-visible {
		outline: 2px solid var(--ink-accent);
		outline-offset: 1px;
	}
	.ink-toolbar__arrow:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.ink-toolbar[data-orientation='vertical'] {
		max-width: none;
	}

	.ink-toolbar[data-orientation='vertical'] .ink-toolbar__viewport {
		flex-direction: column;
	}
</style>
