<script lang="ts">
	import Sheet, { type SheetProps } from '../Sheet.svelte';

	let { open = true, ...props }: SheetProps = $props();
</script>

<Sheet bind:open {...props}>
	<div class="story-sheet">
		<p>Shared sheet</p>
		<h2>Stencil library</h2>
		<label>
			<span>Filter components</span>
			<input type="search" placeholder="Search…" />
		</label>
		<button type="button" onclick={() => (open = false)}>Close sheet</button>
	</div>
</Sheet>

<style>
	.story-sheet {
		display: grid;
		gap: var(--ink-space-4);
		padding: var(--ink-space-5);
	}

	.story-sheet p,
	.story-sheet h2 {
		margin: 0;
	}

	.story-sheet p {
		color: var(--ink-accent-text);
		font-size: var(--ink-type-xs);
		font-weight: 700;
		text-transform: uppercase;
	}

	.story-sheet label {
		display: grid;
		gap: var(--ink-space-2);
	}
</style>
