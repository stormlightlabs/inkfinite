<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		/** Whether the dialog is open */
		open: boolean;
		/** Callback when dialog should close */
		onClose?: () => void;
		/** Dialog title (for accessibility) */
		title?: string;
		/** Whether clicking backdrop closes dialog (default: true) */
		closeOnBackdrop?: boolean;
		/** Whether escape key closes dialog (default: true) */
		closeOnEscape?: boolean;
		/** Custom class for the dialog content */
		class?: string;
		children?: Snippet;
	};

	let {
		open = $bindable(false),
		onClose,
		title,
		children,
		closeOnBackdrop = true,
		closeOnEscape = true,
		class: className = ''
	}: Props = $props();

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
			dialogElement.focus();

			const previouslyFocused = document.activeElement as HTMLElement;

			return () => {
				previouslyFocused?.focus();
			};
		}
	});
</script>

{#if open}
	<div class="dialog__backdrop" role="presentation" onclick={handleBackdropClick} onkeydown={handleKeyDown}>
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
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 0.15s ease-out;
	}

	.dialog__content {
		background-color: var(--surface);
		color: var(--text);
		border-radius: 8px;
		box-shadow:
			0 10px 25px rgba(0, 0, 0, 0.1),
			0 4px 10px rgba(0, 0, 0, 0.08);
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
