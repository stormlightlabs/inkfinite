<script module lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import type { IconName } from '../icons';

	/** Props for a compact icon-only action. */
	export interface IconButtonProps extends Omit<HTMLButtonAttributes, 'children'> {
		label: string;
		name: IconName;
		selected?: boolean;
	}
</script>

<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		class: className = '',
		disabled = false,
		label,
		name,
		selected = false,
		type = 'button',
		...rest
	}: IconButtonProps = $props();
</script>

<button
	{...rest}
	aria-label={label}
	aria-pressed={selected}
	class={['ink-icon-button', className]}
	data-selected={selected || undefined}
	{disabled}
	{type}>
	<Icon {name} size="1.2rem" />
</button>

<style>
	.ink-icon-button {
		display: inline-grid;
		width: var(--ink-control-height);
		height: var(--ink-control-height);
		place-items: center;
		border: var(--ink-line-width) solid transparent;
		border-radius: var(--ink-radius-control-small);
		color: var(--ink-text-muted);
		background: transparent;
		cursor: pointer;
		transition:
			color var(--ink-duration-fast) var(--ink-ease-out),
			background-color var(--ink-duration-fast) var(--ink-ease-out),
			border-color var(--ink-duration-fast) var(--ink-ease-out);
	}

	.ink-icon-button:hover:not(:disabled) {
		border-color: var(--ink-border);
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.ink-icon-button[data-selected] {
		border-color: var(--ink-accent);
		color: var(--ink-accent-text);
		background: color-mix(in srgb, var(--ink-accent) 14%, var(--ink-surface-raised));
	}

	.ink-icon-button:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.ink-icon-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
