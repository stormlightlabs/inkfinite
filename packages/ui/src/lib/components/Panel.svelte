<script module lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Props for a raised sketchbook panel. */
	export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
		actions?: Snippet;
		children?: Snippet;
		description?: string;
		eyebrow?: string;
		heading: string;
	}
</script>

<script lang="ts">
	let {
		actions,
		children,
		class: className = '',
		description,
		eyebrow,
		heading,
		...rest
	}: PanelProps = $props();
</script>

<section {...rest} class={['ink-panel', className]}>
	<header class="ink-panel__header">
		<div class="ink-panel__copy">
			{#if eyebrow}<p class="ink-panel__eyebrow">{eyebrow}</p>{/if}
			<h2 class="ink-panel__heading">{heading}</h2>
			{#if description}<p class="ink-panel__description">
					{description}
				</p>{/if}
		</div>
		{#if actions}<div class="ink-panel__actions">
				{@render actions()}
			</div>{/if}
	</header>
	{#if children}<div class="ink-panel__body">{@render children()}</div>{/if}
</section>

<style>
	.ink-panel {
		display: grid;
		gap: var(--ink-space-5);
		min-width: min(100%, 18rem);
		padding: var(--ink-space-5);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel);
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		box-shadow: var(--ink-shadow-panel);
	}

	.ink-panel__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--ink-space-4);
	}

	.ink-panel__copy {
		display: grid;
		gap: var(--ink-space-1);
	}

	.ink-panel__eyebrow,
	.ink-panel__description {
		margin: 0;
	}

	.ink-panel__eyebrow {
		color: var(--ink-accent-text);
		font: 700 var(--ink-type-xs) / 1.25 var(--ink-font-body);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.ink-panel__heading {
		margin: 0;
		color: var(--ink-heading);
		font: 650 var(--ink-type-lg) / 1.2 var(--ink-font-display);
		letter-spacing: -0.025em;
	}

	.ink-panel__description {
		max-width: 46ch;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-sm);
	}

	.ink-panel__actions {
		display: flex;
		gap: var(--ink-space-2);
	}

	.ink-panel__body {
		min-width: 0;
	}
</style>
