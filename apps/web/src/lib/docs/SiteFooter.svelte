<script lang="ts">
	import favicon from '$editor/assets/favicon.svg';
	import { buildCommitUrl, buildVersion } from '$lib/version';

	const year = new Date().getFullYear();
</script>

<footer class="site-footer" data-pagefind-ignore>
	<div class="footer-inner">
		<div class="footer-intro">
			<div class="footer-brand">
				<img src={favicon} alt="" />
				<span>Inkfinite</span>
			</div>
			<p>An open-source canvas for drawing, diagramming, and working with coding agents.</p>
		</div>

		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<nav class="footer-links" aria-label="Footer navigation">
			<section>
				<h2>Stormlight Labs</h2>
				<a href="https://stormlightlabs.org">Website</a>
				<a href="https://github.com/stormlightlabs">GitHub</a>
			</section>
			<section>
				<h2>Follow</h2>
				<a href="https://bsky.app/profile/stormlightlabs.org">Bluesky</a>
				<a href="https://x.com/_desertthunder">X / Twitter</a>
			</section>
			<section>
				<h2>Contact</h2>
				<a href="mailto:info@stormlightlabs.org">info@stormlightlabs.org</a>
			</section>
		</nav>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>

	<div class="footer-meta">
		<p>© {year} Stormlight Labs · Built with ⚡ in Austin, TX</p>
		<p>
			Inkfinite
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={buildCommitUrl} target="_blank" rel="noreferrer">
				{buildVersion.display}
			</a>
		</p>
	</div>
</footer>

<style>
	.site-footer {
		padding: clamp(3rem, 7vw, 5rem) 2rem 1.5rem;
		border-top: 1px solid var(--docs-border);
		background: var(--docs-code-surface);
		color: var(--docs-text-muted);
	}

	.footer-inner,
	.footer-meta {
		max-width: 1376px;
		margin: 0 auto;
	}

	.footer-inner {
		display: grid;
		grid-template-columns: minmax(15rem, 1.4fr) minmax(26rem, 2fr);
		gap: clamp(3rem, 8vw, 8rem);
		padding-bottom: clamp(2.5rem, 6vw, 4rem);
	}

	.footer-intro {
		max-width: 28rem;
	}

	.footer-brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--docs-text);
		font-family: var(--docs-font-display);
		font-size: 1.2rem;
		font-weight: 650;
		letter-spacing: -0.02em;
	}

	.footer-brand img {
		width: 2.25rem;
		height: 2.25rem;
	}

	.footer-intro p {
		max-width: 38ch;
		margin: 1.25rem 0 0;
		font-size: 0.95rem;
		line-height: 1.65;
	}

	.footer-links {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 2rem;
	}

	.footer-links section {
		display: flex;
		align-items: flex-start;
		flex-direction: column;
		gap: 0.7rem;
	}

	.footer-links h2 {
		margin: 0 0 0.35rem;
		color: var(--docs-text);
		font-family: var(--docs-font-heading);
		font-size: 0.88rem;
		font-weight: 650;
		letter-spacing: 0.01em;
	}

	.footer-links a {
		color: var(--docs-text-muted);
		font-size: 0.88rem;
		text-decoration: none;
	}

	.footer-links a:hover {
		color: var(--docs-accent-text);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.footer-meta {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 1.5rem;
		border-top: 1px solid color-mix(in srgb, var(--docs-border) 60%, transparent);
		font: 500 var(--docs-type-xs) / 1.4 var(--docs-font-mono);
	}

	.footer-meta p {
		margin: 0;
	}

	.footer-meta a {
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 820px) {
		.site-footer {
			padding-inline: 1.25rem;
		}

		.footer-inner {
			grid-template-columns: 1fr;
			gap: 2.5rem;
		}
	}

	@media (max-width: 560px) {
		.footer-links {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			row-gap: 2.5rem;
		}

		.footer-links section:last-child {
			grid-column: 1 / -1;
		}

		.footer-meta {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
