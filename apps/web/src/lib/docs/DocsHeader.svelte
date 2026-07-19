<script lang="ts">
	import { resolve } from '$app/paths';
	import favicon from '$editor/assets/favicon.svg';
	import { Icon } from '$ui';
	import { themeStore } from '@inkfinite/ui/editor';

	import DocsSearch from './DocsSearch.svelte';

	type Props = { sidebarOpen: boolean; toggleSidebar: () => void };
	let { sidebarOpen, toggleSidebar }: Props = $props();
</script>

<header class="docs-header">
	<div class="brand-cluster">
		<button
			class="mobile-menu"
			type="button"
			aria-controls="docs-sidebar"
			aria-expanded={sidebarOpen}
			aria-label="Toggle documentation navigation"
			onclick={toggleSidebar}>
			<Icon name={sidebarOpen ? 'close' : 'menu'} size={20} />
		</button>
		<a class="brand" href={resolve('/docs/')}>
			<img src={favicon} alt="" />
			<span>Inkfinite</span>
		</a>
		<span class="section-label">Docs</span>
	</div>

	<div class="header-actions">
		<DocsSearch />
		<a
			class="icon-link"
			href="https://github.com/stormlightlabs/inkfinite"
			aria-label="Inkfinite on GitHub">
			<Icon name="github" size={20} />
		</a>
		<button
			class="theme-toggle"
			type="button"
			aria-label="Toggle color theme"
			onclick={() => themeStore.toggle()}>
			<span class:visible={themeStore.current === 'dark'}>
				<Icon name="sun" size={19} />
			</span>
			<span class:visible={themeStore.current === 'light'}>
				<Icon name="moon" size={19} />
			</span>
		</button>
	</div>
</header>

<style>
	.docs-header {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-4);
		height: 4rem;
		padding: 0 clamp(1rem, 2.5vw, 2rem);
		background: color-mix(in srgb, var(--ink-surface-raised) 91%, transparent);
		box-shadow: 0 1px 0 color-mix(in srgb, var(--ink-border) 34%, transparent);
		backdrop-filter: blur(14px);
	}

	.brand-cluster,
	.header-actions,
	.brand {
		display: flex;
		align-items: center;
	}

	.brand-cluster {
		gap: var(--ink-space-3);
	}

	.header-actions {
		gap: var(--ink-space-2);
	}

	.brand {
		gap: var(--ink-space-2);
		min-height: 40px;
		color: var(--ink-text);
		font-family: var(--ink-font-display);
		font-size: 1.15rem;
		font-weight: 650;
		text-decoration: none;
	}

	.brand img {
		width: 1.75rem;
		height: 1.75rem;
	}

	.section-label {
		padding-left: var(--ink-space-3);
		color: var(--ink-text-muted);
		border-left: 1px solid color-mix(in srgb, var(--ink-border) 50%, transparent);
		font-size: var(--ink-type-sm);
		font-weight: 600;
	}

	.icon-link,
	.theme-toggle,
	.mobile-menu {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		padding: 0;
		color: var(--ink-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--ink-radius-wobbly-small);
		cursor: pointer;
		transition-property: color, background-color, scale;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.icon-link:hover,
	.theme-toggle:hover,
	.mobile-menu:hover {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.icon-link:active,
	.theme-toggle:active,
	.mobile-menu:active {
		scale: 0.96;
	}

	.theme-toggle {
		position: relative;
	}

	.theme-toggle span {
		position: absolute;
		display: grid;
		place-items: center;
		opacity: 0;
		filter: blur(4px);
		scale: 0.25;
		transition-property: opacity, filter, scale;
		transition-duration: 180ms;
		transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
	}

	.theme-toggle span.visible {
		opacity: 1;
		filter: blur(0);
		scale: 1;
	}

	.mobile-menu {
		display: none;
	}

	@media (max-width: 960px) {
		.mobile-menu {
			display: grid;
		}
	}

	@media (max-width: 540px) {
		.section-label,
		.icon-link {
			display: none;
		}

		.docs-header {
			padding-inline: var(--ink-space-2);
		}
	}
</style>
