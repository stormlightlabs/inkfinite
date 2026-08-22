<script module lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import type { IconName } from '../icons';

	/** Visual emphasis levels supported by the shared button. */
	export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

	/** Props for an Inkfinite text button. */
	export interface ButtonProps extends Omit<HTMLButtonAttributes, 'children'> {
		busy?: boolean;
		children?: Snippet;
		icon?: IconName;
		label?: string;
		size?: 'small' | 'medium';
		variant?: ButtonVariant;
	}
</script>

<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		busy = false,
		children,
		class: className = '',
		disabled = false,
		icon,
		label,
		size = 'medium',
		type = 'button',
		variant = 'secondary',
		...rest
	}: ButtonProps = $props();
</script>

<button
	{...rest}
	aria-busy={busy}
	class={['ink-button', className]}
	data-size={size}
	data-variant={variant}
	disabled={disabled || busy}
	{type}>
	{#if icon}<Icon name={icon} size="1.1em" />{/if}
	<span class="ink-button__label">
		{#if children}{@render children()}{:else}{label}{/if}
	</span>
</button>

<style>
	.ink-button {
		display: inline-flex;
		min-height: var(--ink-control-height);
		align-items: center;
		justify-content: center;
		gap: var(--ink-space-2);
		padding-inline: var(--ink-space-4);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-control);
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		box-shadow: var(--ink-shadow-control);
		font: 650 var(--ink-type-sm) / 1 var(--ink-font-body);
		letter-spacing: 0.01em;
		cursor: pointer;
		transition:
			transform var(--ink-duration-fast) var(--ink-ease-out),
			background-color var(--ink-duration-fast) var(--ink-ease-out);
	}

	.ink-button:hover:not(:disabled) {
		background: var(--ink-surface-hover);
		transform: translateY(-1px);
	}

	.ink-button:active:not(:disabled) {
		transform: scale(0.98);
	}

	.ink-button:focus-visible {
		outline: var(--ink-line-width-strong) solid var(--ink-focus);
		outline-offset: 2px;
	}

	.ink-button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.ink-button[data-size='small'] {
		min-height: var(--ink-control-height-sm);
		padding-inline: var(--ink-space-3);
		font-size: var(--ink-type-xs);
	}

	.ink-button[data-variant='primary'] {
		color: var(--ink-on-accent);
		background: var(--ink-accent);
	}

	.ink-button[data-variant='primary']:hover:not(:disabled) {
		background: var(--ink-accent-hover);
	}

	.ink-button[data-variant='ghost'] {
		border-color: transparent;
		background: transparent;
		box-shadow: none;
	}

	.ink-button[data-variant='ghost']:focus-visible {
		outline-offset: 0;
	}

	.ink-button[data-variant='ghost']:hover:not(:disabled) {
		transform: none;
		box-shadow: none;
	}

	.ink-button[data-variant='danger'] {
		color: var(--ink-on-danger);
		background: var(--ink-danger);
	}

	.ink-button__label {
		translate: 0 0.04em;
	}
</style>
