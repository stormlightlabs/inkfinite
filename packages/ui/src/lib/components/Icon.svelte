<script module lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import type { IconName } from '../icons';

	/** Props for the shared Iconify-backed icon primitive. */
	export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
		color?: string;
		label?: string;
		name: IconName;
		size?: number | string;
	}
</script>

<script lang="ts">
	import { ICONS } from '../icons';

	let { class: className = '', color, label, name, size = '1em', ...rest }: IconProps = $props();
	let resolvedSize = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<span
	{...rest}
	aria-hidden={label ? undefined : 'true'}
	aria-label={label}
	class={['ink-icon', ICONS[name], className]}
	role={label ? 'img' : undefined}
	style:--ink-icon-size={resolvedSize}
	style:color></span>

<style>
	.ink-icon {
		width: var(--ink-icon-size);
		height: var(--ink-icon-size);
	}
</style>
