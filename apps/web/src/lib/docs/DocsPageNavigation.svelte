<script lang="ts">
	import { resolve } from '$app/paths';
	import { Icon } from '$ui';
	import type { Doc } from './content/types';

	let { previous, next }: { previous?: Doc; next?: Doc } = $props();

	function resolveDocsPath(path: string): string {
		return (resolve as (route: string) => string)(path);
	}
</script>

<nav class="page-navigation" aria-label="Page navigation" data-pagefind-ignore>
	{#if previous}
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a class="page-nav-link previous" href={resolveDocsPath(`/docs/${previous.slug}/`)}>
			<span>Previous</span>
			<strong><Icon name="chevron-left" size={16} />{previous.title}</strong>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{:else}<span></span>{/if}
	{#if next}
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a class="page-nav-link next" href={resolveDocsPath(`/docs/${next.slug}/`)}>
			<span>Next</span>
			<strong>{next.title}<Icon name="arrow-right" size={16} /></strong>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
</nav>

<style>
	.page-navigation {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-top: 4rem;
		padding-top: 1rem;
		border-top: 1px solid var(--docs-border);
	}

	.page-nav-link {
		display: grid;
		gap: 0.25rem;
		padding: 0.9rem;
		border: 1px solid var(--docs-border);
		background: var(--docs-surface-raised);
		text-decoration: none;
	}

	.page-nav-link:hover {
		border-color: var(--docs-accent);
		box-shadow: 0.25rem 0.25rem 0 var(--docs-accent);
	}

	.page-nav-link > span {
		color: var(--docs-text-muted);
		font: 650 var(--docs-type-xs) / 1 var(--docs-font-mono);
		text-transform: uppercase;
	}

	.page-nav-link strong {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--docs-accent-text);
		font-family: var(--docs-font-heading);
		font-size: 1.05rem;
	}

	.page-nav-link.next {
		text-align: right;
	}

	.page-nav-link.next strong {
		justify-content: flex-end;
	}

	@media (max-width: 520px) {
		.page-navigation {
			grid-template-columns: 1fr;
		}

		.page-nav-link.next {
			text-align: left;
		}

		.page-nav-link.next strong {
			justify-content: flex-start;
		}
	}
</style>
