<script lang="ts">
	import { Editor } from '@inkfinite/ui/editor';
	import { createDexiePlatformAdapter } from '$lib/persistence/dexie';
	import Seo from '$lib/Seo.svelte';
	import { site } from '$lib/site';
	import { buildVersion } from '$lib/version';

	const platform = createDexiePlatformAdapter();
</script>

<Seo title="Inkfinite editor" description={site.description} pathname="/app/" index={false} />

<main class="web-editor">
	<Editor {platform} version={buildVersion.display} />
</main>

<style>
	.web-editor {
		position: fixed;
		inset: 0;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
</style>
