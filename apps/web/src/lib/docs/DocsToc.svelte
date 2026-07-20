<script lang="ts">
	// TODO: active section styling, smooth scrolling
	import { afterNavigate } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	type Heading = { id: string; title: string };

	let headings = $state<Heading[]>([]);

	async function refreshHeadings() {
		await tick();
		headings = Array.from(
			document.querySelectorAll<HTMLElement>('#docs-content article h2[id]')
		).map((heading) => ({ id: heading.id, title: heading.textContent?.trim() || heading.id }));
	}

	onMount(() => void refreshHeadings());
	afterNavigate(() => void refreshHeadings());
</script>

{#if headings.length > 0}
	<aside aria-label="On this page">
		<h2>On this page</h2>
		<ul>
			{#each headings as heading (heading.id)}
				<li><a href={`#${heading.id}`}>{heading.title}</a></li>
			{/each}
		</ul>
	</aside>
{/if}

<style>
	aside {
		position: sticky;
		top: 4rem;
		max-height: calc(100svh - 4rem);
		overflow-y: auto;
		padding: var(--ink-space-6) clamp(1rem, 2.5vw, 2rem) var(--ink-space-6) var(--ink-space-4);
	}

	h2 {
		margin: 0 0 var(--ink-space-3);
		color: var(--ink-text);
		font-family: var(--ink-font-body);
		font-size: var(--ink-type-sm);
	}

	ul {
		display: grid;
		gap: var(--ink-space-2);
		margin: 0;
		padding: 0 0 0 var(--ink-space-3);
		border-left: 1px solid color-mix(in srgb, var(--ink-border) 38%, transparent);
		list-style: none;
	}

	a {
		display: block;
		padding-block: 0.2rem;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-xs);
		line-height: 1.45;
		text-decoration: none;
		transition-property: color, translate;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	a:hover {
		color: var(--ink-accent-text);
		translate: 2px 0;
	}

	@media (max-width: 1180px) {
		aside {
			display: none;
		}
	}
</style>
