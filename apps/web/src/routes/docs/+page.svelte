<script lang="ts">
	import { resolve } from '$app/paths';
	import { Icon } from '$ui';

	const features = [
		{
			icon: 'layers' as const,
			title: 'An infinite canvas',
			description:
				'Create a layered inkfinite documents with a native model shared across every Inkfinite interaction.',
			href: '/docs/concepts/documents/'
		},
		{
			icon: 'terminal' as const,
			title: 'Built for tools',
			description: 'Inspect, validate, change, and render documents through a powerful CLI.',
			href: '/docs/reference/cli/'
		},
		{
			icon: 'pencil' as const,
			title: 'Human and Agent',
			description: "Stay in the loop by reviewing an agent's changes on the canvas.",
			href: '/docs/reference/agents/'
		}
	];

	function resolveDocsPath(path: string): string {
		return (resolve as (route: string) => string)(path);
	}
</script>

<svelte:head>
	<title>Inkfinite documentation</title>
	<meta
		name="description"
		content="Build, edit, automate, and share infinite-canvas documents with Inkfinite." />
</svelte:head>

<div class="landing-page">
	<section class="hero" data-pagefind-ignore>
		<div class="hero-copy">
			<p class="eyebrow"><span></span> Documentation</p>
			<h1>Give your ideas</h1>
			<h1><em>infinite room.</em></h1>
			<p class="tagline">
				Inkfinite is an open canvas for people and coding agents to sketch, connect, and
				refine ideas together.
			</p>
			<div class="hero-actions">
				<a class="primary-action" href={resolve('/docs/getting-started/')}>
					Get started <Icon name="arrow-right" size={18} />
				</a>
				<a class="secondary-action" href="https://github.com/stormlightlabs/inkfinite">
					<Icon name="github" size={18} /> View on GitHub
				</a>
			</div>
		</div>

		<div class="canvas-window" aria-hidden="true">
			<div class="window-bar">
				<span></span><span></span><span></span>
				<small>new_idea.inkfinite</small>
			</div>
			<div class="mini-canvas">
				<div class="canvas-grid"></div>
				<div class="shape note-one">Sketch</div>

				<div class="shape decision">Iterate</div>

				<div class="shape note-two">Ship</div>
				<div class="cursor"><Icon name="select" size={25} /><span>you</span></div>
			</div>
		</div>
	</section>

	<section class="feature-section" aria-labelledby="why-inkfinite">
		<div class="section-heading">
			<p class="eyebrow"><span></span> One whiteboard, many ways in</p>
			<h2 id="why-inkfinite">Draw or automate.</h2>
		</div>
		<div class="feature-grid">
			{#each features as feature, index (feature.title)}
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="feature-card"
					href={resolveDocsPath(feature.href)}
					style={`--card-tilt: ${index % 2 === 0 ? -0.8 : 0.8}deg`}>
					<span class="feature-icon"><Icon name={feature.icon} size={24} /></span>
					<h3>{feature.title}</h3>
					<p>{feature.description}</p>
					<span class="card-link"
						>Read the guide <Icon name="arrow-right" size={16} /></span>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/each}
		</div>
	</section>

	<section class="quick-start" aria-labelledby="quick-start-title">
		<div>
			<p class="eyebrow"><span></span> Start here</p>
			<h2 id="quick-start-title">Open a canvas and make your first mark.</h2>
		</div>
		<a class="primary-action" href={resolve('/docs/getting-started/')}>
			Read the quick start <Icon name="arrow-right" size={18} />
		</a>
	</section>
</div>

