<script lang="ts">
	import { resolve } from '$app/paths';
	import { docSections, type Doc } from './content/types';

	let { docs, currentSlug }: { docs: Doc[]; currentSlug: string } = $props();

	function resolveDocsPath(path: string): string {
		return (resolve as (route: string) => string)(path);
	}
</script>

<div class="sidebar-inner">
	<p class="sidebar-kicker">Documentation</p>
	{#each docSections as section (section)}
		<section class="sidebar-section" aria-labelledby={`sidebar-${section}`}>
			<h2 id={`sidebar-${section}`}>{section}</h2>
			<nav aria-label={`${section} pages`}>
				{#each docs.filter((doc) => doc.section === section) as doc (doc.slug)}
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						class:active={doc.slug === currentSlug}
						href={resolveDocsPath(`/docs/${doc.slug}/`)}
						aria-current={doc.slug === currentSlug ? 'page' : undefined}>
						{doc.title}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</nav>
		</section>
	{/each}
</div>

<style>
	.sidebar-inner {
		position: sticky;
		top: 6.75rem;
		max-height: calc(100vh - 8rem);
		overflow-y: auto;
		padding-right: 0.5rem;
	}

	.sidebar-kicker,
	.sidebar-section h2 {
		font-family: var(--docs-font-mono);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.sidebar-kicker {
		margin: 0 0 0.85rem;
		color: var(--docs-accent-text);
		font-size: var(--docs-type-xs);
		font-weight: 650;
	}

	.sidebar-section {
		margin-top: 1.7rem;
	}

	.sidebar-section h2 {
		margin: 0 0 0.4rem;
		color: var(--docs-heading);
		font-family: var(--docs-font-heading);
		font-size: 0.72rem;
		font-weight: 650;
	}

	.sidebar-section nav {
		display: grid;
		gap: 0.1rem;
	}

	.sidebar-section a {
		padding: 0.38rem 0.55rem;
		border-left: 2px solid transparent;
		color: var(--docs-text-muted);
		font-size: 0.86rem;
		line-height: 1.35;
		text-decoration: none;
	}

	.sidebar-section a:hover,
	.sidebar-section a.active {
		border-left-color: var(--docs-accent);
		background: var(--docs-surface);
		color: var(--docs-accent-text);
	}
</style>
