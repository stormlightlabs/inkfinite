<script lang="ts">
	import { Editor } from '@inkfinite/ui/editor';
	import { createDexiePlatformAdapter } from '$lib/persistence/dexie';
	import Seo from '$lib/Seo.svelte';
	import { site } from '$lib/site';

	const platform = createDexiePlatformAdapter();
</script>

<Seo title="Inkfinite editor" description={site.description} pathname="/app/" index={false} />

<main class="web-editor">
	<Editor {platform} />
</main>

<style>
	.web-editor {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

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
</style>
