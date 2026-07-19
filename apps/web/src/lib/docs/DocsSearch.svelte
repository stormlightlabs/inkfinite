<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { Icon } from '$ui';
	import { onMount } from 'svelte';

	let searchRoot: HTMLDivElement;
	let open = $state(false);
	let unavailable = $state(false);

	type PagefindWindow = Window &
		typeof globalThis & {
			PagefindUI?: new (options: {
				bundlePath: string;
				element: HTMLElement;
				showImages: boolean;
				showSubResults: boolean;
			}) => unknown;
		};

	/** Pagefind writes these files after SvelteKit generates its static asset types. */
	function resolvePagefindAsset(path: string): string {
		return (resolve as (assetPath: string) => string)(path);
	}

	function close() {
		open = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			open = true;
			requestAnimationFrame(() => {
				document.querySelector<HTMLInputElement>('.pagefind-ui__search-input')?.focus();
			});
		}
	}

	onMount(() => {
		if (!browser) return;

		const stylesheetUrl = resolvePagefindAsset('/pagefind/pagefind-ui.css');
		const scriptUrl = resolvePagefindAsset('/pagefind/pagefind-ui.js');
		const bundlePath = resolvePagefindAsset('/pagefind/');

		if (!document.querySelector(`link[href="${stylesheetUrl}"]`)) {
			const stylesheet = document.createElement('link');
			stylesheet.rel = 'stylesheet';
			stylesheet.href = stylesheetUrl;
			document.head.append(stylesheet);
		}

		const startSearch = () => {
			const PagefindUI = (window as PagefindWindow).PagefindUI;
			if (!PagefindUI) {
				unavailable = true;
				return;
			}

			new PagefindUI({
				bundlePath,
				element: searchRoot,
				showImages: false,
				showSubResults: true
			});
		};

		const existingScript = document.querySelector<HTMLScriptElement>(
			`script[src="${scriptUrl}"]`
		);
		if (existingScript) {
			if ((window as PagefindWindow).PagefindUI) startSearch();
			else existingScript.addEventListener('load', startSearch, { once: true });
			return;
		}

		const script = document.createElement('script');
		script.async = true;
		script.src = scriptUrl;
		script.addEventListener('load', startSearch, { once: true });
		script.addEventListener('error', () => {
			unavailable = true;
		});
		document.head.append(script);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<button
	class="search-trigger"
	type="button"
	aria-label="Search documentation"
	aria-expanded={open}
	onclick={() => (open = true)}>
	<Icon name="search" size={18} />
	<span>Search docs</span>
	<kbd>⌘ K</kbd>
</button>

<button
	hidden={!open}
	class="search-scrim"
	aria-label="Close search"
	type="button"
	onclick={close}>
</button>
<section hidden={!open} class="search-dialog" aria-label="Search documentation">
	<div class="search-heading">
		<strong>Search documentation</strong>
		<button class="close-button" type="button" aria-label="Close search" onclick={close}>
			<Icon name="close" size={18} />
		</button>
	</div>
	<div bind:this={searchRoot}></div>
	{#if unavailable}
		<p class="search-note">
			Search is available after the static Pagefind index has been built.
		</p>
	{/if}
</section>

<style>
	.search-trigger {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
		min-width: min(18rem, 28vw);
		height: var(--ink-control-height);
		padding: 0 var(--ink-space-2) 0 var(--ink-space-3);
		color: var(--ink-text-muted);
		background: var(--ink-surface-raised);
		border: 1px solid color-mix(in srgb, var(--ink-border) 55%, transparent);
		border-radius: var(--ink-radius-wobbly-small);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--ink-shadow-color) 12%, transparent);
		font: inherit;
		cursor: pointer;
		transition-property: color, background-color, box-shadow, scale;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.search-trigger:hover {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
		box-shadow: 0 2px 5px color-mix(in srgb, var(--ink-shadow-color) 16%, transparent);
	}

	.search-trigger:active {
		scale: 0.96;
	}

	.search-trigger span {
		flex: 1;
		text-align: left;
	}

	kbd {
		padding: 0.15rem 0.4rem;
		color: var(--ink-text-muted);
		background: var(--ink-surface);
		border-radius: 4px;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink-border) 45%, transparent);
		font-family: var(--ink-font-body);
		font-size: var(--ink-type-xs);
	}

	.search-scrim {
		position: fixed;
		inset: 0;
		z-index: 20;
		width: 100%;
		height: 100%;
		padding: 0;
		background: color-mix(in srgb, var(--ink-canvas) 38%, transparent);
		border: 0;
		backdrop-filter: blur(4px);
	}

	.search-dialog {
		position: fixed;
		inset: max(5rem, 10vh) 50% auto auto;
		z-index: 21;
		width: min(42rem, calc(100vw - 2rem));
		max-height: min(42rem, calc(100vh - 8rem));
		overflow: auto;
		padding: var(--ink-space-4);
		translate: 50% 0;
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		border-radius: var(--ink-radius-panel);
		box-shadow:
			0 24px 64px color-mix(in srgb, var(--ink-shadow-color) 32%, transparent),
			0 0 0 1px color-mix(in srgb, var(--ink-border) 38%, transparent);
	}

	.search-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--ink-space-3);
	}

	.close-button {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		padding: 0;
		color: var(--ink-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--ink-radius-wobbly-small);
		cursor: pointer;
	}

	.close-button:hover {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
	}

	.search-note {
		color: var(--ink-text-muted);
		font-size: var(--ink-type-sm);
	}

	.search-dialog :global(.pagefind-ui) {
		--pagefind-ui-scale: 0.9;
		--pagefind-ui-primary: var(--ink-accent-text);
		--pagefind-ui-text: var(--ink-text);
		--pagefind-ui-background: var(--ink-surface-raised);
		--pagefind-ui-border: var(--ink-border);
		--pagefind-ui-tag: var(--ink-surface);
		--pagefind-ui-border-width: 1px;
		--pagefind-ui-border-radius: 8px;
		--pagefind-ui-font: var(--ink-font-body);
	}

	@media (max-width: 760px) {
		.search-trigger {
			min-width: 40px;
			width: 40px;
			padding: 0;
			justify-content: center;
		}

		.search-trigger span,
		.search-trigger kbd {
			display: none;
		}
	}
</style>
