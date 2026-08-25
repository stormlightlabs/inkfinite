<script lang="ts">
	import { page } from '$app/state';
	import Seo from '$lib/Seo.svelte';

	let { title, description }: { title: string; description: string } = $props();
</script>

<Seo {title} {description} pathname={page.url.pathname} />
