<script lang="ts">
	import ContextMenu, { type ContextMenuEntry } from './ContextMenu.svelte';

	let open = $state(false);
	let point = $state({ x: 180, y: 130 });
	let lastAction = $state('None yet');
	let trigger = $state<HTMLButtonElement | null>(null);

	const items: ContextMenuEntry[] = [
		{ id: 'duplicate', label: 'Duplicate', icon: 'add', shortcut: '⌘D' },
		{ id: 'visible', label: 'Visible', checked: true },
		{ type: 'separator' },
		{ id: 'delete', label: 'Delete', icon: 'delete', shortcut: '⌫', danger: true }
	];

	function showAt(x: number, y: number) {
		point = { x, y };
		open = true;
	}
</script>

<div
	class="context-menu-story"
	role="region"
	aria-label="Context menu preview"
	oncontextmenu={(event) => {
		event.preventDefault();
		showAt(event.clientX, event.clientY);
	}}>
	<button
		bind:this={trigger}
		type="button"
		onclick={(event) => showAt(event.clientX, event.clientY)}>
		Open context menu
	</button>
	<p>Right-click anywhere in this card.</p>
	<output>Last action: {lastAction}</output>
</div>

<ContextMenu
	{items}
	label="Story actions"
	{open}
	returnFocus={trigger}
	x={point.x}
	y={point.y}
	onOpenChange={(value) => (open = value)}
	onSelect={(id) => (lastAction = id)} />

<style>
	.context-menu-story {
		display: grid;
		min-height: 18rem;
		place-content: center;
		gap: var(--ink-space-3);
		border: 2px dashed var(--ink-border);
		border-radius: var(--ink-radius-panel);
		color: var(--ink-text);
		background: var(--ink-canvas);
		text-align: center;
	}

	button {
		min-height: var(--ink-control-height);
		padding-inline: var(--ink-space-4);
		border: var(--ink-line-width) solid var(--ink-border-strong);
		border-radius: var(--ink-radius-wobbly);
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		font: 650 var(--ink-type-sm) / 1 var(--ink-font-body);
		cursor: pointer;
	}

	p,
	output {
		margin: 0;
		color: var(--ink-text-muted);
		font: 500 var(--ink-type-sm) / 1.4 var(--ink-font-body);
	}
</style>