<style>
	.landing-page {
		overflow: hidden;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 0.92fr) minmax(26rem, 1.08fr);
		align-items: center;
		gap: clamp(2rem, 7vw, 8rem);
		min-height: min(46rem, calc(100svh - 4rem));
		padding: clamp(2rem, 8vw, 4rem);
		background: var(--ink-canvas);
	}

	.eyebrow {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
		margin: 0 0 var(--ink-space-4);
		color: var(--ink-accent-text);
		font-size: var(--ink-type-xs);
		font-weight: 750;
		letter-spacing: 0.11em;
		text-transform: uppercase;
	}

	.eyebrow span {
		width: 1.75rem;
		height: 3px;
		background: var(--ink-accent);
		border-radius: 999px;
		transform: rotate(-2deg);
	}

	h1 {
		margin: 0;
		color: var(--ink-text);
		font-family: var(--ink-font-body);
		font-size: clamp(3.3rem, 7.2vw, 6.7rem);
		font-weight: 700;
		letter-spacing: -0.0375em;
		line-height: 0.92;
		text-wrap: balance;
	}

	h1 em {
		color: var(--ink-heading);
		font-style: normal;
	}

	.tagline {
		max-width: 38rem;
		margin: var(--ink-space-6) 0 0;
		color: var(--ink-text-muted);
		font-size: clamp(1.05rem, 1.5vw, 1.25rem);
		line-height: 1.65;
		text-wrap: pretty;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ink-space-3);
		margin-top: var(--ink-space-6);
	}

	.primary-action,
	.secondary-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--ink-space-2);
		min-height: 44px;
		padding: var(--ink-space-3) var(--ink-space-5);
		border-radius: var(--ink-radius-wobbly);
		font-size: var(--ink-type-sm);
		font-weight: 700;
		text-decoration: none;
		transition-property: color, background-color, box-shadow, translate, scale;
		transition-duration: var(--ink-duration-fast);
		transition-timing-function: var(--ink-ease-out);
	}

	.primary-action {
		color: var(--ink-on-accent);
		background: var(--ink-accent);
		box-shadow: 3px 4px 0 var(--ink-shadow-color);
	}

	.primary-action:hover {
		color: var(--ink-on-accent);
		background: var(--ink-accent-hover);
		translate: -1px -1px;
		box-shadow: 5px 6px 0 var(--ink-shadow-color);
	}

	.secondary-action {
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		box-shadow:
			0 4px 14px color-mix(in srgb, var(--ink-shadow-color) 10%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--ink-border) 45%, transparent);
	}

	.secondary-action:hover {
		color: var(--ink-text);
		background: var(--ink-surface-hover);
		translate: 0 -1px;
	}

	.primary-action:active,
	.secondary-action:active {
		scale: 0.96;
	}

	.canvas-window {
		position: relative;
		aspect-ratio: 1.18;
		min-width: 0;
		overflow: hidden;
		background: var(--ink-surface-raised);
		border-radius: 16px 24px 19px 22px / 22px 17px 25px 18px;
		box-shadow:
			18px 22px 0 color-mix(in srgb, var(--ink-shadow-color) 92%, transparent),
			0 30px 80px color-mix(in srgb, var(--ink-shadow-color) 25%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--ink-border) 40%, transparent);
		transform: rotate(1.25deg);
	}

	.window-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		height: 2.8rem;
		padding-inline: 1rem;
		background: var(--ink-surface);
		box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--ink-border) 35%, transparent);
	}

	.window-bar > span {
		width: 0.7rem;
		height: 0.7rem;
		background: var(--ink-border);
		border-radius: 50%;
	}

	.window-bar > span:first-child {
		background: var(--ink-danger);
	}

	.window-bar > span:nth-child(2) {
		background: var(--ink-warning);
	}

	.window-bar > span:nth-child(3) {
		background: var(--ink-accent);
	}

	.window-bar small {
		margin-left: auto;
		color: var(--ink-text-muted);
		font-size: 0.66rem;
	}

	.mini-canvas {
		position: relative;
		height: calc(100% - 2.8rem);
		overflow: hidden;
		background: var(--ink-canvas);
	}

	.canvas-grid {
		position: absolute;
		inset: 0;
		opacity: 0.4;
		background-image: radial-gradient(var(--ink-border) 1px, transparent 1px);
		background-size: 18px 18px;
	}

	.shape {
		position: absolute;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 7.4rem;
		height: 4.6rem;
		color: var(--ink-on-accent);
		background: var(--ink-accent);
		border: 2px solid var(--ink-border-strong);
		border-radius: var(--ink-radius-wobbly);
		box-shadow: 3px 4px 0 var(--ink-shadow-color);
		font-family: var(--ink-font-body);
		font-size: 0.9rem;
		font-weight: 650;
	}

	.note-one {
		top: 20%;
		left: 9%;
		transform: rotate(-2deg);
	}

	.decision {
		top: 45%;
		left: 39%;
		background: var(--ink-warning);
		transform: rotate(1deg);
	}

	.note-two {
		right: 7%;
		bottom: 13%;
		color: var(--ink-text);
		background: var(--ink-surface-raised);
		transform: rotate(-1deg);
	}

	.cursor {
		position: absolute;
		z-index: 3;
		top: 26%;
		right: 18%;
		color: var(--ink-accent-text);
		filter: drop-shadow(0 1px 0 var(--ink-surface-raised));
	}

	.cursor span {
		display: block;
		margin: -0.1rem 0 0 1rem;
		padding: 0.1rem 0.4rem;
		color: var(--ink-on-accent);
		background: var(--ink-accent);
		border-radius: 3px;
		font-size: 0.62rem;
	}

	.feature-section {
		padding: clamp(5rem, 9vw, 8rem) max(1.5rem, calc((100vw - 76rem) / 2));
		background: var(--ink-surface-raised);
	}

	.section-heading {
		max-width: 43rem;
	}

	.section-heading h2,
	.quick-start h2 {
		margin: 0;
		color: var(--ink-heading);
		font-family: var(--ink-font-body);
		font-size: clamp(2rem, 4vw, 3.4rem);
		letter-spacing: -0.045em;
		line-height: 1.1;
		text-wrap: balance;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--ink-space-5);
		margin-top: clamp(2.5rem, 5vw, 4rem);
	}

	.feature-card {
		display: flex;
		flex-direction: column;
		min-height: 18rem;
		padding: var(--ink-space-5);
		color: var(--ink-text);
		background: var(--ink-canvas);
		border-radius: var(--ink-radius-panel);
		box-shadow:
			0 12px 32px color-mix(in srgb, var(--ink-shadow-color) 8%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--ink-border) 30%, transparent);
		text-decoration: none;
		transform: translateY(0) rotate(0deg);
		transform-origin: 50% 85%;
		transition-property: background-color, box-shadow, color, transform, scale;
		transition-duration: 220ms;
		transition-timing-function: var(--ink-ease-out);
	}

	.feature-card:hover,
	.feature-card:focus-visible {
		color: var(--ink-text);
		background: color-mix(in srgb, var(--ink-canvas) 88%, var(--ink-accent) 12%);
		box-shadow:
			7px 10px 0 color-mix(in srgb, var(--ink-shadow-color) 88%, transparent),
			0 24px 44px color-mix(in srgb, var(--ink-shadow-color) 18%, transparent),
			inset 0 0 0 2px color-mix(in srgb, var(--ink-border-strong) 78%, transparent);
		transform: translate(-2px, -8px) rotate(var(--card-tilt));
	}

	.feature-card:active {
		scale: 0.96;
	}

	.feature-icon {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		color: var(--ink-accent-text);
		background: color-mix(in srgb, var(--ink-accent) 14%, var(--ink-surface-raised));
		border-radius: var(--ink-radius-wobbly-small);
	}

	.feature-card h3 {
		margin: var(--ink-space-5) 0 var(--ink-space-2);
		color: var(--ink-heading);
		font-family: var(--ink-font-body);
		font-size: 1.2rem;
	}

	.feature-card p {
		margin: 0;
		color: var(--ink-text-muted);
		font-size: var(--ink-type-sm);
		line-height: 1.65;
		text-wrap: pretty;
	}

	.card-link {
		display: flex;
		align-items: center;
		gap: var(--ink-space-2);
		margin-top: auto;
		padding-top: var(--ink-space-5);
		color: var(--ink-accent-text);
		font-size: var(--ink-type-sm);
		font-weight: 700;
	}

	.quick-start {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ink-space-6);
		padding: clamp(4rem, 7vw, 6rem) max(1.5rem, calc((100vw - 76rem) / 2));
		background: var(--ink-surface);
	}

	.quick-start > div {
		max-width: 42rem;
	}

	@media (max-width: 960px) {
		.hero {
			grid-template-columns: 1fr;
			padding-block: 5rem 7rem;
		}

		.canvas-window {
			width: min(40rem, 92%);
			margin-inline: auto;
		}

		.feature-grid {
			grid-template-columns: 1fr;
		}

		.feature-card {
			min-height: 0;
		}
	}

	@media (max-width: 660px) {
		.hero {
			padding-top: 4rem;
		}

		h1 {
			font-size: clamp(3rem, 16vw, 5rem);
		}

		.canvas-window {
			width: 100%;
			box-shadow:
				9px 11px 0 var(--ink-shadow-color),
				0 24px 50px color-mix(in srgb, var(--ink-shadow-color) 20%, transparent);
		}

		.shape {
			width: 5.4rem;
			height: 3.6rem;
			font-size: 0.75rem;
		}

		.quick-start {
			align-items: flex-start;
			flex-direction: column;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-action,
		.secondary-action,
		.feature-card {
			transition: none;
		}

		.primary-action:hover,
		.secondary-action:hover,
		.feature-card:hover {
			translate: 0;
			transform: none;
		}
	}
</style>
