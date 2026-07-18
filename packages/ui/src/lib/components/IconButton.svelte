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
		border-radius: var(--ink-radius-wobbly-small);
		color: var(--ink-text-muted);
		background: transparent;
		cursor: pointer;
	}

	.ink-icon-button:hover:not(:disabled),
	.ink-icon-button[data-selected] {
		border-color: var(--ink-border-strong);
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.ink-icon-button[data-selected] {
		box-shadow: 2px 2px 0 var(--ink-shadow-color);
	}

	.ink-icon-button:focus-visible {
		outline: 3px solid var(--ink-focus);
		outline-offset: 2px;
	}

	.ink-icon-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
