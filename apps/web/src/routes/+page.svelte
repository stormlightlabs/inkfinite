<script lang="ts">
	import Canvas from '$lib/canvas/Canvas.svelte';
</script>

<div class="editor">
	<div class="canvas-wrapper">
		<Canvas />
	</div>
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
</style>
