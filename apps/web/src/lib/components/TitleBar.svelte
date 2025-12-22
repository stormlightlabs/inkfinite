<script lang="ts">
	import Dialog from '$lib/components/Dialog.svelte';
	import icon from '../assets/favicon.svg';

	const helpLinks = [
		{ label: 'Project README', href: 'https://github.com/stormlightlabs/inkfinite', external: true },
		{ label: 'Issue Tracker', href: 'https://github.com/stormlightlabs/inkfinite/issues', external: true }
	];

	const keyboardTips = [
		'⌘/Ctrl + Z to undo, ⇧ + ⌘/Ctrl + Z to redo',
		'Hold space to pan the canvas',
		'Scroll to zoom, double-click to reset view'
	];

	let infoOpen = $state(false);
	function openInfo() {
		infoOpen = true;
	}
	function closeInfo() {
		infoOpen = false;
	}
</script>

<header class="titlebar">
	<div class="titlebar__brand">
		<div class="titlebar__logo">
			<img src={icon} alt="Inkfinite Icon" />
		</div>
		<div>
			<div class="titlebar__name">Inkfinite</div>
			<div class="titlebar__tagline">Infinite canvas playground</div>
		</div>
	</div>
	<div class="titlebar__spacer"></div>
	<button class="titlebar__info" onclick={openInfo} aria-label="About Inkfinite">
		<span aria-hidden="true">ℹ︎</span>
		<span class="titlebar__info-label">Info</span>
	</button>
</header>

<Dialog bind:open={infoOpen} onClose={closeInfo} title="About Inkfinite">
	<section class="about">
		<h1>About Inkfinite</h1>
		<p>
			Inkfinite is a Svelte-native infinite canvas prototype. The goal is to build a cross-platform editor with a
			framework-agnostic core so the same engine powers both the web and desktop apps.
		</p>

		<div class="about__section">
			<h2>Quick Tips</h2>
			<ul>
				{#each keyboardTips as tip}
					<li>{tip}</li>
				{/each}
			</ul>
		</div>

		<div class="about__section">
			<h2>Need help?</h2>
			<ul>
				{#each helpLinks as link}
					<li>
						<a href={link.href} target={link.external ? '_blank' : undefined} rel="noreferrer">
							{link.label}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</section>
</Dialog>

<style>
	.titlebar {
		display: flex;
		align-items: center;
		padding: 8px 16px;
		gap: 12px;
		background: var(--surface-elevated);
		border-bottom: 1px solid var(--border);
	}

	.titlebar__brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.titlebar__logo {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: var(--accent);
		color: var(--surface);
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
	}

	.titlebar__name {
		font-weight: 600;
		color: var(--text);
	}

	.titlebar__tagline {
		font-size: 12px;
		color: var(--text-muted);
	}

	.titlebar__spacer {
		flex: 1;
	}

	.titlebar__info {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		border-radius: 999px;
		padding: 4px 10px;
		cursor: pointer;
		font-size: 14px;
	}

	.titlebar__info:hover {
		background: var(--surface-elevated);
	}

	.titlebar__info-label {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.about {
		padding: 24px;
		max-width: 480px;
	}

	.about h1 {
		margin-top: 0;
		font-size: 22px;
	}

	.about__section {
		margin-top: 20px;
	}

	.about__section h2 {
		margin-bottom: 8px;
		font-size: 16px;
		color: var(--text-secondary);
	}

	.about__section ul {
		margin: 0;
		padding-left: 20px;
	}

	.about__section li + li {
		margin-top: 4px;
	}

	.about__section a {
		color: var(--accent);
		text-decoration: none;
	}

	.about__section a:hover {
		text-decoration: underline;
	}
</style>
