<script module lang="ts">
	import type { IconName } from '../icons';

	/** One actionable row in a context menu. */
	export type ContextMenuItem = {
		checked?: boolean;
		danger?: boolean;
		disabled?: boolean;
		icon?: IconName;
		id: string;
		label: string;
		shortcut?: string;
		type?: 'item';
	};

	/** A visual and semantic separator between related menu commands. */
	export type ContextMenuSeparator = { id?: string; type: 'separator' };

	/** Entries accepted by the shared context-menu primitive. */
	export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

	/** Props for the pointer-anchored shared context menu. */
	export type ContextMenuProps = {
		items: ContextMenuEntry[];
		label?: string;
		onOpenChange: (open: boolean) => void;
		onSelect: (id: string) => void;
		open: boolean;
		returnFocus?: HTMLElement | null;
		x: number;
		y: number;
	};
</script>

<script lang="ts">
	import { tick } from 'svelte';

	import Icon from './Icon.svelte';

	let {
		items,
		label = 'Context menu',
		onOpenChange,
		onSelect,
		open,
		returnFocus = null,
		x,
		y
	}: ContextMenuProps = $props();

	let menuEl = $state<HTMLDivElement | null>(null);
	let left = $state(0);
	let top = $state(0);
	let positioned = $state(false);

	$effect(() => {
		if (!open || typeof document === 'undefined') return;

		left = x;
		top = y;
		positioned = false;
		let cancelled = false;

		void tick().then(async () => {
			if (cancelled || !menuEl) return;
			const gutter = 8;
			const bounds = menuEl.getBoundingClientRect();
			left = Math.max(gutter, Math.min(x, window.innerWidth - bounds.width - gutter));
			top = Math.max(gutter, Math.min(y, window.innerHeight - bounds.height - gutter));
			positioned = true;
			await tick();
			if (cancelled) return;
			menuButtons()[0]?.focus();
		});

		function handlePointerDown(event: PointerEvent) {
			const target = event.target as Node | null;
			if (target && !menuEl?.contains(target)) onOpenChange(false);
		}

		document.addEventListener('pointerdown', handlePointerDown);
		return () => {
			cancelled = true;
			document.removeEventListener('pointerdown', handlePointerDown);
		};
	});

	function menuButtons(): HTMLButtonElement[] {
		return menuEl
			? Array.from(
					menuEl.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')
				)
			: [];
	}

	function close(restoreFocus = false) {
		onOpenChange(false);
		if (restoreFocus) returnFocus?.focus();
	}

	function select(item: ContextMenuItem) {
		if (item.disabled) return;
		onSelect(item.id);
		close(true);
	}

	function handleKeyDown(event: KeyboardEvent) {
		const buttons = menuButtons();
		if (buttons.length === 0) return;
		const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);

		if (event.key === 'Escape') {
			event.preventDefault();
			close(true);
			return;
		}

		if (event.key === 'Tab') {
			close();
			return;
		}

		let nextIndex: number | null = null;
		if (event.key === 'ArrowDown')
			nextIndex = activeIndex < buttons.length - 1 ? activeIndex + 1 : 0;
		if (event.key === 'ArrowUp')
			nextIndex = activeIndex > 0 ? activeIndex - 1 : buttons.length - 1;
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = buttons.length - 1;
		if (nextIndex === null) return;
		event.preventDefault();
		buttons[nextIndex]?.focus();
	}
</script>

{#if open}
	<div
		bind:this={menuEl}
		class="ink-context-menu"
		role="menu"
		tabindex="-1"
		aria-label={label}
		onkeydown={handleKeyDown}
		style:left="{left}px"
		style:top="{top}px"
		style:visibility={positioned ? 'visible' : 'hidden'}>
		{#each items as entry, index (entry.id ?? `separator-${index}`)}
			{#if entry.type === 'separator'}
				<div class="ink-context-menu__separator" role="separator"></div>
			{:else}
				<button
					type="button"
					class="ink-context-menu__item"
					class:ink-context-menu__item--danger={entry.danger}
					role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
					aria-checked={entry.checked}
					disabled={entry.disabled}
					onclick={() => select(entry)}>
					<span class="ink-context-menu__icon" aria-hidden="true">
						{#if entry.checked !== undefined}
							<Icon
								name="check"
								size="1rem"
								class={entry.checked ? '' : 'ink-context-menu__check--hidden'} />
						{:else if entry.icon}
							<Icon name={entry.icon} size="1rem" />
						{/if}
					</span>
					<span class="ink-context-menu__label">{entry.label}</span>
					{#if entry.shortcut}<kbd>{entry.shortcut}</kbd>{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.ink-context-menu {
		position: fixed;
		z-index: 1000;
		display: grid;
		min-width: 13rem;
		max-width: min(20rem, calc(100vw - 1rem));
		padding: var(--ink-space-1);
		border-radius: var(--ink-radius-panel-small);
		color: var(--ink-text);
		background: color-mix(in srgb, var(--ink-surface-raised) 96%, transparent);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 72%, transparent),
			var(--ink-shadow-popover);
		backdrop-filter: blur(16px);
	}

	.ink-context-menu__item {
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr) auto;
		min-height: 2.75rem;
		align-items: center;
		gap: var(--ink-space-2);
		padding: 0 var(--ink-space-2);
		border: 0;
		border-radius: var(--ink-radius-control-small);
		color: inherit;
		background: transparent;
		font: 600 var(--ink-type-sm) / 1.2 var(--ink-font-body);
		text-align: left;
		cursor: pointer;
		transition-property: color, background-color, scale;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.ink-context-menu__item:hover:not(:disabled),
	.ink-context-menu__item:focus-visible {
		outline: 0;
		background: var(--ink-surface-hover);
	}

	.ink-context-menu__item:focus-visible {
		box-shadow: inset 0 0 0 2px var(--ink-focus);
	}

	.ink-context-menu__item:active:not(:disabled) {
		scale: 0.96;
	}

	.ink-context-menu__item:disabled {
		opacity: 0.42;
		cursor: not-allowed;
	}

	.ink-context-menu__item--danger:not(:disabled) {
		color: var(--ink-danger);
	}

	.ink-context-menu__icon {
		display: grid;
		place-items: center;
		color: var(--ink-text-muted);
	}

	.ink-context-menu__item--danger .ink-context-menu__icon {
		color: currentColor;
	}

	:global(.ink-context-menu__check--hidden) {
		opacity: 0;
	}

	.ink-context-menu__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	kbd {
		color: var(--ink-text-muted);
		font: 500 var(--ink-type-xs) / 1 var(--ink-font-body);
		font-variant-numeric: tabular-nums;
	}

	.ink-context-menu__separator {
		height: 1px;
		margin: var(--ink-space-1) var(--ink-space-2);
		background: color-mix(in srgb, var(--ink-border) 60%, transparent);
	}

	@media (pointer: coarse) {
		.ink-context-menu__item {
			min-height: 3rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ink-context-menu__item {
			transition: none;
		}
	}
</style>
