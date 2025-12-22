<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Sheet (Drawer) component
	 *
	 * A sliding panel that appears from the side of the screen.
	 * Built on top of Dialog primitive with custom positioning.
	 */

	type Side = 'left' | 'right' | 'top' | 'bottom';

	type Props = {
		/** Whether the sheet is open */
		open: boolean;
		/** Callback when sheet should close */
		onClose?: () => void;
		/** Sheet title (for accessibility) */
		title?: string;
		/** Which side the sheet slides in from (default: 'right') */
		side?: Side;
		/** Whether clicking backdrop closes sheet (default: true) */
		closeOnBackdrop?: boolean;
		/** Whether escape key closes sheet (default: true) */
		closeOnEscape?: boolean;
		/** Custom class for the sheet content */
		class?: string;
		children?: Snippet;
	};

	let {
		open = $bindable(false),
		onClose,
		title,
		children,
		side = 'right',
		closeOnBackdrop = true,
		closeOnEscape = true,
		class: className = ''
	}: Props = $props();

	let sheetElement = $state<HTMLDivElement>();

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
		if (open && sheetElement) {
			sheetElement.focus();

			const previouslyFocused = document.activeElement as HTMLElement;

			return () => {
				previouslyFocused?.focus();
			};
		}
	});
</script>

{#if open}
	<div
		class="sheet__backdrop"
		role="presentation"
		onclick={handleBackdropClick}
		onkeydown={handleKeyDown}>
		<div
			bind:this={sheetElement}
			class="sheet sheet__content sheet__content--{side} sheet-{side} {className}"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1">
			{@render children?.()}
		</div>
	</div>
{/if}

<style>
	.sheet__backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		z-index: 1000;
		animation: fadeIn 0.15s ease-out;
	}

	.sheet__content {
		background-color: var(--surface);
		color: var(--text);
		box-shadow:
			0 10px 25px rgba(0, 0, 0, 0.1),
			0 4px 10px rgba(0, 0, 0, 0.08);
		overflow: auto;
		outline: none;
	}

	/* Right side (default) */
	.sheet__content--right {
		position: fixed;
		top: 0;
		right: 0;
		height: 100vh;
		width: min(400px, 80vw);
		animation: slideInRight 0.2s ease-out;
	}

	/* Left side */
	.sheet__content--left {
		position: fixed;
		top: 0;
		left: 0;
		height: 100vh;
		width: min(400px, 80vw);
		animation: slideInLeft 0.2s ease-out;
	}

	/* Top side */
	.sheet__content--top {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: min(400px, 80vh);
		animation: slideInTop 0.2s ease-out;
	}

	/* Bottom side */
	.sheet__content--bottom {
		position: fixed;
		bottom: 0;
		left: 0;
		width: 100vw;
		height: min(400px, 80vh);
		animation: slideInBottom 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideInRight {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	@keyframes slideInLeft {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(0);
		}
	}

	@keyframes slideInTop {
		from {
			transform: translateY(-100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes slideInBottom {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
</style>
