<script lang="ts">
	import { resolve } from '$app/paths';
	import { getDocs } from '$lib/docs/content';
	import '$lib/docs/docs.css';
	import DocsSeo from '$lib/docs/DocsSeo.svelte';
	import SiteHeader from '$lib/docs/SiteHeader.svelte';

	const docs = getDocs();
</script>

<DocsSeo
	title="Search · Inkfinite documentation"
	description="Search the Inkfinite documentation." />

<div class="docs-site">
	<SiteHeader {docs} />
	<main id="main-content" class="fallback-page" data-pagefind-ignore>
		<div class="fallback-inner">
			<p class="eyebrow">Inkfinite documentation</p>
			<h1>Search</h1>
			<p>
				Search uses the local Pagefind index in the production build. Use the documentation
				navigation to browse these static pages when JavaScript is disabled.
			</p>
			<a class="primary-action" href={resolve('/docs/quickstart/')}>
				Start with getting started
			</a>
		</div>
	</main>
</div>

<style>
	.fallback-page {
		min-height: calc(100svh - 4.5rem);
		padding: 2rem 1.5rem;
		background: var(--docs-canvas);
		color: var(--docs-text);
	}

	.fallback-inner {
		max-width: 44rem;
		margin: clamp(5rem, 12vw, 9rem) auto;
	}

	.eyebrow {
		margin: 0 0 1rem;
		color: var(--docs-accent-text);
		font: 650 var(--docs-type-xs) / 1 var(--docs-font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0 0 1rem;
		color: var(--docs-heading);
		font-family: var(--docs-font-heading);
		font-size: clamp(3rem, 8vw, 5rem);
		letter-spacing: -0.04em;
		line-height: 1;
	}

	.fallback-inner > p:not(.eyebrow) {
		max-width: 38rem;
		margin: 0 0 1.75rem;
		color: var(--docs-text-muted);
		font-size: 1.05rem;
		line-height: 1.65;
	}

	.primary-action {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0.7rem 1rem;
		border-radius: var(--docs-radius-wobbly);
		background: var(--docs-accent);
		box-shadow: 3px 4px 0 var(--docs-shadow-color);
		color: var(--docs-on-accent);
		font-size: var(--docs-type-sm);
		font-weight: 700;
		text-decoration: none;
	}

	.primary-action:hover {
		background: var(--docs-accent-hover);
		color: var(--docs-on-accent);
	}
</style>
