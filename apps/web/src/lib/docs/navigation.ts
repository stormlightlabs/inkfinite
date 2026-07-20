/** Metadata for one statically rendered documentation page. */
export type DocsPage = { description: string; href: string; title: string };

/** A labelled group in the documentation sidebar. */
export type DocsGroup = { pages: DocsPage[]; title: string };

/** Canonical documentation pages, independent of their sidebar grouping. */
export const DOCS_MANIFEST: DocsPage[] = [
	{
		title: 'Introduction',
		href: '/docs/introduction/',
		description: 'What Inkfinite is and how the documentation is organized.'
	},
	{
		title: 'Getting started',
		href: '/docs/getting-started/',
		description: 'Install Inkfinite and create a first document.'
	},
	{
		title: 'Documents',
		href: '/docs/concepts/documents/',
		description: 'The durable Inkfinite document model.'
	},
	{
		title: 'Transactions and sync',
		href: '/docs/concepts/transactions-and-sync/',
		description: 'How edits, history, and peer convergence fit together.'
	},
	{
		title: 'Web editor',
		href: '/docs/applications/web/',
		description: 'Run and integrate the browser application.'
	},
	{
		title: 'Desktop editor',
		href: '/docs/applications/desktop/',
		description: 'Build and use the native desktop application.'
	},
	{
		title: 'Command-line interface',
		href: '/docs/reference/cli/',
		description: 'Inspect, change, validate, and render documents.'
	},
	{
		title: 'File format',
		href: '/docs/reference/file-format/',
		description: 'The native .inkfinite format and stable exports.'
	},
	{
		title: 'Agent workflows',
		href: '/docs/reference/agents/',
		description: 'Reviewable document changes for coding agents.'
	}
];

const docsByHref = new Map(DOCS_MANIFEST.map((page) => [page.href, page]));

function docs(...hrefs: string[]): DocsPage[] {
	return hrefs.map((href) => {
		const page = docsByHref.get(href);
		if (!page) throw new Error(`Missing documentation manifest entry for ${href}`);
		return page;
	});
}

/** Sidebar structure assembled from canonical manifest entries. */
export const DOCS_GROUPS: DocsGroup[] = [
	{ title: 'Start here', pages: docs('/docs/introduction/', '/docs/getting-started/') },
	{
		title: 'Concepts',
		pages: docs('/docs/concepts/documents/', '/docs/concepts/transactions-and-sync/')
	},
	{
		title: 'Applications',
		pages: docs('/docs/applications/web/', '/docs/applications/desktop/')
	},
	{
		title: 'Reference',
		pages: docs(
			'/docs/reference/cli/',
			'/docs/reference/file-format/',
			'/docs/reference/agents/'
		)
	}
];

/** Finds the navigation metadata for a documentation pathname. */
export function findDocsPage(pathname: string): DocsPage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return docsByHref.get(normalizedPath);
}
