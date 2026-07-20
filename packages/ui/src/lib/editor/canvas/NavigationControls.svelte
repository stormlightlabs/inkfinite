<script lang="ts">
	import type { Store } from '@inkfinite/core';
	import { Icon } from '../../index';
	import { ZOOM_PRESETS } from '../constants';
	import type { CameraController } from './controllers/camera-controller';

	let { camera, store }: { camera: CameraController; store: Store } = $props();
	let zoomPercent = $state(100);
	let zoomMenuOpen = $state(false);
	let zoomButtonEl = $state<HTMLButtonElement | null>(null);
	let zoomMenuEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		zoomPercent = camera.getZoomPercent();
		return store.subscribe(() => {
			zoomPercent = camera.getZoomPercent();
		});
	});

	$effect(() => {
		if (!zoomMenuOpen || typeof document === 'undefined') return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target || zoomButtonEl?.contains(target) || zoomMenuEl?.contains(target)) return;
			zoomMenuOpen = false;
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			zoomMenuOpen = false;
			zoomButtonEl?.focus();
		};

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	});

	function setZoomPercent(percent: number) {
		camera.setZoomPercent(percent);
		zoomMenuOpen = false;
	}

	function fitAll() {
		camera.fitAll();
		zoomMenuOpen = false;
	}

	function fitSelection() {
		camera.fitSelection();
		zoomMenuOpen = false;
	}
</script>

<nav class="navigation-controls" aria-label="Canvas navigation">
	<button
		type="button"
		onclick={() => camera.zoomOut()}
		aria-label="Zoom out"
		title="Zoom out (−)">
		<Icon name="line" size={18} />
	</button>
	<button
		type="button"
		class="navigation-controls__zoom"
		bind:this={zoomButtonEl}
		onclick={() => (zoomMenuOpen = !zoomMenuOpen)}
		aria-label="Zoom level"
		aria-haspopup="true"
		aria-expanded={zoomMenuOpen}
		title="Zoom options">{zoomPercent}%</button>
	<button type="button" onclick={() => camera.zoomIn()} aria-label="Zoom in" title="Zoom in (+)">
		<Icon name="add" size={18} />
	</button>
	<span class="navigation-controls__divider" aria-hidden="true"></span>
	<button
		type="button"
		class="navigation-controls__fit"
		onclick={() => camera.fitAll()}
		aria-label="Fit drawing"
		title="Fit drawing (Shift+1)">Fit</button>
	{#if zoomMenuOpen}
		<div
			class="navigation-controls__menu"
			bind:this={zoomMenuEl}
			role="menu"
			aria-label="Zoom options">
			{#each ZOOM_PRESETS as preset (`${preset.label}:${preset.value}`)}
				<button
					type="button"
					role="menuitem"
					onclick={() => setZoomPercent(preset.value)}
					aria-label="Zoom to {preset.label}">{preset.label}</button>
			{/each}
			<span class="navigation-controls__menu-divider" role="separator"></span>
			<button type="button" role="menuitem" onclick={fitAll}>Zoom to fit</button>
			<button type="button" role="menuitem" onclick={fitSelection}>Zoom to selection</button>
		</div>
	{/if}
</nav>

<style>
	.navigation-controls {
		position: absolute;
		left: var(--ink-space-4);
		bottom: var(--ink-space-4);
		z-index: 4;
		display: flex;
		align-items: center;
		padding: var(--ink-space-1);
		border-radius: var(--ink-radius-panel-small);
		background: var(--ink-surface-raised);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 58%, transparent),
			var(--ink-shadow-toolbar);
	}

	.navigation-controls button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--ink-control-height);
		height: var(--ink-control-height);
		padding: 0 var(--ink-space-2);
		border: 0;
		border-radius: var(--ink-radius-wobbly-small);
		background: transparent;
		color: var(--ink-text);
		cursor: pointer;
		font: inherit;
		font-size: var(--ink-type-xs);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		transition-property: background-color, color, transform;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.navigation-controls button:hover {
		background: var(--ink-surface-hover);
	}

	.navigation-controls button:active {
		transform: scale(0.96);
	}

	.navigation-controls button:focus-visible {
		outline: 2px solid var(--ink-focus);
		outline-offset: 1px;
	}

	.navigation-controls__zoom {
		min-width: 3.5rem !important;
	}

	.navigation-controls__fit {
		min-width: 2.75rem !important;
	}

	.navigation-controls__divider {
		width: 1px;
		height: 1.5rem;
		margin-inline: var(--ink-space-1);
		background: color-mix(in srgb, var(--ink-border) 58%, transparent);
	}

	.navigation-controls__menu {
		position: absolute;
		left: var(--ink-space-1);
		bottom: calc(100% + var(--ink-space-2));
		display: grid;
		gap: var(--ink-space-1);
		min-width: 10rem;
		padding: var(--ink-space-1);
		border-radius: var(--ink-radius-panel-small);
		background: var(--ink-surface-raised);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--ink-border) 58%, transparent),
			var(--ink-shadow-toolbar);
	}

	.navigation-controls__menu button {
		justify-content: flex-start;
		width: 100%;
		min-width: 0;
		padding-inline: var(--ink-space-3);
		font-weight: 600;
		text-align: left;
	}

	.navigation-controls__menu-divider {
		height: 1px;
		margin-inline: var(--ink-space-2);
		background: color-mix(in srgb, var(--ink-border) 58%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.navigation-controls button {
			transition: none;
		}
	}
</style>
