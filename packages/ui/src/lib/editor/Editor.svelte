<script lang="ts">
	import Canvas from './canvas/Canvas.svelte';
	import type { EditorPlatformAdapter } from './platform';

	/** Services and build metadata supplied by the web or desktop application root. */
	let { platform, version = 'v0.0.0' }: { platform: EditorPlatformAdapter; version?: string } =
		$props();
</script>

<Canvas {platform} {version} />
