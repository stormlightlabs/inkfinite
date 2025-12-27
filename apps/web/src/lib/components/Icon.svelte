<script lang="ts">
	import CloseIcon from '$lib/assets/close.svg?raw';
	import FolderIcon from '$lib/assets/folder.svg?raw';
	import GridDotsIcon from '$lib/assets/grid-dots.svg?raw';
	import InfoCircleIcon from '$lib/assets/info-circle.svg?raw';
	import MoonIcon from '$lib/assets/moon.svg?raw';
	import PencilIcon from '$lib/assets/pencil.svg?raw';
	import SearchIcon from '$lib/assets/search.svg?raw';
	import SunIcon from '$lib/assets/sun.svg?raw';
	import TrashIcon from '$lib/assets/trash.svg?raw';
	import GripVerticalIcon from '$lib/assets/grip-vertical.svg?raw';

	export type IconName =
		| 'close'
		| 'folder'
		| 'grid-dots'
		| 'grip-vertical'
		| 'info-circle'
		| 'moon'
		| 'pencil'
		| 'search'
		| 'sun'
		| 'trash';

	type Props = { name: IconName; size?: number; color?: string };

	const { name, size = 16, color = '#4c566a' }: Props = $props();

	const icons: Record<IconName, string> = {
		close: CloseIcon,
		folder: FolderIcon,
		'grid-dots': GridDotsIcon,
		'grip-vertical': GripVerticalIcon,
		'info-circle': InfoCircleIcon,
		moon: MoonIcon,
		pencil: PencilIcon,
		search: SearchIcon,
		sun: SunIcon,
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
