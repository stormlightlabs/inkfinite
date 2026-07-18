<script lang="ts">
	import { Button, IconButton, Panel, Toolbar, type InkTheme } from '$lib';

	let saves = $state(0);
	let theme = $state<Exclude<InkTheme, 'system'>>('light');
</script>

<svelte:head><title>Inkfinite UI workshop</title></svelte:head>

<main class="workshop" data-ink-theme={theme}>
	<header class="workshop__header">
		<div>
			<p class="workshop__kicker">Inkfinite UI workshop</p>
			<h1>Ideas should still look <em>unfinished.</em></h1>
			<p class="workshop__intro">
				Shared Svelte components for the web app and its Tauri desktop shell.
			</p>
		</div>
		<Button
			icon={theme === 'light' ? 'dark' : 'light'}
			label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
			onclick={() => (theme = theme === 'light' ? 'dark' : 'light')}
			variant="ghost" />
	</header>

	<section class="workshop__board" aria-label="Component preview">
		<Toolbar label="Drawing tools">
			<IconButton label="Draw" name="draw" selected />
			<IconButton label="Undo" name="undo" />
			<IconButton label="Redo" name="redo" />
			<IconButton label="Settings" name="settings" />
		</Toolbar>

		<Panel
			eyebrow="Fresh page"
			heading="Map the impossible"
			description="Rough edges keep the canvas approachable while Eldritch colors hold the interface together.">
			<div class="workshop__actions">
				<Button
					icon="save"
					label={`Save draft${saves ? ` (${saves})` : ''}`}
					onclick={() => saves++}
					variant="primary" />
				<Button icon="arrow" label="Share" />
			</div>
		</Panel>

		<aside class="workshop__note">
			<span>Try it messy.</span>
			<p>Playpen Sans is reserved for headings and notes, so controls stay crisp.</p>
		</aside>
	</section>
</main>

<style>
	.workshop {
		min-height: 100vh;
		padding: clamp(1.25rem, 4vw, 4rem);
		color: var(--ink-text);
		background-color: var(--ink-canvas);
		background-image: radial-gradient(
			circle,
			color-mix(in srgb, var(--ink-text) 18%, transparent) 1px,
			transparent 1px
		);
		background-size: 22px 22px;
	}

	.workshop__header {
		display: flex;
		max-width: 68rem;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--ink-space-5);
		margin-inline: auto;
	}

	.workshop__kicker,
	.workshop__intro {
		margin: 0;
	}

	.workshop__kicker {
		color: var(--ink-accent-text);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		max-width: 14ch;
		margin-block: var(--ink-space-2);
		color: var(--ink-heading);
		font: 650 clamp(2.5rem, 7vw, 5.75rem) / 0.98 var(--ink-font-display);
		letter-spacing: -0.06em;
	}

	h1 em {
		color: var(--ink-accent-text);
		font-style: normal;
	}

	.workshop__intro {
		max-width: 42rem;
		color: var(--ink-text-muted);
		font-size: clamp(1rem, 1rem + 0.4vw, 1.25rem);
	}

	.workshop__board {
		display: grid;
		max-width: 68rem;
		grid-template-columns: minmax(0, 1fr) minmax(14rem, 0.55fr);
		align-items: start;
		gap: clamp(1.5rem, 4vw, 4rem);
		margin: clamp(3rem, 8vw, 7rem) auto 0;
	}

	.workshop__board > :first-child {
		position: absolute;
		z-index: 1;
		margin: calc(var(--ink-control-height) * -0.65) 0 0 var(--ink-space-5);
	}

	.workshop__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ink-space-3);
	}

	.workshop__note {
		rotate: 1.5deg;
		padding: var(--ink-space-5);
		border: 2px solid var(--ink-border-strong);
		border-radius: var(--ink-radius-panel-small);
		background: color-mix(in srgb, var(--ink-eldritch-orange) 52%, var(--ink-surface-raised));
		box-shadow: 4px 5px 0 var(--ink-shadow-color);
	}

	.workshop__note span {
		font: 650 var(--ink-type-lg) / 1.2 var(--ink-font-display);
	}

	.workshop__note p {
		margin-block: var(--ink-space-2) 0;
	}

	@media (max-width: 44rem) {
		.workshop__header {
			flex-direction: column;
		}

		.workshop__board {
			grid-template-columns: 1fr;
		}
	}
</style>
