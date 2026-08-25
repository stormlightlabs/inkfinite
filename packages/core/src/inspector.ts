/** Pure document operations used by selection inspectors and host menus. */
import type { EditorShapeRecord, FilterEffect, PaintValue, ShapeMetadata } from './editor-model';
import type { EditorState } from './reactivity';

/** Applies a shape update to the current selection without creating history. */
export function updateSelectedShapes(
	state: EditorState,
	update: (shape: EditorShapeRecord) => EditorShapeRecord
): EditorState {
	if (state.ui.selectionIds.length === 0) return state;
	const shapes = { ...state.doc.shapes };
	let changed = false;
	for (const id of state.ui.selectionIds) {
		const shape = state.doc.shapes[id];
		if (!shape) continue;
		const next = update(shape);
		if (next === shape) continue;
		shapes[id] = next;
		changed = true;
	}
	return changed ? { ...state, doc: { ...state.doc, shapes } } : state;
}

/** Returns a shape metadata object with defaults for older editor records. */
export function metadataForShape(shape: EditorShapeRecord): ShapeMetadata {
	return (
		shape.metadata ?? {
			name: null,
			title: null,
			role: null,
			description: null,
			body: null,
			tags: [],
			source: null,
			link: null,
			customMetadata: {},
			locked: shape.locked ?? false,
			agentEditable: shape.agentEditable !== false
		}
	);
}

/** Sets fill paint on every selected shape that supports a fill. */
export function setSelectedFillPaint(state: EditorState, paint: PaintValue): EditorState {
	return updateSelectedShapes(state, (shape) => {
		switch (shape.type) {
			case 'text':
				return { ...shape, props: { ...shape.props, color: paint } } as EditorShapeRecord;
			case 'rect':
			case 'ellipse':
			case 'path':
			case 'container':
				return { ...shape, props: { ...shape.props, fill: paint } } as EditorShapeRecord;
			case 'markdown':
				return { ...shape, props: { ...shape.props, bg: paint } } as EditorShapeRecord;
			default:
				return shape;
		}
	});
}

/** Sets stroke paint on every selected shape that supports a stroke. */
export function setSelectedStrokePaint(state: EditorState, paint: PaintValue): EditorState {
	return updateSelectedShapes(state, (shape) => {
		switch (shape.type) {
			case 'arrow':
				return {
					...shape,
					props: { ...shape.props, style: { ...shape.props.style, stroke: paint } }
				} as EditorShapeRecord;
			case 'stroke':
				return {
					...shape,
					props: { ...shape.props, style: { ...shape.props.style, color: paint } }
				} as EditorShapeRecord;
			case 'rect':
			case 'ellipse':
			case 'line':
			case 'path':
			case 'container':
				return { ...shape, props: { ...shape.props, stroke: paint } } as EditorShapeRecord;
			case 'markdown':
				return { ...shape, props: { ...shape.props, border: paint } } as EditorShapeRecord;
			default:
				return shape;
		}
	});
}

/** Sets one of the common opacity fields on the current selection. */
export function setSelectedOpacity(
	state: EditorState,
	field: 'opacity' | 'fillOpacity' | 'strokeOpacity',
	value: number
): EditorState {
	const next = Math.min(1, Math.max(0, value));
	return updateSelectedShapes(state, (shape) => ({ ...shape, [field]: next }) as EditorShapeRecord);
}

/** Sets font size or family on selected text, Markdown, and card text children. */
export function setSelectedTypography(
	state: EditorState,
	field: 'fontSize' | 'fontFamily',
	value: number | string
): EditorState {
	const targetIds = new Set<string>();
	for (const id of state.ui.selectionIds) {
		const shape = state.doc.shapes[id];
		if (!shape) continue;
		if (shape.type === 'text' || shape.type === 'markdown') targetIds.add(id);
		if (shape.type !== 'container' || shape.metadata?.title == null) continue;
		for (const child of Object.values(state.doc.shapes)) {
			if (child.groupId === shape.id && (child.type === 'text' || child.type === 'markdown')) {
				targetIds.add(child.id);
			}
		}
	}
	if (targetIds.size === 0) return state;
	const shapes = { ...state.doc.shapes };
	let changed = false;
	for (const id of targetIds) {
		const shape = shapes[id];
		if (!shape || (shape.type !== 'text' && shape.type !== 'markdown')) continue;
		shapes[id] = { ...shape, props: { ...shape.props, [field]: value } } as EditorShapeRecord;
		changed = true;
	}
	return changed ? { ...state, doc: { ...state.doc, shapes } } : state;
}

/** Updates semantic metadata on every selected shape. */
export function setSelectedMetadata(state: EditorState, fields: Partial<ShapeMetadata>): EditorState {
	return updateSelectedShapes(state, (shape) => {
		const current = metadataForShape(shape);
		return {
			...shape,
			metadata: {
				...current,
				...fields,
				...(fields.tags ? { tags: [...fields.tags] } : {}),
				...(fields.customMetadata ? { customMetadata: { ...fields.customMetadata } } : {})
			}
		} as EditorShapeRecord;
	});
}

