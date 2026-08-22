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

	function portal(node: HTMLElement) {
		const styles = getComputedStyle(node);
		for (const property of styles) {
			if (property.startsWith('--ink-'))
				node.style.setProperty(property, styles.getPropertyValue(property));
		}
		document.body.append(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function handleBackdropClick(event: MouseEvent) {
		if (closeOnBackdrop && event.target === event.currentTarget) {
			handleClose();
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (closeOnEscape && event.key === 'Escape') {
			event.preventDefault();
			handleClose();
			return;
		}
		if (event.key !== 'Tab' || !dialogElement) return;
		const focusable = Array.from(
			dialogElement.querySelectorAll<HTMLElement>(
				'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
			)
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable.at(-1);
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
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
		use:portal
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
		animation: fadeIn var(--ink-duration-overlay) var(--ink-ease-out);
	}

	.dialog__content {
		background-color: var(--ink-surface-raised);
		color: var(--ink-text);
		border: var(--ink-line-width) solid var(--ink-border);
		border-radius: var(--ink-dialog-radius, var(--ink-radius-panel));
		box-shadow: var(--ink-shadow-popover);
		max-width: 90vw;
		max-height: 90vh;
		overflow: auto;
		animation: slideIn var(--ink-duration-overlay) var(--ink-ease-out);
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

	@media (prefers-reduced-motion: reduce) {
		.dialog__backdrop,
		.dialog__content {
			animation: none;
		}
	}
</style>
