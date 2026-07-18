<script lang="ts">
	import { themeStore } from '@inkfinite/ui/editor';
	import favicon from '$editor/assets/favicon.svg';
	import '@inkfinite/ui/styles.css';
	import '$editor/styles.css';

	let { children } = $props();
	const _ = themeStore;
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>Inkfinite</title>
</svelte:head>

{@render children()}
