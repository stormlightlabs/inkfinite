<script lang="ts">
	import Canvas from './canvas/Canvas.svelte';
	import type { EditorPlatformAdapter } from './platform';

	/** Services supplied by the web or desktop application root. */
	let { platform }: { platform: EditorPlatformAdapter } = $props();
</script>

<Canvas {platform} />
