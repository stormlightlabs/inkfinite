import {
	canBooleanPathSelection,
	canClipSelection,
	canTextPathSelection,
	cardChildren,
	getSelectedShapes,
	type ArrowShape,
	type EditorShapeRecord,
	type EditorState,
	type ImportedAsset,
	type PaintValue,
	type ShapeMetadata,
	type TextShape,
	type MarkdownShape
} from '@inkfinite/core';

export type InspectorValue<T> = { value: T; mixed: boolean };

export type SelectionInspectorState = {
	selectedShapes: EditorShapeRecord[];
	selectionCount: number;
	semanticMetadata: ShapeMetadata[];
	semanticTarget?: ShapeMetadata;
	semanticNameState: InspectorValue<string>;
	semanticRoleState: InspectorValue<string>;
	semanticTagsState: InspectorValue<string>;
	semanticDescriptionState: InspectorValue<string>;
	semanticSourceState: InspectorValue<string>;
	semanticLinkState: InspectorValue<string>;
	semanticCustomMetadataState: InspectorValue<string>;
	fillTargets: EditorShapeRecord[];
	strokeTargets: EditorShapeRecord[];
	fillOpacityTargets: EditorShapeRecord[];
	strokeOpacityTargets: EditorShapeRecord[];
	textTargets: Array<TextShape | MarkdownShape>;
	cardTargets: Array<Extract<EditorShapeRecord, { type: 'container' }>>;
	cardTarget?: Extract<EditorShapeRecord, { type: 'container' }>;
	cardMetadata?: ShapeMetadata;
	typographyTargets: Array<TextShape | MarkdownShape>;
	imageTargets: Array<Extract<EditorShapeRecord, { type: 'image' }>>;
	imageTarget?: Extract<EditorShapeRecord, { type: 'image' }>;
	imageAsset?: ImportedAsset;
	referenceTarget?: Extract<EditorShapeRecord, { type: 'reference' }>;
	frameTarget?: Extract<EditorShapeRecord, { type: 'container' }>;
	arrowTargets: ArrowShape[];
	hasGroupedSelection: boolean;
	allSelectedLocked: boolean;
	booleanPathSelection: boolean;
	clipSelectionAvailable: boolean;
	textPathSelectionAvailable: boolean;
	textPathTarget?: TextShape;
	textPathAttachment?: TextShape['props']['textPath'];
	selectedClipCount: number;
	effectTarget?: EditorShapeRecord;
	fillColorState: InspectorValue<PaintValue>;
	strokeColorState: InspectorValue<PaintValue>;
	opacityState: InspectorValue<number>;
	fillOpacityState: InspectorValue<number>;
	strokeOpacityState: InspectorValue<number>;
	fontSizeState: InspectorValue<number>;
	fontFamilyState: InspectorValue<string>;
	agentEditableState: InspectorValue<boolean>;
};

export function getSharedValue<T>(values: T[]): T | null {
	if (values.length === 0) return null;
	const first = values[0];
	return values.every((value) => Object.is(value, first)) ? first : null;
}

export function getSharedPaintValue(values: Array<PaintValue | null>): PaintValue | null {
	if (values.length === 0) return null;
	const first = JSON.stringify(values[0]);
	return values.every((value) => JSON.stringify(value) === first) ? values[0] : null;
}

export function getNumericState(values: number[]): InspectorValue<number> {
	const shared = getSharedValue(values);
	return { value: shared ?? 1, mixed: values.length > 1 && shared === null };
}

export function getTextState(values: string[]): InspectorValue<string> {
	const shared = getSharedValue(values);
	return { value: shared ?? '', mixed: values.length > 1 && shared === null };
}

export function getBooleanState(values: boolean[]): InspectorValue<boolean> {
	const shared = getSharedValue(values);
	return { value: shared ?? true, mixed: values.length > 1 && shared === null };
}

export function shapeSupportsFill(shape: EditorShapeRecord): boolean {
	return ['rect', 'ellipse', 'text', 'path', 'markdown', 'container'].includes(shape.type);
}

export function shapeSupportsStroke(shape: EditorShapeRecord): boolean {
	return [
		'rect',
		'ellipse',
		'line',
		'arrow',
		'stroke',
		'markdown',
		'path',
		'container'
	].includes(shape.type);
}

export function shapeSupportsFillOpacity(shape: EditorShapeRecord): boolean {
	return ['rect', 'ellipse', 'text', 'markdown', 'path', 'image', 'container'].includes(
		shape.type
	);
}

export function shapeSupportsStrokeOpacity(shape: EditorShapeRecord): boolean {
	return [
		'rect',
		'ellipse',
		'line',
		'arrow',
		'stroke',
		'markdown',
		'path',
		'container'
	].includes(shape.type);
}

export function getFillPaint(shape: EditorShapeRecord): PaintValue | null {
	switch (shape.type) {
		case 'text':
			return shape.props.color;
		case 'rect':
		case 'ellipse':
		case 'path':
		case 'container':
			return shape.props.fill ?? null;
		case 'markdown':
			return shape.props.bg ?? null;
		default:
			return null;
	}
}

export function getStrokePaint(shape: EditorShapeRecord): PaintValue | null {
	switch (shape.type) {
		case 'arrow':
			return shape.props.style.stroke;
		case 'stroke':
			return shape.props.style.color;
		case 'rect':
		case 'ellipse':
		case 'line':
		case 'path':
		case 'container':
			return shape.props.stroke ?? null;
		case 'markdown':
			return shape.props.border ?? null;
		default:
			return null;
	}
}

