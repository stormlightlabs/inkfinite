import {
	createId,
	ShapeRecord,
	type ContainerShape,
	type Document,
	type ShapeMetadata,
	type ShapeRecord as Shape
} from './model';
import { creationStylePolicy, type CanvasAppearance } from './style-policy';

/** User-editable fields carried by a card container. */
export type CardFields = {
	title: string;
	body: string;
	role?: string | null;
	tags?: string[];
	source?: string | null;
	link?: string | null;
	customMetadata?: Record<string, unknown>;
};

/** A card's content projected as an ordinary title/body object. */
export type ContentObject = CardFields & {
	role: string | null;
	tags: string[];
	source: string | null;
	link: string | null;
	customMetadata: Record<string, unknown>;
};

/** Creates the metadata stored on a card's ordinary container record. */
export function cardMetadata(fields: CardFields): ShapeMetadata {
	return {
		name: fields.title || null,
		title: fields.title,
		role: fields.role ?? null,
		description: fields.body || null,
		body: fields.body,
		tags: [...(fields.tags ?? [])],
		source: fields.source ?? null,
		link: fields.link ?? null,
		customMetadata: { ...(fields.customMetadata ?? {}) },
		locked: false,
		agentEditable: true
	};
}

/**
 * Creates a card from ordinary container, text, and Markdown records.
 * The child records use the container's ID as their parent so the native
 * hierarchy preserves movement, selection, ordering, and export.
 */
export function createCardShapes(
	pageId: string,
	x: number,
	y: number,
	fields: CardFields,
	id = createId('shape'),
	appearance: CanvasAppearance = 'light'
): Shape[] {
	const styles = creationStylePolicy(appearance);
	const container = ShapeRecord.createContainer(
		pageId,
		x,
		y,
		{ w: 320, h: 220, ...styles.card.container },
		id
	);
	const title = ShapeRecord.createText(pageId, x + 16, y + 16, {
		text: fields.title,
		...styles.card.title,
		w: 288
	});
	const body = ShapeRecord.createMarkdown(pageId, x + 16, y + 58, {
		md: fields.body,
		w: 288,
		h: 140,
		...styles.card.body
	});
	const children = [
		{ ...title, groupId: container.id },
		{ ...body, groupId: container.id }
	];
	return [{ ...container, metadata: cardMetadata(fields) }, ...children];
}

/** Returns card fields from a container, or `null` for another frame. */
export function cardToContentObject(shape: Shape, document?: Document): ContentObject | null {
	if (shape.type !== 'container' || !shape.metadata) return null;
	const metadata = shape.metadata;
	if (metadata.title === null && metadata.body === null) return null;
	const children = document ? cardChildren(shape, document) : [];
	const titleChild = children.find((child) => child.type === 'text');
	const bodyChild = children.find((child) => child.type === 'markdown');
	return {
		title: titleChild?.type === 'text' ? titleChild.props.text : (metadata.title ?? metadata.name ?? ''),
		body: bodyChild?.type === 'markdown' ? bodyChild.props.md : (metadata.body ?? metadata.description ?? ''),
		role: metadata.role,
		tags: [...metadata.tags],
		source: metadata.source,
		link: metadata.link,
		customMetadata: { ...metadata.customMetadata }
	};
}

/** Returns the ordinary title and body records that make up a card. */
export function cardChildren(shape: ContainerShape, document: Document): Shape[] {
	return Object.values(document.shapes)
		.filter((candidate) => candidate.groupId === shape.id)
		.sort(
			(left, right) =>
				document.pages[left.pageId]?.shapeIds.indexOf(left.id) -
				document.pages[right.pageId]?.shapeIds.indexOf(right.id)
		);
}

/** Converts an ordinary content object into an editable card composition. */
export function contentObjectToCard(pageId: string, at: { x: number; y: number }, content: CardFields): Shape[] {
	return createCardShapes(pageId, at.x, at.y, content);
}
