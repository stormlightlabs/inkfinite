import type { Component } from 'svelte';

/** Sidebar sections used to organize the documentation. */
export const docSections = ['Get started', 'Concepts', 'Applications', 'Reference'] as const;
export type DocSection = (typeof docSections)[number];

/** A heading shown in a document's table of contents. */
export type DocHeading = { title: string; slug: string; level: 2 | 3 };

/** Metadata required by every Markdown documentation page. */
export type DocFrontmatter = {
	title: string;
	description: string;
	section: DocSection;
	group: string;
	order: number;
	toc: DocHeading[];
};

/** A rendered documentation page and its source Markdown. */
export type Doc = DocFrontmatter & { slug: string; component: Component; markdown: string };
