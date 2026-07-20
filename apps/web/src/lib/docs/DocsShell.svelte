<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import DocsHeader from './DocsHeader.svelte';
	import DocsSidebar from './DocsSidebar.svelte';
	import DocsToc from './DocsToc.svelte';

	let { children }: { children: Snippet } = $props();
	let sidebarOpen = $state(false);
	let landing = $derived(page.url.pathname === '/docs' || page.url.pathname === '/docs/');
</script>

<div class="docs-shell">
	<a class="skip-link" href="#docs-content">Skip to content</a>
	<DocsHeader {sidebarOpen} toggleSidebar={() => (sidebarOpen = !sidebarOpen)} />

	{#if sidebarOpen}
		<button
			class="sidebar-scrim"
			type="button"
			aria-label="Close navigation"
			onclick={() => (sidebarOpen = false)}></button>
	{/if}

	<div class="docs-grid" class:landing>
		{#if !landing}
			<DocsSidebar open={sidebarOpen} close={() => (sidebarOpen = false)} />
		{/if}
		<main id="docs-content">
			<article data-pagefind-body>
				{@render children()}
			</article>
		</main>
		{#if !landing}
			<DocsToc />
		{/if}
	</div>
</div>

<style>
	.docs-shell {
		min-height: 100svh;
		background: var(--ink-canvas);
	}

	.skip-link {
		position: fixed;
		inset: var(--ink-space-2) auto auto var(--ink-space-2);
		z-index: 50;
		padding: var(--ink-space-2) var(--ink-space-3);
		translate: 0 -150%;
		color: var(--ink-on-accent);
		background: var(--ink-accent);
		border-radius: var(--ink-radius-wobbly-small);
		font-weight: 650;
	}

	.skip-link:focus {
		translate: 0;
	}

	.docs-grid {
		display: grid;
		grid-template-columns: minmax(14rem, 17rem) minmax(0, 1fr) minmax(11rem, 14rem);
	}

	.docs-grid.landing {
		display: block;
	}

	main {
		min-width: 0;
		padding: var(--ink-space-6) clamp(1rem, 2.5vw, 2rem) var(--ink-space-6) var(--ink-space-4);
	}

	article {
		max-width: 48rem;
		margin-inline: auto;
	}

	.landing main {
		padding: 0;
	}

	.landing article {
		max-width: none;
	}

	.sidebar-scrim {
		position: fixed;
		inset: 4rem 0 0;
		z-index: 7;
		width: 100%;
		height: calc(100% - 4rem);
		padding: 0;
		background: color-mix(in srgb, var(--ink-canvas) 44%, transparent);
		border: 0;
		backdrop-filter: blur(2px);
	}

	@media (max-width: 1180px) {
		.docs-grid {
			grid-template-columns: minmax(14rem, 17rem) minmax(0, 1fr);
		}
	}

	@media (max-width: 960px) {
		.docs-grid {
			display: block;
		}

		main {
			padding-inline: clamp(1.25rem, 7vw, 4rem);
		}
	}
</style>
