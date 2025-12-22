<script lang="ts">
	import Canvas from '$lib/canvas/Canvas.svelte';
</script>

<div class="editor">
	<Canvas />
</div>

<style>
	.editor {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
	}
</style>
