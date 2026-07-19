<script lang="ts">
	// TODO: og image
	// TODO: SEO optimization
	// TODO: llms.txt
	// TODO: sitemap
	import DocsShell from '$lib/docs/DocsShell.svelte';
	import '$lib/docs/docs.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Inkfinite documentation</title>
	<meta
		name="description"
		content="Documentation for Inkfinite's canvas editor, document model, command-line tools, and agentic workflows." />
</svelte:head>

<DocsShell>{@render children()}</DocsShell>
