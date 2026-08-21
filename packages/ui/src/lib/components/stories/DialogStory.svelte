<script lang="ts">
	import Dialog, { type DialogProps } from '../Dialog.svelte';

	let { open = true, ...props }: DialogProps = $props();
</script>

<Dialog bind:open {...props}>
	<div class="story-dialog">
		<p class="story-dialog__eyebrow">Shared surface</p>
		<h2>About this board</h2>
		<p>
			Dialog content stays in the consuming app while focus and dismissal remain consistent.
		</p>
		<button type="button" onclick={() => (open = false)}>Close dialog</button>
	</div>
</Dialog>

<style>
	.story-dialog {
		display: grid;
		gap: var(--ink-space-3);
		max-width: 28rem;
		padding: var(--ink-space-5);
	}

	.story-dialog__eyebrow,
	.story-dialog h2,
	.story-dialog p {
		margin: 0;
	}

	.story-dialog__eyebrow {
		color: var(--ink-accent-text);
		font-size: var(--ink-type-xs);
		font-weight: 700;
		text-transform: uppercase;
	}

	.story-dialog h2 {
		font-family: var(--ink-font-display);
	}

	.story-dialog button {
		justify-self: start;
		padding: var(--ink-space-2) var(--ink-space-3);
	}
</style>
