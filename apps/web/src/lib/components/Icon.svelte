<script lang="ts">
	import CloseIcon from '$lib/assets/close.svg?raw';
	import FolderIcon from '$lib/assets/folder.svg?raw';
	import InfoCircleIcon from '$lib/assets/info-circle.svg?raw';
	import PencilIcon from '$lib/assets/pencil.svg?raw';
	import TrashIcon from '$lib/assets/trash.svg?raw';

	export type IconName = 'close' | 'folder' | 'info-circle' | 'pencil' | 'trash';

	type Props = { name: IconName; size?: number; color?: string };

	const { name, size = 16, color = '#4c566a' }: Props = $props();

	const icons: Record<IconName, string> = {
		close: CloseIcon,
		folder: FolderIcon,
		'info-circle': InfoCircleIcon,
		pencil: PencilIcon,
		trash: TrashIcon
	};

	const svg = $derived(icons[name]);
</script>

<!-- eslint-disable svelte/no-at-html-tags -->
<span class="icon" style:width="{size}px" style:height="{size}px" style:color aria-hidden="true">
	{@html svg}
</span>

<style>
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 1px;
	}

	.icon :global(svg) {
		width: 100%;
		height: 100%;
	}
</style>
