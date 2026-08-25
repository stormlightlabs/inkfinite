<script lang="ts">
	import { resolve } from '$app/paths';
	import { getDocs } from '$lib/docs/content';
	import Seo from '$lib/Seo.svelte';
	import { site } from '$lib/site';
	import '$lib/docs/docs.css';
	import SiteFooter from '$lib/docs/SiteFooter.svelte';
	import SiteHeader from '$lib/docs/SiteHeader.svelte';
	import { Icon } from '$ui';

	function resolveDocsPath(path: string): string {
		return (resolve as (route: string) => string)(path);
	}

	const docs = getDocs();
	const landingDocSlugs = [
		'quickstart',
		'guide/editor',
		'guide/import-and-export',
		'platforms/desktop',
		'automation/cli',
		'automation/agents',
		'development/architecture'
	] as const;
	const landingDocs = landingDocSlugs
		.map((slug) => docs.find((doc) => doc.slug === slug))
		.filter((doc): doc is (typeof docs)[number] => doc !== undefined);
</script>

<Seo title={site.title} description={site.description} pathname="/" />

<div class="docs-site">
	<SiteHeader {docs} />
	<main id="main-content">
		<div class="landing-page">
			<section class="hero" data-pagefind-ignore>
				<div class="hero-copy">
					<p class="eyebrow"><span></span>Local-first whiteboard</p>
					<h1>Draw it.</h1>
					<h1>Script it.</h1>
					<h1><em>Infinite possibilities.</em></h1>
					<p class="tagline">
						A local-first infinite canvas for drawing, diagramming, and vector editing,
						with open files and first-class tools for agents.
					</p>
					<div class="hero-actions">
						<a class="primary-action" href={resolve('/app')}>
							Open Inkfinite <Icon name="arrow-right" size={18} />
						</a>
						<a
							class="secondary-action"
							href="https://github.com/stormlightlabs/inkfinite/releases">
							Download desktop <Icon name="github" size={18} />
						</a>
					</div>
					<nav class="quiet-links" aria-label="Project links">
						<a href="https://github.com/stormlightlabs/inkfinite">GitHub</a>
						<span aria-hidden="true">·</span>
						<a href={resolve('/docs/quickstart/')}>Documentation</a>
					</nav>
				</div>

				<div class="product-window" aria-label="Inkfinite editor preview">
					<div class="window-bar">
						<span></span><span></span><span></span><small>diagram.inkfinite</small>
					</div>
					<div class="editor-preview">
						<div class="tool-rail">
							<b><Icon name="select" size={15} /></b>
							<span><Icon name="direct-select" size={15} /></span>
							<span><Icon name="rectangle" size={15} /></span>
							<span><Icon name="ellipse" size={15} /></span>
							<span><Icon name="line" size={15} /></span>
							<span><Icon name="text" size={15} /></span>
							<span><Icon name="pencil" size={15} /></span>
						</div>
						<div class="preview-canvas">
							<div class="canvas-label">One file, every way in</div>
							<svg
								class="diagram-connectors"
								viewBox="0 0 100 100"
								preserveAspectRatio="none"
								aria-hidden="true">
								<defs>
									<marker
										id="diagram-arrowhead"
										viewBox="0 0 7 7"
										refX="6"
										refY="3.5"
										markerWidth="7"
										markerHeight="7"
										orient="auto">
										<path d="M0 0 7 3.5 0 7Z" />
									</marker>
								</defs>
								<path d="M29 39 C43 39 51 51 68 52" />
								<path d="M29 72 C44 72 51 59 68 57" />
								<path d="M56 78 C64 74 62 64 69 60" />
							</svg>
							<div class="diagram-shape source">Draw</div>
							<div class="diagram-shape command">CLI</div>
							<div class="diagram-shape agent-node">Agent</div>
							<div class="diagram-shape selected">
								Inkfinite<i></i><i></i><i></i><i></i>
							</div>
							<div class="preview-cursor">
								<Icon name="select" size={23} /><span>you</span>
							</div>
						</div>
						<aside class="layers-preview">
							<strong>Layers</strong>
							<p>Diagram</p>
							<p>Inkfinite</p>
							<p>Draw</p>
							<p>CLI + Agent</p>
						</aside>
					</div>
				</div>
			</section>

			<section class="proof-strip" aria-label="Project facts">
				<div>
					<strong>Local first</strong><strong>Apache-2.0</strong>
					<strong>Web + desktop + Command-Line</strong>
				</div>
			</section>

			<section class="ways" aria-labelledby="ways-title">
				<header class="section-heading">
					<p class="eyebrow"><span></span> One document model</p>
					<h2 id="ways-title">One canvas, three ways to work.</h2>
				</header>
				<div class="way draw">
					<div class="way-copy">
						<small>01</small>
						<h3>Draw</h3>
						<p>
							Sketch, diagram, annotate, and directly edit vector geometry in the
							browser or desktop app.
						</p>
					</div>
					<div class="drawing-demo" aria-hidden="true">
						<div class="drawing-toolbar">
							<b><Icon name="select" size={14} /></b>
							<span><Icon name="direct-select" size={14} /></span>
							<span><Icon name="rectangle" size={14} /></span>
							<span><Icon name="ellipse" size={14} /></span>
							<span><Icon name="pencil" size={14} /></span>
						</div>
						<svg viewBox="0 0 520 260">
							<path
								class="draw-stroke"
								d="M55 190 C100 55 205 55 245 150 S390 250 462 85" />
							<rect x="280" y="40" width="145" height="85" rx="12" />
							<circle cx="130" cy="103" r="48" />
							<path class="selection" d="M272 31h161v103H272z" />
							<circle class="handle" cx="272" cy="31" r="6" /><circle
								class="handle"
								cx="433"
								cy="31"
								r="6" /><circle class="handle" cx="272" cy="134" r="6" /><circle
								class="handle"
								cx="433"
								cy="134"
								r="6" />
						</svg>
						<div class="draw-cursor">
							<Icon name="select" size={22} /><span>Direct select</span>
						</div>
					</div>
				</div>
				<div class="way script">
					<div class="terminal" aria-label="Inkfinite CLI example">
						<code><b>$</b> inkfinite query --type rect</code><code
							><b>$</b> inkfinite layout align \</code
						><code> --alignment center</code><code class="result"
							>✓ updated 3 shapes</code>
					</div>
					<div class="way-copy">
						<small>02</small>
						<h3>Script</h3>
						<p>
							The CLI reads and changes the document through the same transaction
							engine as the editor.
						</p>
					</div>
				</div>
				<div class="way agent">
					<div class="way-copy">
						<small>03</small>
						<h3>Work with an agent</h3>
						<p>
							Let an agent inspect and propose changes, then review the result on the
							canvas before accepting it.
						</p>
					</div>
					<div class="proposal" aria-hidden="true">
						<div class="proposal-head">
							<span>Agent proposal</span><small>2 edits</small>
						</div>
						<div class="proposal-canvas">
							<div class="proposal-shape before">Before</div>
							<div class="proposal-arrow">→</div>
							<div class="proposal-shape after">Aligned</div>
							<div class="proposal-note">Moved 48 px<br />Aligned centers</div>
						</div>
						<div class="proposal-actions">
							<button tabindex="-1" class="reject">Reject</button><button
								tabindex="-1">Accept changes</button>
						</div>
					</div>
				</div>
			</section>

			<section class="svg-story" aria-labelledby="svg-title">
				<div>
					<p class="eyebrow"><span></span> Vector interoperability</p>
					<h2 id="svg-title">SVGs are documents, not screenshots.</h2>
					<p>
						Import SVG geometry as native paths, edit its nodes, preserve unsupported
						content, and export it again through one validated Rust pipeline.
					</p>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={resolveDocsPath('/docs/development/svg-import/')}>
						How SVG import works <Icon name="arrow-right" size={16} />
					</a>
				</div>
				<div class="svg-flow" aria-label="SVG import, node editing, and export flow">
					<div class="svg-file">
						<code>logo.svg</code><small>12 paths · 3 groups</small>
					</div>
					<div class="svg-editor">
						<div class="svg-editor-bar">
							<span>Direct Select</span><small>Path 4 of 12</small>
						</div>
						<svg viewBox="0 0 300 190" aria-hidden="true">
							<path d="M42 144 C68 41 164 28 252 95 C202 153 120 169 42 144Z" />
							<path class="svg-handle-line" d="M42 144 68 41 252 95" />
							<circle cx="42" cy="144" r="6" /><circle
								cx="68"
								cy="41"
								r="6" /><circle cx="252" cy="95" r="6" />
						</svg>
						<div class="svg-properties">
							<span>Fill <b>#2dcc82</b></span><span>Nodes <b>3</b></span><span
								>Transform <b>matrix</b></span>
						</div>
					</div>
					<div class="svg-steps">
						<span><b>1</b> Import as native paths</span><span
							><b>2</b> Edit nodes and transforms</span
						><span><b>3</b> Export clean SVG</span>
					</div>
				</div>
			</section>

			<section class="open-files" aria-labelledby="files-title">
				<div class="file-tree" aria-label="Inkfinite file structure">
					<strong>design.inkfinite</strong><span>├── pages</span><span>├── layers</span
					><span>├── shapes</span><span>├── bindings</span><span>└── assets</span>
				</div>
				<div>
					<p class="eyebrow"><span></span> Open files</p>
					<h2 id="files-title">Your work lives in a real document.</h2>
					<p>
						The desktop app saves canonical Automerge-backed files. Copy them, version
						them, inspect them, or change them outside the editor.
					</p>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={resolveDocsPath('/docs/concepts/document-model/')}>
						Explore the document model <Icon name="arrow-right" size={16} />
					</a>
				</div>
			</section>

			<section class="open-source" aria-labelledby="source-title">
				<div>
					<p class="eyebrow"><span></span> Open source</p>
					<h2 id="source-title">Built in the open.</h2>
				</div>
				<p>
					Inkfinite combines a TypeScript editor with Rust and WebAssembly document
					machinery, Automerge, a CLI, and a documented file format. The project is
					available under Apache-2.0.
				</p>
				<a class="secondary-action" href="https://github.com/stormlightlabs/inkfinite"
					>View source <Icon name="github" size={18} /></a>
			</section>

			<section class="final-cta" aria-labelledby="final-cta-title">
				<h2 id="final-cta-title">Your canvas doesn't have to be a black box.</h2>
				<nav class="final-docs" aria-label="Documentation sections">
					{#each landingDocs as doc, index (doc.slug)}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a href={resolveDocsPath(`/docs/${doc.slug}/`)}>
							<span class="doc-number">{String(index + 1).padStart(2, '0')}</span>
							<span class="doc-label"
								><small>{doc.section}</small><strong>{doc.title}</strong></span>
							<Icon name="arrow-right" size={17} />
						</a>
					{/each}
				</nav>
				<div>
					<a class="primary-action" href={resolve('/app')}
						>Open Inkfinite <Icon name="arrow-right" size={18} /></a
					><a class="secondary-action" href="https://github.com/stormlightlabs/inkfinite"
						>View source <Icon name="github" size={18} /></a>
				</div>
			</section>
		</div>
	</main>
	<SiteFooter />
</div>

<style>
	.landing-page {
		overflow: hidden;
		background: var(--docs-canvas);
	}
	.hero {
		display: grid;
		grid-template-columns: minmax(0, 0.92fr) minmax(28rem, 1.08fr);
		align-items: center;
		gap: clamp(2rem, 6vw, 7rem);
		min-height: min(48rem, calc(100svh - 4rem));
		padding: clamp(3rem, 7vw, 7rem) max(1.5rem, calc((100vw - 82rem) / 2));
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: var(--docs-space-2);
		margin: 0 0 var(--docs-space-4);
		color: var(--docs-accent-text);
		font-size: var(--docs-type-xs);
		font-weight: 750;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.eyebrow span {
		width: 1.75rem;
		height: 3px;
		background: var(--docs-accent);
		border-radius: 999px;
		transform: rotate(-2deg);
	}
	h1,
	h2,
	h3 {
		color: var(--docs-heading);
		font-family: var(--docs-font-heading);
	}
	h1 {
		max-width: 45rem;
		margin: 0;
		font-size: clamp(3.4rem, 6vw, 6.7rem);
		font-weight: 700;
		letter-spacing: -0.05em;
		line-height: 0.92;
		text-wrap: balance;
	}
	h1 em {
		color: var(--docs-accent-text);
		font-style: normal;
	}
	.tagline {
		max-width: 39rem;
		margin: var(--docs-space-6) 0 0;
		color: var(--docs-text-muted);
		font-size: clamp(1.05rem, 1.5vw, 1.24rem);
		line-height: 1.65;
	}
	.hero-actions,
	.final-cta > div {
		display: flex;
		flex-wrap: wrap;
		gap: var(--docs-space-3);
		margin-top: var(--docs-space-6);
	}
	.primary-action,
	.secondary-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--docs-space-2);
		min-height: 44px;
		padding: var(--docs-space-3) var(--docs-space-5);
		border-radius: var(--docs-radius-wobbly);
		font-size: var(--docs-type-sm);
		font-weight: 700;
		text-decoration: none;
		transition: 180ms var(--docs-ease-out);
	}
	.primary-action {
		color: var(--docs-on-accent);
		background: var(--docs-accent);
		box-shadow: 3px 4px 0 var(--docs-shadow-color);
	}
	.primary-action:hover {
		color: var(--docs-on-accent);
		background: var(--docs-accent-hover);
		translate: -1px -1px;
		box-shadow: 5px 6px 0 var(--docs-shadow-color);
	}
	.secondary-action {
		color: var(--docs-text);
		background: var(--docs-surface-raised);
		box-shadow: inset 0 0 0 1px var(--docs-border);
	}
	.secondary-action:hover {
		color: var(--docs-text);
		background: var(--docs-surface-hover);
		translate: 0 -1px;
	}
	.quiet-links {
		display: flex;
		gap: 0.65rem;
		margin-top: var(--docs-space-5);
		font-size: var(--docs-type-sm);
	}
	.quiet-links span {
		color: var(--docs-border);
	}
	.product-window {
		aspect-ratio: 1.25;
		min-width: 0;
		overflow: hidden;
		background: var(--docs-surface-raised);
		border-radius: 16px 24px 19px 22px;
		box-shadow:
			16px 20px 0 var(--docs-shadow-color),
			0 30px 70px color-mix(in srgb, var(--docs-shadow-color) 22%, transparent);
		transform: rotate(1deg);
	}
	.window-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		height: 2.6rem;
		padding: 0 1rem;
		background: var(--docs-surface);
		border-bottom: 1px solid var(--docs-border);
	}
	.window-bar span {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		background: var(--docs-border);
	}
	.window-bar span:first-child {
		background: var(--docs-danger);
	}
	.window-bar span:nth-child(2) {
		background: var(--docs-warning);
	}
	.window-bar span:nth-child(3) {
		background: var(--docs-accent);
	}
	.window-bar small {
		margin-left: auto;
		color: var(--docs-text-muted);
	}
	.editor-preview {
		display: grid;
		grid-template-columns: 2.6rem 1fr 8rem;
		height: calc(100% - 2.6rem);
	}
	.tool-rail,
	.layers-preview {
		background: var(--docs-surface);
		border-right: 1px solid var(--docs-border);
	}
	.tool-rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		padding: 0.65rem 0.35rem;
	}
	.tool-rail > * {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 5px;
		color: var(--docs-text-muted);
		font-size: 0.66rem;
	}
	.tool-rail b {
		color: var(--docs-on-accent);
		background: var(--docs-accent);
	}
	.preview-canvas {
		position: relative;
		overflow: hidden;
		background-color: var(--docs-canvas);
		background-image: radial-gradient(var(--docs-border) 1px, transparent 1px);
		background-size: 18px 18px;
	}
	.layers-preview {
		padding: 1rem 0.75rem;
		border-right: 0;
		border-left: 1px solid var(--docs-border);
		font-size: 0.65rem;
	}
	.layers-preview p {
		margin: 0.8rem 0;
		color: var(--docs-text-muted);
	}
	.canvas-label {
		position: absolute;
		top: 8%;
		left: 8%;
		color: var(--docs-text-muted);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.diagram-connectors {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		overflow: visible;
		color: var(--docs-text-muted);
		pointer-events: none;
	}
	.diagram-connectors path {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.35;
		stroke-linecap: round;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
		marker-end: url('#diagram-arrowhead');
	}
	.diagram-connectors marker path {
		fill: currentColor;
		stroke: none;
		marker-end: none;
	}
	.diagram-shape {
		position: absolute;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 5.2rem;
		height: 3rem;
		border: 2px solid var(--docs-border-strong);
		border-radius: 8px;
		background: var(--docs-surface-raised);
		box-shadow: 2px 3px 0 var(--docs-shadow-color);
		color: var(--docs-text);
		font-size: 0.68rem;
		font-weight: 700;
	}
	.source {
		top: 26%;
		left: 8%;
		border-color: var(--docs-warning);
	}
	.command {
		bottom: 20%;
		left: 8%;
		border-color: var(--docs-heading);
	}
	.agent-node {
		bottom: 10%;
		left: 35%;
		border-color: var(--docs-danger);
	}
	.selected {
		right: 8%;
		top: 42%;
		width: 6.6rem;
		height: 4rem;
		background: color-mix(in srgb, var(--docs-accent) 16%, var(--docs-surface-raised));
		outline: 2px solid var(--docs-accent);
		outline-offset: 4px;
	}
	.selected i {
		position: absolute;
		width: 7px;
		height: 7px;
		background: var(--docs-surface-raised);
		border: 1px solid var(--docs-accent);
	}
	.selected i:first-child {
		left: -8px;
		top: -8px;
	}
	.selected i:nth-child(2) {
		right: -8px;
		top: -8px;
	}
	.selected i:nth-child(3) {
		left: -8px;
		bottom: -8px;
	}
	.selected i:nth-child(4) {
		right: -8px;
		bottom: -8px;
	}
	.preview-cursor {
		position: absolute;
		top: 36%;
		left: 27%;
		z-index: 4;
		color: var(--docs-accent-text);
		filter: drop-shadow(0 1px var(--docs-canvas));
	}
	.preview-cursor span,
	.draw-cursor span {
		display: block;
		margin: -0.15rem 0 0 0.9rem;
		padding: 0.12rem 0.4rem;
		color: var(--docs-on-accent);
		background: var(--docs-accent);
		border-radius: 3px;
		font-size: 0.55rem;
		font-weight: 700;
	}
	.proof-strip {
		padding: 1.5rem max(1.5rem, calc((100vw - 82rem) / 2));
		color: var(--docs-text);
		background: var(--docs-surface);
		border-block: 1px solid var(--docs-border);
		text-align: center;
	}
	.proof-strip div {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 1rem 3.5rem;
	}
	.proof-strip strong {
		font-size: 0.76rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}
	.ways,
	.svg-story,
	.open-files,
	.open-source,
	.final-cta {
		padding: clamp(5rem, 9vw, 8rem) max(1.5rem, calc((100vw - 76rem) / 2));
	}
	.section-heading {
		max-width: 44rem;
		margin-bottom: clamp(3rem, 6vw, 5rem);
	}
	h2 {
		margin: 0;
		font-size: clamp(2.3rem, 4.6vw, 4.3rem);
		letter-spacing: -0.045em;
		line-height: 1.02;
		text-wrap: balance;
	}
	.way {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: center;
		gap: clamp(2rem, 7vw, 7rem);
		min-height: 21rem;
		padding: clamp(2rem, 5vw, 4rem) 0;
		border-top: 1px solid var(--docs-border);
	}
	.way-copy {
		max-width: 32rem;
	}
	.way-copy small {
		color: var(--docs-accent-text);
		font-weight: 800;
	}
	.way h3 {
		margin: 0.5rem 0 1rem;
		font-size: clamp(2rem, 4vw, 3.6rem);
		letter-spacing: -0.04em;
	}
	.way p,
	.svg-story p,
	.open-files p,
	.open-source > p {
		color: var(--docs-text-muted);
		font-size: 1.05rem;
		line-height: 1.7;
	}
	.drawing-demo {
		position: relative;
		height: 16rem;
		overflow: hidden;
		background-color: var(--docs-surface);
		background-image: radial-gradient(var(--docs-border) 1px, transparent 1px);
		background-size: 18px 18px;
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-panel);
		box-shadow: 7px 9px 0 var(--docs-shadow-color);
	}
	.drawing-demo svg {
		width: 100%;
		height: 100%;
	}
	.drawing-demo svg path:not(.selection),
	.drawing-demo svg rect,
	.drawing-demo svg circle:not(.handle) {
		fill: color-mix(in srgb, var(--docs-accent) 14%, var(--docs-surface-raised));
		stroke: var(--docs-text);
		stroke-width: 4;
	}
	.drawing-demo svg .draw-stroke {
		fill: none;
		stroke: var(--docs-accent);
		stroke-linecap: round;
		stroke-width: 7;
	}
	.drawing-demo svg .selection {
		fill: none;
		stroke: var(--docs-accent);
		stroke-dasharray: 6 4;
		stroke-width: 2;
	}
	.drawing-demo svg .handle {
		fill: var(--docs-canvas);
		stroke: var(--docs-accent);
		stroke-width: 3;
	}
	.drawing-toolbar {
		position: absolute;
		z-index: 2;
		display: flex;
		gap: 0.35rem;
		top: 0.75rem;
		left: 0.75rem;
		padding: 0.35rem;
		background: var(--docs-surface-raised);
		border: 1px solid var(--docs-border);
		border-radius: 7px;
	}
	.drawing-toolbar > * {
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		color: var(--docs-text-muted);
		font-size: 0.62rem;
	}
	.drawing-toolbar b {
		color: var(--docs-on-accent);
		background: var(--docs-accent);
		border-radius: 4px;
	}
	.draw-cursor {
		position: absolute;
		right: 20%;
		bottom: 17%;
		color: var(--docs-accent-text);
	}
	.terminal {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 2rem;
		color: #e7e4dc;
		background: #20231f;
		border-radius: var(--docs-radius-panel);
		box-shadow: 8px 10px 0 var(--docs-shadow-color);
		font-size: 0.82rem;
		overflow: auto;
	}
	.terminal b {
		color: var(--docs-accent);
	}
	.terminal .result {
		color: #9ccd8c;
	}
	.proposal {
		padding: 1.25rem;
		background: var(--docs-surface-raised);
		border: 2px dashed var(--docs-accent);
		border-radius: var(--docs-radius-panel);
		box-shadow: 6px 8px 0 var(--docs-shadow-color);
		transform: rotate(-0.5deg);
	}
	.proposal-head,
	.proposal-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.proposal-head span {
		color: var(--docs-accent-text);
		font-size: 0.75rem;
		font-weight: 800;
	}
	.proposal-head small {
		padding: 0.2rem 0.5rem;
		color: var(--docs-text-muted);
		background: var(--docs-surface);
		border-radius: 999px;
	}
	.proposal-canvas {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.8rem;
		min-height: 9rem;
		margin: 1rem 0;
		padding: 1rem;
		background-color: var(--docs-canvas);
		background-image: radial-gradient(var(--docs-border) 1px, transparent 1px);
		background-size: 16px 16px;
		border-radius: 8px;
	}
	.proposal-shape {
		display: grid;
		place-items: center;
		height: 3.5rem;
		border: 2px solid var(--docs-border-strong);
		border-radius: 7px;
		font-size: 0.7rem;
		font-weight: 700;
	}
	.proposal-shape.before {
		border-style: dashed;
		color: var(--docs-text-muted);
	}
	.proposal-shape.after {
		border-color: var(--docs-accent);
		background: color-mix(in srgb, var(--docs-accent) 16%, var(--docs-surface-raised));
	}
	.proposal-arrow {
		color: var(--docs-accent-text);
		font-size: 1.2rem;
	}
	.proposal-note {
		position: absolute;
		right: 0.8rem;
		bottom: 0.6rem;
		color: var(--docs-text-muted);
		font-size: 0.58rem;
		line-height: 1.4;
		text-align: right;
	}
	.proposal-actions {
		justify-content: flex-end;
	}
	.proposal button {
		padding: 0.6rem 1rem;
		color: var(--docs-on-accent);
		background: var(--docs-accent);
		border: 1px solid var(--docs-accent);
		border-radius: 6px;
		font-weight: 700;
	}
	.proposal button.reject {
		color: var(--docs-text);
		background: transparent;
		border-color: var(--docs-border);
	}
	.svg-story,
	.open-files {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: center;
		gap: clamp(3rem, 8vw, 8rem);
	}
	.svg-story {
		background: var(--docs-surface-raised);
	}
	.svg-story a,
	.open-files a {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 1rem;
		font-weight: 700;
	}
	.svg-flow {
		display: grid;
		grid-template-columns: 1fr 2.25fr;
		gap: 0.9rem;
		padding: 1rem;
		background: var(--docs-canvas);
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-panel);
		box-shadow: 7px 9px 0 var(--docs-shadow-color);
	}
	.svg-file {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.5rem;
		padding: 1rem;
		background: var(--docs-surface);
		border-radius: 8px;
	}
	.svg-file code {
		color: var(--docs-text);
		font-size: 1rem;
	}
	.svg-file small {
		color: var(--docs-text-muted);
	}
	.svg-editor {
		overflow: hidden;
		background: var(--docs-surface);
		border: 2px solid var(--docs-accent);
		border-radius: 8px;
	}
	.svg-editor-bar,
	.svg-properties {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.55rem 0.7rem;
		color: var(--docs-text-muted);
		background: var(--docs-surface-raised);
		font-size: 0.58rem;
	}
	.svg-editor svg {
		display: block;
		width: 100%;
		height: 10rem;
	}
	.svg-editor svg path:first-child {
		fill: color-mix(in srgb, var(--docs-accent) 28%, var(--docs-surface-raised));
		stroke: var(--docs-accent);
		stroke-width: 3;
	}
	.svg-editor svg .svg-handle-line {
		fill: none;
		stroke: var(--docs-accent-text);
		stroke-dasharray: 4 4;
	}
	.svg-editor svg circle {
		fill: var(--docs-canvas);
		stroke: var(--docs-accent);
		stroke-width: 3;
	}
	.svg-properties span {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.svg-properties b {
		color: var(--docs-text);
		font-size: 0.58rem;
	}
	.svg-steps {
		grid-column: 1 / -1;
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.25rem;
	}
	.svg-steps span {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--docs-text-muted);
		font-size: 0.58rem;
	}
	.svg-steps b {
		display: grid;
		place-items: center;
		width: 1.15rem;
		height: 1.15rem;
		color: var(--docs-on-accent);
		background: var(--docs-accent);
		border-radius: 50%;
		font-size: 0.55rem;
	}
	.file-tree {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 2.5rem;
		color: #e7e4dc;
		background: #20231f;
		border-radius: var(--docs-radius-panel);
		box-shadow: 9px 11px 0 var(--docs-shadow-color);
		font-family: monospace;
	}
	.file-tree strong {
		margin-bottom: 0.5rem;
		color: #9ccd8c;
	}
	.open-source {
		display: grid;
		grid-template-columns: 1fr 1.4fr auto;
		align-items: center;
		gap: 3rem;
		background: var(--docs-surface-raised);
	}
	.open-source h2 {
		font-size: clamp(2.2rem, 4vw, 3.5rem);
	}
	.final-cta {
		text-align: center;
	}
	.final-cta h2 {
		max-width: 58rem;
		margin: auto;
	}
	.final-docs {
		max-width: 52rem;
		margin: clamp(3rem, 6vw, 5rem) auto 0;
		border-top: 1px solid var(--docs-border);
		text-align: left;
	}
	.final-docs a {
		display: grid;
		grid-template-columns: 2.5rem 1fr auto;
		gap: 1rem;
		align-items: center;
		padding: 1.15rem 0;
		border-bottom: 1px solid var(--docs-border);
		color: var(--docs-text);
		text-decoration: none;
	}
	.final-docs a:hover {
		color: var(--docs-accent-text);
	}
	.final-docs .doc-number,
	.final-docs :global(svg) {
		color: var(--docs-accent-text);
	}
	.final-docs .doc-number {
		font: 650 0.72rem / 1 var(--docs-font-mono);
	}
	.final-docs .doc-label {
		display: grid;
	}
	.final-docs .doc-label small {
		color: var(--docs-text-muted);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.final-docs .doc-label strong {
		font-family: var(--docs-font-heading);
		font-size: 1.15rem;
	}
	.final-cta > div {
		justify-content: center;
	}
	@media (max-width: 960px) {
		.hero {
			grid-template-columns: 1fr;
			padding-block: 5rem 7rem;
		}
		.product-window {
			width: min(44rem, 94%);
			margin: auto;
		}
		.way,
		.svg-story,
		.open-files {
			grid-template-columns: 1fr;
		}
		.script .terminal {
			order: 2;
		}
		.open-source {
			grid-template-columns: 1fr;
		}
		.open-source .secondary-action {
			justify-self: start;
		}
		.editor-preview {
			grid-template-columns: 2.6rem 1fr 7rem;
		}
	}
	@media (max-width: 600px) {
		.hero {
			padding-top: 4rem;
		}
		h1 {
			font-size: clamp(3rem, 16vw, 4.8rem);
		}
		.product-window {
			width: 100%;
			box-shadow: 8px 10px 0 var(--docs-shadow-color);
		}
		.layers-preview {
			display: none;
		}
		.editor-preview {
			grid-template-columns: 2.4rem 1fr;
		}
		.way {
			min-height: 0;
		}
		.svg-flow {
			padding: 1rem;
		}
		.open-files {
			padding-top: 4rem;
		}
		.open-source {
			gap: 1.5rem;
		}
		.final-docs a {
			grid-template-columns: 2rem 1fr auto;
			gap: 0.65rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.primary-action,
		.secondary-action {
			transition: none;
		}
		.primary-action:hover,
		.secondary-action:hover {
			translate: 0;
		}
	}
</style>
