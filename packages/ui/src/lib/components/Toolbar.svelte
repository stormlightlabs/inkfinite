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
</script>

<div
	{...rest}
	aria-label={label}
	aria-orientation={orientation}
	class={['ink-toolbar', className]}
	data-orientation={orientation}
	role="toolbar">
	{@render children()}
</div>

<style>
	.ink-toolbar {
		display: flex;
		width: fit-content;
		align-items: center;
		gap: var(--ink-space-1);
		padding: var(--ink-space-2);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-surface-raised) 92%, transparent);
		box-shadow: var(--ink-shadow-toolbar);
		backdrop-filter: blur(12px);
	}

	.ink-toolbar[data-orientation='vertical'] {
		flex-direction: column;
	}
</style>
