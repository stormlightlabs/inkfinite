<script lang="ts">
	import { resolve } from '$app/paths';
	import { Icon } from '$ui';

	let { markdown, slug }: { markdown: string; slug: string } = $props();
	let label = $state('Copy Markdown');

	function markdownUrl(path: string): string {
		return (resolve as (route: string) => string)(path);
	}

	async function copy(event: MouseEvent): Promise<void> {
		event.preventDefault();
		const rawUrl = (event.currentTarget as HTMLAnchorElement).href;
		try {
			await navigator.clipboard.writeText(markdown);
			label = 'Copied';
			window.setTimeout(() => (label = 'Copy Markdown'), 1600);
		} catch {
			window.location.assign(rawUrl);
		}
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a class="copy-markdown" href={markdownUrl(`/docs/${slug}.md`)} onclick={copy} aria-live="polite">
	<Icon name="markdown" size={16} />
	<span>{label}</span>
</a>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.copy-markdown {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.5rem;
		padding: 0.45rem 0.75rem;
		border: 1px solid var(--docs-border);
		border-radius: 0.25rem;
		background: var(--docs-surface-raised);
		color: var(--docs-accent-text);
		font-size: 0.82rem;
		font-weight: 650;
		text-decoration: none;
		white-space: nowrap;
		flex: 0 0 auto;
	}

	.copy-markdown:hover {
		border-color: var(--docs-accent);
		background: var(--docs-surface-hover);
	}
</style>
