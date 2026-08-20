<script lang="ts">
	import { onMount } from 'svelte';
	import { Icon } from '$ui';

	type Theme = 'light' | 'dark';

	const storageKey = 'inkfinite-docs-theme';
	let theme = $state<Theme>('dark');

	function applyTheme(nextTheme: Theme): void {
		theme = nextTheme;
		document.documentElement.setAttribute('data-inkfinite-docs-theme', nextTheme);
		try {
			window.localStorage.setItem(storageKey, nextTheme);
		} catch {
			// The visual preference still applies when storage is unavailable.
		}
	}

	onMount(() => {
		let storedTheme: string | null = null;
		try {
			storedTheme = window.localStorage.getItem(storageKey);
		} catch {
			// Use the dark documentation theme when storage is unavailable.
		}

		const initialTheme: Theme =
			storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
		applyTheme(initialTheme);

		return () => document.documentElement.removeAttribute('data-inkfinite-docs-theme');
	});
</script>

<button
	class="theme-toggle"
	type="button"
	aria-label={theme === 'dark'
		? 'Switch documentation to light mode'
		: 'Switch documentation to dark mode'}
	aria-pressed={theme === 'dark'}
	title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
	onclick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}>
	<Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
	<span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-width: 5rem;
		min-height: 2.75rem;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--docs-border);
		border-radius: 999px;
		background: var(--docs-surface-raised);
		color: var(--docs-text);
		font: 600 var(--docs-type-sm) / 1 var(--docs-font-body);
		cursor: pointer;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			color 150ms ease,
			transform 150ms ease;
	}

	.theme-toggle:hover {
		border-color: var(--docs-accent);
		background: var(--docs-surface-hover);
		color: var(--docs-accent-text);
	}

	.theme-toggle:active {
		transform: translateY(1px);
	}

	@media (max-width: 900px) {
		.theme-toggle span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}

		.theme-toggle {
			min-width: 2.75rem;
			padding-inline: 0.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.theme-toggle {
			transition: none;
		}
	}
</style>
