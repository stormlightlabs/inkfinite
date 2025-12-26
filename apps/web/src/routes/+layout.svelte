<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { themeStore } from '$lib/theme.svelte';
	import '../app.css';

	let { children } = $props();
	
	const _ = themeStore; 
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>Inkfinite - Infinite Canvas</title>
</svelte:head>

{@render children()}