export function getSelectionInspectorState(state: EditorState): SelectionInspectorState {
	const selectedShapes = getSelectedShapes(state);
	const selectionCount = selectedShapes.length;
	const semanticMetadata = selectedShapes.map(
		(shape) => shape.metadata ?? defaultMetadata(shape)
	);
	const semanticTarget = selectionCount === 1 ? semanticMetadata[0] : undefined;
	const cardTargets = selectedShapes.filter(
		(shape): shape is Extract<EditorShapeRecord, { type: 'container' }> =>
			shape.type === 'container' && shape.metadata?.title != null
	);
	const cardTarget = cardTargets.length === 1 ? cardTargets[0] : undefined;
	const textTargets = selectedShapes.filter(
		(shape): shape is TextShape | MarkdownShape =>
			shape.type === 'text' || shape.type === 'markdown'
	);
	const typographyTargets = [...textTargets];
	for (const card of cardTargets)
		typographyTargets.push(
			...cardChildren(card, state.doc).filter(
				(shape): shape is TextShape | MarkdownShape =>
					shape.type === 'text' || shape.type === 'markdown'
			)
		);
	const imageTargets = selectedShapes.filter(
		(shape): shape is Extract<EditorShapeRecord, { type: 'image' }> => shape.type === 'image'
	);
	const imageTarget = imageTargets.length === 1 ? imageTargets[0] : undefined;
	const textPathTarget =
		selectedShapes.length === 1 &&
		selectedShapes[0]?.type === 'text' &&
		selectedShapes[0].props.textPath
			? selectedShapes[0]
			: undefined;
	const fillTargets = selectedShapes.filter(shapeSupportsFill);
	const strokeTargets = selectedShapes.filter(shapeSupportsStroke);
	const fillOpacityTargets = selectedShapes.filter(shapeSupportsFillOpacity);
	const strokeOpacityTargets = selectedShapes.filter(shapeSupportsStrokeOpacity);
	const arrowTargets = selectedShapes.filter(
		(shape): shape is ArrowShape => shape.type === 'arrow'
	);
	const fillColor = getSharedPaintValue(fillTargets.map(getFillPaint));
	const strokeColor = getSharedPaintValue(strokeTargets.map(getStrokePaint));

	return {
		selectedShapes,
		selectionCount,
		semanticMetadata,
		semanticTarget,
		semanticNameState: getTextState(semanticMetadata.map((metadata) => metadata.name ?? '')),
		semanticRoleState: getTextState(semanticMetadata.map((metadata) => metadata.role ?? '')),
		semanticTagsState: getTextState(
			semanticMetadata.map((metadata) => metadata.tags.join(', '))
		),
		semanticDescriptionState: getTextState(
			semanticMetadata.map((metadata) => metadata.description ?? '')
		),
		semanticSourceState: getTextState(
			semanticMetadata.map((metadata) => metadata.source ?? '')
		),
		semanticLinkState: getTextState(semanticMetadata.map((metadata) => metadata.link ?? '')),
		semanticCustomMetadataState: getTextState(
			semanticMetadata.map((metadata) => JSON.stringify(metadata.customMetadata))
		),
		fillTargets,
		strokeTargets,
		fillOpacityTargets,
		strokeOpacityTargets,
		textTargets,
		cardTargets,
		cardTarget,
		cardMetadata: cardTarget?.metadata,
		typographyTargets,
		imageTargets,
		imageTarget,
		imageAsset: imageTarget ? state.doc.assets?.[imageTarget.props.assetId] : undefined,
		referenceTarget:
			selectionCount === 1 && selectedShapes[0]?.type === 'reference'
				? selectedShapes[0]
				: undefined,
		frameTarget:
			selectionCount === 1 && selectedShapes[0]?.type === 'container'
				? selectedShapes[0]
				: undefined,
		arrowTargets,
		hasGroupedSelection: selectedShapes.some(
			(shape) => Boolean(shape.groupId) || shape.type === 'container'
		),
		allSelectedLocked: selectionCount > 0 && selectedShapes.every((shape) => shape.locked),
		booleanPathSelection: canBooleanPathSelection(state),
		clipSelectionAvailable: canClipSelection(state),
		textPathSelectionAvailable: canTextPathSelection(state),
		textPathTarget,
		textPathAttachment: textPathTarget?.props.textPath,
		selectedClipCount: selectedShapes.filter((shape) =>
			Boolean('clipPath' in shape.props && shape.props.clipPath)
		).length,
		effectTarget: selectionCount === 1 ? selectedShapes[0] : undefined,
		fillColorState: {
			value: fillColor ?? '#4a90e2',
			mixed: fillTargets.length > 1 && fillColor === null
		},
		strokeColorState: {
			value: strokeColor ?? '#2e5c8a',
			mixed: strokeTargets.length > 1 && strokeColor === null
		},
		opacityState: getNumericState(selectedShapes.map((shape) => shape.opacity ?? 1)),
		fillOpacityState: getNumericState(
			fillOpacityTargets.map((shape) => shape.fillOpacity ?? 1)
		),
		strokeOpacityState: getNumericState(
			strokeOpacityTargets.map((shape) => shape.strokeOpacity ?? 1)
		),
		fontSizeState: getNumericState(typographyTargets.map((shape) => shape.props.fontSize)),
		fontFamilyState: getTextState(typographyTargets.map((shape) => shape.props.fontFamily)),
		agentEditableState: getBooleanState(
			selectedShapes.map((shape) => shape.agentEditable !== false)
		)
	};
}

function defaultMetadata(shape: EditorShapeRecord): ShapeMetadata {
	return {
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
	};
}
