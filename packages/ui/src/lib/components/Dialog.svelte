<script module lang="ts">
	import type { Snippet } from 'svelte';

	/** Props for the shared modal dialog surface. */
	export interface DialogProps {
		/** Whether the dialog is visible. */
		open: boolean;
		/** Called after the dialog requests to close. */
		onClose?: () => void;
		/** Accessible name announced for the dialog. */
		title?: string;
		/** Whether a backdrop click closes the dialog. */
		closeOnBackdrop?: boolean;
		/** Whether Escape closes the dialog. */
		closeOnEscape?: boolean;
		/** Class applied to the dialog surface. */
		class?: string;
		children?: Snippet;
	}
</script>

<script lang="ts">
	let {
		open = $bindable(false),
		onClose,
		title,
		children,
		closeOnBackdrop = true,
		closeOnEscape = true,
		class: className = ''
	}: DialogProps = $props();

	let dialogElement: HTMLDivElement | undefined = $state();

	function handleBackdropClick(event: MouseEvent) {
		if (closeOnBackdrop && event.target === event.currentTarget) {
			handleClose();
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (closeOnEscape && event.key === 'Escape') {
			event.preventDefault();
			handleClose();
		}
	}

	function handleClose() {
		open = false;
		onClose?.();
	}

	$effect(() => {
		if (open && dialogElement) {
			const previouslyFocused = document.activeElement as HTMLElement;
			dialogElement.focus();

			return () => {
				previouslyFocused?.focus();
			};
		}
	});
</script>

{#if open}
	<div
		class="dialog__backdrop"
		role="presentation"
		onclick={handleBackdropClick}
		onkeydown={handleKeyDown}>
		<div
			bind:this={dialogElement}
			class="dialog__content {className}"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1">
			{@render children?.()}
		</div>
	</div>
{/if}

<style>
	.dialog__backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background-color: color-mix(in srgb, var(--ink-shadow-color) 52%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 0.15s ease-out;
	}

	.dialog__content {
		background-color: var(--ink-surface-raised);
		color: var(--ink-text);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel);
		box-shadow: var(--ink-shadow-panel);
		max-width: 90vw;
		max-height: 90vh;
		overflow: auto;
		animation: slideIn 0.2s ease-out;
		outline: none;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideIn {
		from {
			transform: translateY(-20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
