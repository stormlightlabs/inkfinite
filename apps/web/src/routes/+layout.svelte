<script lang="ts">
	import favicon from '$editor/assets/favicon.svg';
	import { themeStore } from '@inkfinite/ui/editor';
	import '@inkfinite/ui/styles.css';

	let { children } = $props();

	const _ = themeStore;
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>Inkfinite - Infinite Canvas</title>
</svelte:head>

{@render children()}
