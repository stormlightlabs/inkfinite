<script lang="ts">
	import type { Snippet } from 'svelte';
	import DocsBreadcrumbs from './DocsBreadcrumbs.svelte';
	import DocsCopyCode from './DocsCopyCode.svelte';
	import DocsCopyMarkdown from './DocsCopyMarkdown.svelte';
	import DocsPageNavigation from './DocsPageNavigation.svelte';
	import DocsSeo from './DocsSeo.svelte';
	import DocsSidebar from './DocsSidebar.svelte';
	import SiteHeader from './SiteHeader.svelte';
	import DocsToc from './DocsToc.svelte';
	import { getAdjacentDocs } from './content';
	import type { Doc } from './content/types';

	let { doc, docs, content }: { doc: Doc; docs: Doc[]; content: Snippet } = $props();
	const adjacent = $derived(getAdjacentDocs(doc.slug));
</script>

<DocsSeo title={`${doc.title} · Inkfinite documentation`} description={doc.description} />

<div class="docs-site">
	<SiteHeader {docs} currentSlug={doc.slug} />

	<div class="docs-layout">
		<aside class="sidebar" aria-label="Documentation navigation">
			<DocsSidebar {docs} currentSlug={doc.slug} />
		</aside>

		<main id="main-content" class="docs-main">
			<DocsBreadcrumbs {doc} />
			<article class="doc-article" data-pagefind-body>
				<header class="doc-heading">
					<div class="doc-meta">
						<span>{doc.section}</span>
					</div>
					<h1>{doc.title}</h1>
					<div class="doc-meta-secondary">
						<DocsCopyMarkdown markdown={doc.markdown} slug={doc.slug} />
						<p class="doc-description">{doc.description}</p>
					</div>
				</header>
				<div class="doc-content">
					{@render content()}
				</div>
				{#key doc.slug}
					<DocsCopyCode />
				{/key}
			</article>
			<DocsPageNavigation previous={adjacent.previous} next={adjacent.next} />
		</main>

		<aside class="toc-column" aria-label="Table of contents">
			<DocsToc headings={doc.toc} />
		</aside>
	</div>
</div>

<style>
	.docs-site {
		min-height: 100svh;
		background: var(--docs-canvas);
		color: var(--docs-text);
	}

	.docs-layout {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr) 13rem;
		gap: clamp(2rem, 5vw, 5rem);
		max-width: 1440px;
		margin: 0 auto;
		padding: 2.75rem 2rem 5rem;
	}

	.sidebar,
	.toc-column {
		min-width: 0;
	}

	.docs-main {
		min-width: 0;
		max-width: 52rem;
	}

	.doc-heading {
		padding-bottom: 2rem;
		border-bottom: 1px solid var(--docs-border);
	}

	.doc-meta {
		display: flex;
		gap: 0.55rem;
		margin-bottom: 0.8rem;
		color: var(--docs-accent-text);
		font: 650 0.76rem / 1 var(--docs-font-mono);
		text-transform: uppercase;
	}

	.doc-meta-secondary {
		display: flex;
		gap: 1rem;
		align-items: center;
	}

	.doc-heading h1 {
		max-width: 20ch;
		margin: 0;
		color: var(--docs-heading);
		font-family: var(--docs-font-heading);
		font-size: clamp(2.4rem, 5vw, 4.5rem);
		font-weight: 650;
		letter-spacing: -0.04em;
		line-height: 1.02;
	}

	.doc-description {
		max-width: 42rem;
		margin: 1rem 0 0;
		color: var(--docs-text-muted);
		font-size: 1.12rem;
		line-height: 1.55;
	}

	.doc-meta-secondary :global(.copy-markdown) {
		margin-top: 1rem;
	}

	.doc-content {
		padding-top: 2rem;
	}

	.doc-content :global(h2),
	.doc-content :global(h3) {
		scroll-margin-top: 6.5rem;
	}

	@media (max-width: 1160px) {
		.docs-layout {
			grid-template-columns: 12rem minmax(0, 1fr);
			gap: 2.5rem;
		}

		.toc-column {
			display: none;
		}
	}

	@media (max-width: 900px) {
		.docs-layout {
			display: block;
			padding: 2rem 1.25rem 4rem;
		}

		.sidebar {
			display: none;
		}

		.docs-main {
			max-width: none;
		}
	}

	@media (max-width: 560px) {
		.doc-meta-secondary {
			align-items: flex-start;
			flex-direction: column;
			gap: 0.25rem;
		}
	}
</style>
