<script lang="ts">
	// TODO: active link styling
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { DOCS_GROUPS } from './navigation';

	let { close, open }: { close: () => void; open: boolean } = $props();

	function resolveDocsPath(path: string): string {
		return (resolve as (route: string) => string)(path);
	}
</script>

<aside id="docs-sidebar" class:open aria-label="Documentation navigation">
	<nav>
		{#each DOCS_GROUPS as group (group.title)}
			<section>
				<h2>{group.title}</h2>
				<ul>
					{#each group.pages as item (item.href)}
						<li>
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								href={resolveDocsPath(item.href)}
								aria-current={page.url.pathname === item.href ? 'page' : undefined}
								onclick={close}>
								{item.title}
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</nav>
</aside>

<style>
	aside {
		position: sticky;
		top: 4rem;
		height: calc(100svh - 4rem);
		overflow-y: auto;
		padding: var(--ink-space-6) var(--ink-space-4) clamp(1rem, 3vw, 2rem);
		background: color-mix(in srgb, var(--ink-surface) 56%, var(--ink-canvas));
		box-shadow: inset -1px 0 0 color-mix(in srgb, var(--ink-border) 30%, transparent);
		scrollbar-width: thin;
	}

	nav,
	section,
	ul {
		display: grid;
	}

	nav {
		gap: var(--ink-space-6);
	}

	section,
	ul {
		gap: var(--ink-space-1);
	}

	h2 {
		margin: 0 0 var(--ink-space-2);
		padding-inline: var(--ink-space-3);
		color: var(--ink-text-muted);
		font-family: var(--ink-font-body);
		font-size: var(--ink-type-xs);
		font-weight: 700;
		letter-spacing: 0.075em;
		text-transform: uppercase;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: flex;
		align-items: center;
		min-height: 40px;
		padding: var(--ink-space-2) var(--ink-space-3);
		color: var(--ink-text-muted);
		border-radius: var(--ink-radius-wobbly-small);
		font-size: var(--ink-type-sm);
		font-weight: 520;
		text-decoration: none;
		transition-property: color, background-color, translate;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	a:hover {
		color: var(--ink-text);
		background: color-mix(in srgb, var(--ink-surface-hover) 76%, transparent);
		translate: 2px 0;
	}

	a:active {
		scale: 0.96;
	}

	a[aria-current='page'] {
		color: var(--ink-accent-text);
		background: color-mix(in srgb, var(--ink-accent) 14%, var(--ink-surface-raised));
		box-shadow: inset 3px 0 0 var(--ink-accent);
		font-weight: 650;
	}

	@media (max-width: 960px) {
		aside {
			position: fixed;
			inset: 4rem auto 0 0;
			z-index: 8;
			width: min(19rem, 86vw);
			height: calc(100svh - 4rem);
			padding-left: var(--ink-space-4);
			translate: -105% 0;
			box-shadow:
				12px 0 30px color-mix(in srgb, var(--ink-shadow-color) 20%, transparent),
				inset -1px 0 0 color-mix(in srgb, var(--ink-border) 30%, transparent);
			transition: translate 180ms var(--ink-ease-out);
		}

		aside.open {
			translate: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		aside,
		a {
			transition: none;
		}
	}
</style>
