/**
 * @typedef {Object} HeadingNode
 * @property {string} [type]
 * @property {string} [tagName]
 * @property {Record<string, unknown>} [properties]
 * @property {HeadingNode[]} [children]
 * @property {string} [value]
 */

/** @typedef {{ title: string, slug: string, level: 2 | 3 }} DocHeading */

/** @typedef {{ data: Record<string, unknown> }} MetadataFile */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {HeadingNode} node
 * @returns {string}
 */
function textContent(node) {
	if (typeof node.value === 'string') {
		return node.value;
	}

	return (node.children ?? []).map(textContent).join('');
}

/** @param {string} value */
function slugify(value) {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

/**
 * @param {string} title
 * @param {Set<string>} usedSlugs
 */
function uniqueSlug(title, usedSlugs) {
	const base = slugify(title) || 'section';
	let slug = base;
	let suffix = 1;

	while (usedSlugs.has(slug)) {
		slug = `${base}-${suffix}`;
		suffix += 1;
	}

	usedSlugs.add(slug);
	return slug;
}

/**
 * @param {HeadingNode} node
 * @param {DocHeading[]} headings
 * @param {Set<string>} usedSlugs
 */
function headingsIn(node, headings, usedSlugs) {
	if (node.type === 'element' && (node.tagName === 'h2' || node.tagName === 'h3')) {
		const title = textContent(node).trim();
		if (title !== '') {
			const properties = isRecord(node.properties) ? node.properties : {};
			const existingSlug = properties.id;
			const slug =
				typeof existingSlug === 'string' && existingSlug !== ''
					? existingSlug
					: uniqueSlug(title, usedSlugs);

			properties.id = slug;
			node.properties = properties;
			usedSlugs.add(slug);
			headings.push({ title, slug, level: node.tagName === 'h2' ? 2 : 3 });
		}
	}

	for (const child of node.children ?? []) {
		headingsIn(child, headings, usedSlugs);
	}
}

/** Adds heading IDs and derives each document's table of contents from Markdown headings. */
export function extractTableOfContents() {
	/**
	 * @param {HeadingNode} tree
	 * @param {MetadataFile} file
	 */
	return (tree, file) => {
		const metadata = file.data.fm;
		if (!isRecord(metadata)) {
			return;
		}

		/** @type {DocHeading[]} */
		const toc = [];
		headingsIn(tree, toc, new Set());
		file.data.fm = { ...metadata, toc };
	};
}
