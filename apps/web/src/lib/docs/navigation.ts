/** A heading rendered in a documentation page's table of contents. */
export type DocsHeading = { id: string; title: string };

/** One statically rendered documentation page. */
export type DocsPage = {
	description: string;
	headings: DocsHeading[];
	href: string;
	title: string;
};

/** A labelled group in the documentation sidebar. */
export type DocsGroup = { pages: DocsPage[]; title: string };

/** Sectioned manifest for documentation */
export const DOCS_GROUPS: DocsGroup[] = [
	{
		title: 'Start here',
		pages: [
			{
				title: 'Introduction',
				href: '/docs/',
				description: 'What Inkfinite is and how the documentation is organized.',
				headings: [
					{ id: 'what-is-inkfinite', title: 'What is Inkfinite?' },
					{ id: 'choose-your-path', title: 'Choose your path' },
					{ id: 'project-status', title: 'Project status' }
				]
			},
			{
				title: 'Getting started',
				href: '/docs/getting-started/',
				description: 'Install Inkfinite and create a first document.',
				headings: [
					{ id: 'requirements', title: 'Requirements' },
					{ id: 'installation', title: 'Installation' },
					{ id: 'create-a-document', title: 'Create a document' },
					{ id: 'next-steps', title: 'Next steps' }
				]
			}
		]
	},
	{
		title: 'Concepts',
		pages: [
			{
				title: 'Documents',
				href: '/docs/concepts/documents/',
				description: 'The durable Inkfinite document model.',
				headings: [
					{ id: 'document-structure', title: 'Document structure' },
					{ id: 'shapes-and-layers', title: 'Shapes and layers' },
					{ id: 'persistence', title: 'Persistence' }
				]
			},
			{
				title: 'Transactions and sync',
				href: '/docs/concepts/transactions-and-sync/',
				description: 'How edits, history, and peer convergence fit together.',
				headings: [
					{ id: 'transactions', title: 'Transactions' },
					{ id: 'undo-and-redo', title: 'Undo and redo' },
					{ id: 'synchronization', title: 'Synchronization' }
				]
			}
		]
	},
	{
		title: 'Applications',
		pages: [
			{
				title: 'Web editor',
				href: '/docs/applications/web/',
				description: 'Run and integrate the browser application.',
				headings: [
					{ id: 'run-locally', title: 'Run locally' },
					{ id: 'browser-storage', title: 'Browser storage' },
					{ id: 'deployment', title: 'Deployment' }
				]
			},
			{
				title: 'Desktop editor',
				href: '/docs/applications/desktop/',
				description: 'Build and use the native desktop application.',
				headings: [
					{ id: 'run-locally', title: 'Run locally' },
					{ id: 'document-sessions', title: 'Document sessions' },
					{ id: 'local-control', title: 'Local control' }
				]
			}
		]
	},
	{
		title: 'Reference',
		pages: [
			{
				title: 'Command-line interface',
				href: '/docs/reference/cli/',
				description: 'Inspect, change, validate, and render documents.',
				headings: [
					{ id: 'command-overview', title: 'Command overview' },
					{ id: 'file-mode', title: 'File mode' },
					{ id: 'live-mode', title: 'Live mode' },
					{ id: 'machine-readable-output', title: 'Machine-readable output' }
				]
			},
			{
				title: 'File format',
				href: '/docs/reference/file-format/',
				description: 'The native .inkfinite format and stable exports.',
				headings: [
					{ id: 'native-files', title: 'Native files' },
					{ id: 'versions-and-compatibility', title: 'Versions and compatibility' },
					{ id: 'json-and-svg-exports', title: 'JSON and SVG exports' },
					{ id: 'recovery', title: 'Recovery' }
				]
			},
			{
				title: 'Agent workflows',
				href: '/docs/reference/agents/',
				description: 'Reviewable document changes for coding agents.',
				headings: [
					{ id: 'workflow', title: 'Workflow' },
					{ id: 'proposals', title: 'Proposals' },
					{ id: 'permissions', title: 'Permissions' },
					{ id: 'conflicts', title: 'Conflicts' }
				]
			}
		]
	}
];

export const DOCS_PAGES = DOCS_GROUPS.flatMap((group) => group.pages);

/** Finds the navigation metadata for a documentation pathname. */
export function findDocsPage(pathname: string): DocsPage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return DOCS_PAGES.find((page) => page.href === normalizedPath);
}
