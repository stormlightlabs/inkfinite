export const site = {
	name: 'Inkfinite',
	title: 'Inkfinite — Draw it. Script it.',
	description:
		'A local-first infinite canvas for drawing, diagramming, and vector editing, with open files and first-class tools for agents.',
	url: 'https://ink.stormlightlabs.org',
	imagePath: '/og.png',
	imageAlt:
		'Inkfinite infinite canvas with editable shapes connected to drawing, CLI, and agent workflows.'
} as const;

/** Returns an absolute public URL for metadata and canonical links. */
export function absoluteUrl(pathname: string): string {
	return new URL(pathname, site.url).toString();
}
