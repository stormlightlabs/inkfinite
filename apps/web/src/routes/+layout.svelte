<script lang="ts">
	import PwaStatus from '$lib/PwaStatus.svelte';
	import { themeStore } from '@inkfinite/ui/editor';
	import '@inkfinite/ui/styles.css';

	let { children } = $props();

	const _ = themeStore;
</script>

{@render children()}
<PwaStatus />