/** Updates a card container and mirrors title/body changes to its text children. */
export function setSelectedCardFields(
	state: EditorState,
	fields: Partial<Pick<ShapeMetadata, 'title' | 'body'>>
): EditorState {
	const cards = state.ui.selectionIds
		.map((id) => state.doc.shapes[id])
		.filter(
			(shape): shape is Extract<EditorShapeRecord, { type: 'container' }> =>
				shape?.type === 'container' && shape.metadata?.title != null
		);
	const card = cards.length === 1 ? cards[0] : undefined;
	if (!card || !card.metadata) return state;
	const metadata: ShapeMetadata = {
		...card.metadata,
		...fields,
		...(fields.title !== undefined ? { name: fields.title || null, title: fields.title } : {}),
		...(fields.body !== undefined ? { description: fields.body || null, body: fields.body } : {})
	};
	const shapes = { ...state.doc.shapes, [card.id]: { ...card, metadata } };
	for (const shape of Object.values(state.doc.shapes)) {
		if (shape.groupId !== card.id) continue;
		if (fields.title !== undefined && shape.type === 'text') {
			shapes[shape.id] = { ...shape, props: { ...shape.props, text: fields.title ?? '' } };
		}
		if (fields.body !== undefined && shape.type === 'markdown') {
			shapes[shape.id] = { ...shape, props: { ...shape.props, md: fields.body ?? '' } };
		}
	}
	return { ...state, doc: { ...state.doc, shapes } };
}

/** Updates the editable fields of the selected image. */
export function setSelectedImageFields(
	state: EditorState,
	fields: Partial<Extract<EditorShapeRecord, { type: 'image' }>['props']>
): EditorState {
	return updateSelectedShapes(
		state,
		(shape) =>
			(shape.type === 'image' ? { ...shape, props: { ...shape.props, ...fields } } : shape) as EditorShapeRecord
	);
}

/** Updates the editable fields of the selected reference. */
export function setSelectedReferenceFields(
	state: EditorState,
	fields: Partial<Extract<EditorShapeRecord, { type: 'reference' }>['props']>
): EditorState {
	return updateSelectedShapes(
		state,
		(shape) =>
			(shape.type === 'reference'
				? { ...shape, props: { ...shape.props, ...fields } }
				: shape) as EditorShapeRecord
	);
}

/** Updates one text-on-path setting for selected text. */
export function setSelectedTextPathField(
	state: EditorState,
	field: 'align' | 'side' | 'direction',
	value: string
): EditorState {
	return updateSelectedShapes(state, (shape) =>
		shape.type === 'text' && shape.props.textPath
			? ({
					...shape,
					props: { ...shape.props, textPath: { ...shape.props.textPath, [field]: value } }
				} as EditorShapeRecord)
			: shape
	);
}

/** Removes text-on-path attachments from selected text. */
export function detachSelectedTextPath(state: EditorState): EditorState {
	return updateSelectedShapes(
		state,
		(shape) =>
			(shape.type === 'text'
				? { ...shape, props: { ...shape.props, textPath: undefined } }
				: shape) as EditorShapeRecord
	);
}

/** Changes the mask mode on selected shapes that have a mask. */
export function setSelectedMaskMode(state: EditorState, mode: 'alpha' | 'luminance'): EditorState {
	return updateSelectedShapes(state, (shape) =>
		shape.props.maskEffect
			? ({
					...shape,
					props: { ...shape.props, maskEffect: { ...shape.props.maskEffect, mode } }
				} as EditorShapeRecord)
			: shape
	);
}

/** Applies one of the inspector's filter presets to the selection. */
export function setSelectedFilterPreset(state: EditorState, preset: string): EditorState {
	const filter: FilterEffect | undefined =
		preset === 'blur'
			? { primitives: [{ type: 'blur', radius: 4 }] }
			: preset === 'grayscale'
				? { primitives: [{ type: 'grayscale', amount: 1 }] }
				: preset === 'drop_shadow'
					? {
							primitives: [
								{ type: 'drop_shadow', dx: 3, dy: 3, radius: 4, color: '#000000', opacity: 0.35 }
							]
						}
					: undefined;
	return updateSelectedShapes(
		state,
		(shape) => ({ ...shape, props: { ...shape.props, filter } }) as EditorShapeRecord
	);
}

/** Applies a square crop or clears the crop on the single selected image. */
export function setSelectedImageSquareCrop(state: EditorState, square: boolean): EditorState {
	const selected = state.ui.selectionIds.length === 1 ? state.doc.shapes[state.ui.selectionIds[0]] : undefined;
	if (!selected || selected.type !== 'image') return state;
	const ratio = selected.props.w / Math.max(selected.props.h, 1);
	const crop = square
		? ratio > 1
			? { top: 0, right: (1 - 1 / ratio) / 2, bottom: 0, left: (1 - 1 / ratio) / 2 }
			: { top: (1 - ratio) / 2, right: 0, bottom: (1 - ratio) / 2, left: 0 }
		: undefined;
	return {
		...state,
		doc: {
			...state.doc,
			shapes: { ...state.doc.shapes, [selected.id]: { ...selected, props: { ...selected.props, crop } } }
		}
	};
}

/** Enters a selected frame in the editor UI without changing the document. */
export function enterSelectedFrame(state: EditorState, frameId: string): EditorState {
	if (state.doc.shapes[frameId]?.type !== 'container') return state;
	return {
		...state,
		ui: { ...state.ui, containerPath: [...(state.ui.containerPath ?? []), frameId], selectionIds: [] }
	};
}

/** Returns the first primitive name used by an effect preset selector. */
export function filterPresetForShape(shape: EditorShapeRecord | undefined): string {
	return shape?.props.filter?.primitives[0]?.type ?? 'none';
}
