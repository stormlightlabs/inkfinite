<script lang="ts">
	import { Editor } from '@inkfinite/ui/editor';
	import { createDesktopPlatformAdapter } from '$lib/platform';

	const platform = createDesktopPlatformAdapter();
</script>

<div class="editor-root">
	<Editor {platform} />
</div>

<style>
	:global(body),
	:global(html) {
		margin: 0;
		padding: 0;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		position: relative;
		min-width: 0;
	}

	.editor-root {
		width: 100%;
		height: 100%;
	}
</style>
