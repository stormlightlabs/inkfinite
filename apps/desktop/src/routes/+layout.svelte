<script lang="ts">
	import favicon from '$editor/assets/favicon.svg';
	import { themeStore } from '@inkfinite/ui/editor';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';

	import '@inkfinite/ui/styles.css';

	let { children } = $props();
	const _ = themeStore;

	onMount(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;

		void listen<{ source: string }>('inkfinite-focus', () => window.focus())
			.then((stop) => {
				if (disposed) stop();
				else unlisten = stop;
			})
			.catch(() => undefined);

		return () => {
			disposed = true;
			unlisten?.();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>Inkfinite</title>
</svelte:head>

{@render children()}
