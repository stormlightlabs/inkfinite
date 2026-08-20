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
			requestAnimationFrame(() =>
				document.querySelector<HTMLInputElement>('.pagefind-ui__search-input')?.focus()
			);
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
		script.addEventListener('error', () => (unavailable = true));
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
	<Icon name="search" size={17} />
	<span>Search docs</span>
	<kbd>⌘ K</kbd>
</button>

<button hidden={!open} class="search-scrim" aria-label="Close search" type="button" onclick={close}
></button>
<section hidden={!open} class="search-dialog" aria-label="Search documentation">
	<div class="search-heading">
		<div>
			<p class="search-kicker">Documentation search</p>
			<strong>Search the docs</strong>
		</div>
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
		gap: 0.5rem;
		width: min(15rem, 22vw);
		min-height: 2.75rem;
		padding: 0.42rem 0.55rem;
		border: 1px solid var(--docs-border);
		border-radius: 0.35rem;
		background: var(--docs-surface-raised);
		color: var(--docs-text-muted);
		font: 550 0.86rem / 1 var(--docs-font-body);
		text-align: left;
		cursor: pointer;
	}

	.search-trigger:hover {
		border-color: var(--docs-accent);
		color: var(--docs-accent-text);
	}

	.search-trigger span {
		flex: 1;
	}

	kbd {
		padding: 0.18rem 0.3rem;
		border: 1px solid var(--docs-border);
		border-bottom-width: 2px;
		border-radius: 0.2rem;
		background: var(--docs-canvas);
		color: var(--docs-text-muted);
		font: 650 0.68rem / 1 var(--docs-font-mono);
		white-space: nowrap;
	}

	.search-scrim {
		position: fixed;
		inset: 0;
		z-index: 20;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: rgb(8 9 16 / 58%);
		backdrop-filter: blur(3px);
	}

	.search-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 21;
		width: min(42rem, calc(100vw - 2rem));
		max-height: min(42rem, calc(100vh - 2rem));
		padding: 1.25rem;
		transform: translate(-50%, -50%);
		overflow: auto;
		border: 1px solid var(--docs-border);
		border-radius: 0.65rem;
		background: var(--docs-surface-raised);
		color: var(--docs-text);
		box-shadow: var(--docs-shadow);
	}

	.search-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.search-kicker {
		margin: 0 0 0.3rem;
		color: var(--docs-accent-text);
		font: 650 var(--docs-type-xs) / 1 var(--docs-font-mono);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.search-heading strong {
		font-size: 1.45rem;
	}

	.close-button {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border: 1px solid var(--docs-border);
		border-radius: 0.3rem;
		background: transparent;
		color: var(--docs-text-muted);
		cursor: pointer;
	}

	.close-button:hover {
		border-color: var(--docs-accent);
		background: var(--docs-surface-hover);
		color: var(--docs-accent-text);
	}

	.search-note {
		color: var(--docs-text-muted);
		font-size: var(--docs-type-sm);
	}

	.search-dialog :global(.pagefind-ui) {
		--pagefind-ui-scale: 0.9;
		--pagefind-ui-primary: var(--docs-accent-text);
		--pagefind-ui-text: var(--docs-text);
		--pagefind-ui-background: var(--docs-surface-raised);
		--pagefind-ui-border: var(--docs-border);
		--pagefind-ui-tag: var(--docs-canvas);
		--pagefind-ui-border-width: 1px;
		--pagefind-ui-border-radius: 0.35rem;
		--pagefind-ui-font: var(--docs-font-body);
	}

	@media (max-width: 900px) {
		.search-trigger {
			width: 2.75rem;
			padding-inline: 0.5rem;
			justify-content: center;
		}

		.search-trigger span,
		.search-trigger kbd {
			display: none;
		}
	}
</style>
