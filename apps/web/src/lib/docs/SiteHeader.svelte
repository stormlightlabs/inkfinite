<script lang="ts">
	import { resolve } from '$app/paths';
	import favicon from '$editor/assets/favicon.svg';
	import { Icon } from '$ui';
	import type { Doc } from './content/types';
	import DocsSearch from './DocsSearch.svelte';
	import DocsThemeToggle from './DocsThemeToggle.svelte';

	let { docs, currentSlug = '' }: { docs: Doc[]; currentSlug?: string } = $props();

	const primaryLinks = [
		{ label: 'Start', href: '/docs/quickstart/', slug: 'quickstart' },
		{ label: 'Guide', href: '/docs/guide/editor/', slug: 'guide' },
		{ label: 'Automation', href: '/docs/automation/cli/', slug: 'automation' },
		{ label: 'Changelog', href: '/docs/changelog/', slug: 'changelog' }
	] as const;
	const githubUrl = 'https://github.com/stormlightlabs/inkfinite';

	function isCurrent(slug: string): boolean {
		if (slug === 'quickstart' && currentSlug === 'introduction') return true;
		return currentSlug === slug || currentSlug.startsWith(`${slug}/`);
	}

	function resolveDocsPath(path: string): string {
		return (resolve as (route: string) => string)(path);
	}

	const skipHref = $derived(
		resolveDocsPath(currentSlug ? `/docs/${currentSlug}/#main-content` : '/#main-content')
	);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a class="skip-link" href={skipHref}> Skip to content </a>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
<header class="site-header" data-pagefind-ignore>
	<div class="header-inner">
		<a class="brand" href={resolve('/')} aria-label="Inkfinite documentation home">
			<img src={favicon} alt="" />
			<span>Inkfinite</span>
		</a>

		<nav class="primary-nav" aria-label="Primary navigation">
			{#each primaryLinks as link (link.slug)}
				<a class:active={isCurrent(link.slug)} href={resolve(link.href)}>{link.label}</a>
			{/each}
			<a class="github-link" href={githubUrl}>
				<Icon name="github" size={17} />
				<span>GitHub</span>
			</a>
		</nav>

		<div class="header-actions">
			<div class="desktop-search"><DocsSearch id="desktop-search" /></div>
			<DocsThemeToggle />
			<details class="mobile-menu">
				<summary aria-label="Open documentation menu">
					<Icon name="menu" size={18} />
					<span>Menu</span>
				</summary>
				<div class="mobile-menu-panel">
					<DocsSearch id="mobile-search" />
					<nav aria-label="Mobile navigation">
						{#each primaryLinks as link (link.slug)}
							<a class:active={isCurrent(link.slug)} href={resolve(link.href)}
								>{link.label}</a>
						{/each}
						<a class="github-link" href={githubUrl}>
							<Icon name="github" size={17} />
							<span>GitHub</span>
						</a>
					</nav>
					<div class="mobile-doc-links">
						{#each docs as doc (doc.slug)}
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								class:active={doc.slug === currentSlug}
								href={resolveDocsPath(`/docs/${doc.slug}/`)}>{doc.title}</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/each}
					</div>
				</div>
			</details>
		</div>
	</div>
</header>

<style>
	.site-header {
		position: sticky;
		top: 0;
		z-index: 10;
		border-bottom: 0.25px dotted var(--docs-border);
		background: var(--docs-header-surface);
		backdrop-filter: blur(12px);
	}

	.header-inner {
		display: flex;
		align-items: center;
		gap: 2rem;
		max-width: 1440px;
		min-height: 4.5rem;
		margin: 0 auto;
		padding: 0.75rem 2rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
		flex: 0 0 auto;
		color: var(--docs-text);
		font-family: var(--docs-font-display);
		font-size: 1.04rem;
		font-weight: 650;
		letter-spacing: -0.02em;
		text-decoration: none;
	}

	.brand img {
		width: 2rem;
		height: 2rem;
		flex: 0 0 auto;
	}

	.primary-nav {
		display: flex;
		align-items: center;
		gap: 1.35rem;
		margin-right: auto;
		font-family: var(--docs-font-heading);
	}

	.primary-nav a,
	.mobile-menu-panel nav a,
	.mobile-doc-links a {
		color: var(--docs-text-muted);
		font-size: 0.92rem;
		font-weight: 550;
		text-decoration: none;
	}

	.primary-nav a:hover,
	.primary-nav a.active,
	.mobile-menu-panel nav a:hover,
	.mobile-menu-panel nav a.active,
	.mobile-doc-links a:hover,
	.mobile-doc-links a.active {
		color: var(--docs-accent-text);
	}

	.primary-nav a.active {
		text-decoration: underline;
		text-decoration-color: var(--docs-accent);
		text-decoration-thickness: 2px;
		text-underline-offset: 0.35rem;
	}

	.github-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		width: fit-content;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}

	.mobile-menu {
		display: none;
		position: relative;
	}

	.mobile-menu summary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.75rem;
		padding: 0.45rem 0.65rem;
		border: 1px solid var(--docs-border);
		border-radius: 0.35rem;
		color: var(--docs-accent-text);
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}

	.mobile-menu summary::-webkit-details-marker {
		display: none;
	}

	.mobile-menu-panel {
		position: absolute;
		top: calc(100% + 0.75rem);
		right: 0;
		display: grid;
		gap: 1rem;
		width: min(20rem, calc(100vw - 2rem));
		padding: 1rem;
		border: 1px solid var(--docs-border);
		background: var(--docs-surface-raised);
		box-shadow: var(--docs-shadow);
	}

	.mobile-menu-panel nav,
	.mobile-doc-links {
		display: grid;
		gap: 0.6rem;
	}

	.mobile-doc-links {
		padding-top: 0.85rem;
		border-top: 1px solid var(--docs-border);
	}

	.skip-link {
		position: fixed;
		top: 0.75rem;
		left: 1rem;
		z-index: 20;
		padding: 0.5rem 0.75rem;
		background: var(--docs-accent);
		color: var(--docs-on-accent);
		transform: translateY(-180%);
	}

	.skip-link:focus {
		transform: translateY(0);
	}

	@media (max-width: 900px) {
		.header-inner {
			gap: 1rem;
			padding: 0.7rem 1rem;
		}

		.primary-nav,
		.desktop-search {
			display: none;
		}

		.header-actions {
			margin-left: auto;
		}

		.mobile-menu {
			display: block;
		}
	}
</style>
