import type {
	EditorTransform as GeneratedEditorTransform,
	PathCurveKind,
	PathTopologyOperation
} from '@inkfinite/bindings/editor';
import type {
	PathFillRule as NativePathFillRule,
	PathGeometry as NativePathGeometry,
	PathHandleMode as NativePathHandleMode,
	PathSegment as NativePathSegment,
	PathSubpath as NativePathSubpath
} from '@inkfinite/bindings/model';
import { v4 } from 'uuid';
import type { Vec2 } from './math';

/**
 * Generate a unique ID with an optional prefix
 * @param prefix - Optional prefix for the ID (e.g., 'shape', 'page', 'binding')
 * @returns A unique ID string (UUID v4 format with prefix)
 */
export function createId(prefix?: string): string {
	const id = v4();
	return prefix ? `${prefix}:${id}` : id;
}

export type PageRecord = {
	id: string;
	name: string;
	/** Flat draw-order projection. Layer order and each layer's shape order are authoritative. */
	shapeIds: string[];
	/** Layer IDs in back-to-front order. */
	layerIds?: string[];
};

export const PageRecord = {
	/**
	 * Create a new page record
	 */
	create(name: string, id?: string): PageRecord {
		return { id: id ?? createId('page'), name, shapeIds: [], layerIds: [] };
	},

	/**
	 * Clone a page record
	 */
	clone(page: PageRecord): PageRecord {
		return {
			id: page.id,
			name: page.name,
			shapeIds: [...page.shapeIds],
			...(page.layerIds ? { layerIds: [...page.layerIds] } : {})
		};
	}
};

/** Ordered visual layer owned by one page. */
export type LayerRecord = {
	id: string;
	pageId: string;
	name: string;
	shapeIds: string[];
	visible: boolean;
	locked: boolean;
	opacity: number;
};

export const LayerRecord = {
	/** Creates an empty, visible layer. */
	create(pageId: string, name = 'Layer', id?: string): LayerRecord {
		return { id: id ?? createId('layer'), pageId, name, shapeIds: [], visible: true, locked: false, opacity: 1 };
	},

	/** Clones a layer without sharing its child-order array. */
	clone(layer: LayerRecord): LayerRecord {
		return { ...layer, shapeIds: [...layer.shapeIds] };
	}
};

export type RectProps = { w: number; h: number; fill: string; stroke: string; radius: number };
export type EllipseProps = { w: number; h: number; fill: string; stroke: string };
export type LineProps = { a: Vec2; b: Vec2; stroke: string; width: number };

/** Fill rule for compound native paths. */
export type PathFillRule = NativePathFillRule;

/** A normalized native path segment. */
export type PathSegment = NativePathSegment;

/** Whether cubic handles at an anchor move together. */
export type PathHandleMode = NativePathHandleMode;

/** Canonical curve type used by topology operations. */
export type { PathCurveKind, PathTopologyOperation };

/** One native path subpath. */
export type PathSubpath = NativePathSubpath;

/** Native path geometry and its compound fill rule. */
export type PathGeometry = NativePathGeometry;

/** Ephemeral reference to one path anchor, identified by its segment destination. */
export type PathAnchorRef = { subpathIndex: number; segmentIndex: number };

/** Ephemeral reference to a rendered path segment and its curve parameter. */
export type PathSegmentRef = PathAnchorRef & { t: number };

/** Ephemeral selection state used by the direct-selection tool. */
export type PathSelection = { pathId: string; anchors: PathAnchorRef[] };

/** A path control handle exposed by the direct-selection tool. */
export type PathControlRef = PathAnchorRef & { control: 'quadratic' | 'control_1' | 'control_2' };

/** Topology operations staged for one path commit. */
export type PathTopologyEdit = { shapeId: string; operations: PathTopologyOperation[] };

/** Native path painting properties stored alongside its geometry. */
export type PathProps = PathGeometry & { fill?: string; stroke?: string; stroke_width?: number };

/**
 * Arrow endpoint binding metadata
 */
export type ArrowEndpoint = { kind: 'free' | 'bound'; bindingId?: string };

/**
 * Arrow style configuration
 */
export type ArrowStyle = { stroke: string; width: number; headStart?: boolean; headEnd?: boolean; dash?: number[] };

/**
 * Arrow routing configuration
 */
export type ArrowRouting = {
	kind: 'straight' | 'curved' | 'orthogonal';
	/** Radius used by orthogonal corners when the renderer supports it. */
	cornerRadius?: number;
	/** Let the renderer choose a route around other shapes. */
	automatic?: boolean;
};

/**
 * Arrow label configuration
 */
export type ArrowLabel = { text: string; align: 'center' | 'start' | 'end'; offset: number };

/**
 * Arrow properties using modern format
 * Modern format: { points, start, end, style, routing?, label? }
 */
export type ArrowProps = {
	points: Vec2[];
	start: ArrowEndpoint;
	end: ArrowEndpoint;
	style: ArrowStyle;
	routing?: ArrowRouting;
	label?: ArrowLabel;
};

export type TextProps = { text: string; fontSize: number; fontFamily: string; color: string; w?: number };

/** Embedded image geometry and the asset it displays. */
export type ImageProps = {
	w: number;
	h: number;
	assetId: string;
	/** Normalized crop inset on each edge, in the range 0..1. */
	crop?: { top: number; right: number; bottom: number; left: number };
};

/** Native frame dimensions and title used for hierarchy selection and overlays. */
export type ContainerProps = {
	w?: number;
	h?: number;
	title?: string;
	fill?: string;
	stroke?: string;
	radius?: number;
};

/**
 * Markdown block properties
 * - md: markdown source text
 * - w: fixed width (required for layout)
 * - h: auto-computed height from layout (optional override)
 * - style: font and color settings
 */
export type MarkdownProps = {
	md: string;
	w: number;
	h?: number;
	fontSize: number;
	fontFamily: string;
	color: string;
	bg?: string;
	border?: string;
};

/**
 * Point with optional pressure value (0-1)
 * Format: [x, y, pressure?]
 */
export type StrokePoint = [number, number, number?];

/**
 * Brush configuration for stroke rendering
 * Maps to perfect-freehand options
 */
export type BrushConfig = {
	size: number;
	thinning: number;
	smoothing: number;
	streamline: number;
	simulatePressure: boolean;
};

/**
 * Style properties for stroke appearance
 */
export type StrokeStyle = { color: string; opacity: number };

/**
 * Properties for freehand stroke shapes
 * Points are in world coordinates
 * Outline and bounds are computed lazily and not persisted
 */
export type StrokeProps = { points: StrokePoint[]; style: StrokeStyle; brush: BrushConfig };

/** Semantic fields shared by native shapes and card containers. */
export type ShapeMetadata = {
	name: string | null;
	title: string | null;
	role: string | null;
	description: string | null;
	body: string | null;
	tags: string[];
	source: string | null;
	link: string | null;
	customMetadata: Record<string, unknown>;
	locked: boolean;
	agentEditable: boolean;
	provenance?: {
		actorId: string;
		origin: 'human' | 'agent' | 'sync' | 'system';
		timestamp: number;
		source: string | null;
	};
};

export type ShapeType =
	| 'rect'
	| 'ellipse'
	| 'line'
	| 'arrow'
	| 'text'
	| 'stroke'
	| 'path'
	| 'markdown'
	| 'image'
	| 'container';

/** Full projected transform shared with the Rust editor projection. */
export type EditorTransform = GeneratedEditorTransform;

export type BaseShape = {
	id: string;
	type: ShapeType;
	pageId: string;
	x: number;
	y: number;
	rot: number;
	/** Full projected transform used to preserve native ancestor composition. */
	editorTransform?: EditorTransform;
	/** Opacity applied to the complete shape; omitted values use `1`. */
	opacity?: number;
	/** Opacity applied only to fills; omitted values use `1`. */
	fillOpacity?: number;
	/** Opacity applied only to strokes; omitted values use `1`. */
	strokeOpacity?: number;
	groupId?: string;
	/** Owning layer assigned when the shape enters an editor document. */
	layerId?: string;
	/** Whether this shape is excluded from selection and editing. */
	locked?: boolean;
	/** Whether an agent may propose or apply edits to this shape; omitted values allow edits. */
	agentEditable?: boolean;
	/** Semantic fields projected from the native record. */
	metadata?: ShapeMetadata;
};
export type RectShape = BaseShape & { type: 'rect'; props: RectProps };
export type EllipseShape = BaseShape & { type: 'ellipse'; props: EllipseProps };
export type LineShape = BaseShape & { type: 'line'; props: LineProps };
export type ArrowShape = BaseShape & { type: 'arrow'; props: ArrowProps };
export type TextShape = BaseShape & { type: 'text'; props: TextProps };
export type ImageShape = BaseShape & { type: 'image'; props: ImageProps };
export type StrokeShape = BaseShape & { type: 'stroke'; props: StrokeProps };
export type PathShape = BaseShape & { type: 'path'; props: PathProps };
export type MarkdownShape = BaseShape & { type: 'markdown'; props: MarkdownProps };
export type ContainerShape = BaseShape & { type: 'container'; props: ContainerProps };

export type ShapeRecord =
	| RectShape
	| EllipseShape
	| LineShape
	| ArrowShape
	| TextShape
	| ImageShape
	| StrokeShape
	| PathShape
	| MarkdownShape
	| ContainerShape;

export const ShapeRecord = {
	/**
	 * Create a rectangle shape
	 */
	createRect(pageId: string, x: number, y: number, properties: RectProps, id?: string): RectShape {
		return { id: id ?? createId('shape'), type: 'rect', pageId, x, y, rot: 0, props: properties };
	},

	/**
	 * Create an ellipse shape
	 */
	createEllipse(pageId: string, x: number, y: number, properties: EllipseProps, id?: string): EllipseShape {
		return { id: id ?? createId('shape'), type: 'ellipse', pageId, x, y, rot: 0, props: properties };
	},

	/**
	 * Create a line shape
	 */
	createLine(pageId: string, x: number, y: number, properties: LineProps, id?: string): LineShape {
		return { id: id ?? createId('shape'), type: 'line', pageId, x, y, rot: 0, props: properties };
	},

	/**
	 * Create an arrow shape
	 */
	createArrow(pageId: string, x: number, y: number, properties: ArrowProps, id?: string): ArrowShape {
		return { id: id ?? createId('shape'), type: 'arrow', pageId, x, y, rot: 0, props: properties };
	},

	/**
	 * Create a text shape
	 */
	createText(pageId: string, x: number, y: number, properties: TextProps, id?: string): TextShape {
		return { id: id ?? createId('shape'), type: 'text', pageId, x, y, rot: 0, props: properties };
	},

	/** Create an image backed by an embedded document asset. */
	createImage(pageId: string, x: number, y: number, properties: ImageProps, id?: string): ImageShape {
		return { id: id ?? createId('shape'), type: 'image', pageId, x, y, rot: 0, props: properties };
	},

	/**
	 * Create a stroke shape
	 */
	createStroke(pageId: string, x: number, y: number, properties: StrokeProps, id?: string): StrokeShape {
		return { id: id ?? createId('shape'), type: 'stroke', pageId, x, y, rot: 0, props: properties };
	},

	/** Create a native path shape. */
	createPath(pageId: string, x: number, y: number, properties: PathProps, id?: string): PathShape {
		return { id: id ?? createId('shape'), type: 'path', pageId, x, y, rot: 0, props: properties };
	},

	/**
	 * Create a markdown block shape
	 */
	createMarkdown(pageId: string, x: number, y: number, properties: MarkdownProps, id?: string): MarkdownShape {
		return { id: id ?? createId('shape'), type: 'markdown', pageId, x, y, rot: 0, props: properties };
	},

	/** Create a selectable native container. */
	createContainer(pageId: string, x: number, y: number, properties: ContainerProps, id?: string): ContainerShape {
		return { id: id ?? createId('shape'), type: 'container', pageId, x, y, rot: 0, props: properties };
	},

	/**
	 * Clone a shape record
	 */
	clone(shape: ShapeRecord): ShapeRecord {
		const metadata = shape.metadata
			? {
					...shape.metadata,
					tags: [...shape.metadata.tags],
					customMetadata: { ...shape.metadata.customMetadata },
					...(shape.metadata.provenance ? { provenance: { ...shape.metadata.provenance } } : {})
				}
			: undefined;
		if (shape.type === 'stroke') {
			return {
				...shape,
				...(metadata ? { metadata } : {}),
				props: {
					...shape.props,
					points: shape.props.points.map((p) => [...p] as StrokePoint),
					style: { ...shape.props.style },
					brush: { ...shape.props.brush }
				}
			};
		}
		if (shape.type === 'arrow') {
			if (!Array.isArray(shape.props.points)) {
				return { ...shape, ...(metadata ? { metadata } : {}), props: { ...shape.props } } as ArrowShape;
			}
			return {
				...shape,
				...(metadata ? { metadata } : {}),
				props: {
					points: shape.props.points.map((p) => ({ ...p })),
					start: { ...shape.props.start },
					end: { ...shape.props.end },
					style: {
						...shape.props.style,
						dash: shape.props.style.dash ? [...shape.props.style.dash] : undefined
					},
					routing: shape.props.routing ? { ...shape.props.routing } : undefined,
					label: shape.props.label ? { ...shape.props.label } : undefined
				}
			};
		}
		if (shape.type === 'markdown') {
			return { ...shape, ...(metadata ? { metadata } : {}), props: { ...shape.props } };
		}
		if (shape.type === 'image') {
			return {
				...shape,
				...(metadata ? { metadata } : {}),
				props: { ...shape.props, crop: shape.props.crop ? { ...shape.props.crop } : undefined }
			};
		}
		if (shape.type === 'path') {
			return {
				...shape,
				...(metadata ? { metadata } : {}),
				props: {
					...shape.props,
					subpaths: shape.props.subpaths.map((subpath) => ({
						...subpath,
						handle_modes: subpath.handle_modes ? [...subpath.handle_modes] : subpath.handle_modes,
						segments: subpath.segments.map((segment) => ({
							...segment,
							to: { ...segment.to },
							...('control' in segment ? { control: { ...segment.control } } : {}),
							...('control_1' in segment
								? { control_1: { ...segment.control_1 }, control_2: { ...segment.control_2 } }
								: {})
						}))
					}))
				}
			} as PathShape;
		}
		return { ...shape, ...(metadata ? { metadata } : {}), props: { ...shape.props } } as ShapeRecord;
	}
};

export type BindingType = 'arrow-end';
export type BindingHandle = 'start' | 'end';

/**
 * Binding anchor configuration
 * - center: bind to shape center
 * - edge: bind to shape edge with normalized coordinates (nx, ny in [-1, 1])
 */
export type BindingAnchor = { kind: 'center' } | { kind: 'edge'; nx: number; ny: number };

export type BindingRecord = {
	id: string;
	type: BindingType;
	fromShapeId: string;
	toShapeId: string;
	handle: BindingHandle;
	anchor: BindingAnchor;
};

export const BindingRecord = {
	/**
	 * Create a binding record for arrow endpoints
	 */
	create(
		fromShapeId: string,
		toShapeId: string,
		handle: BindingHandle,
		anchor?: BindingAnchor,
		id?: string
	): BindingRecord {
		if (!anchor) {
			anchor = { kind: 'center' };
		}
		return { id: id ?? createId('binding'), type: 'arrow-end', fromShapeId, toShapeId, handle, anchor };
	},

	/**
	 * Clone a binding record
	 */
	clone(binding: BindingRecord): BindingRecord {
		return { ...binding, anchor: binding.anchor.kind === 'edge' ? { ...binding.anchor } : { kind: 'center' } };
	}
};

/** A retained binary asset imported from an external document. */
export type ImportedAsset = { id: string; name: string; mediaType: string; digest: string; bytes: number[] };

export type Document = {
	pages: Record<string, PageRecord>;
	/** Layers indexed by stable ID. */
	layers?: Record<string, LayerRecord>;
	/** Binary assets retained by interchange imports. */
	assets?: Record<string, ImportedAsset>;
	shapes: Record<string, ShapeRecord>;
	bindings: Record<string, BindingRecord>;
};

export const Document = {
	/**
	 * Create an empty document
	 */
	create(): Document {
		return { pages: {}, layers: {}, shapes: {}, bindings: {} };
	},

	/**
	 * Clone a document
	 */
	clone(document: Document): Document {
		return {
			pages: Object.fromEntries(Object.entries(document.pages).map(([id, page]) => [id, PageRecord.clone(page)])),
			...(document.layers
				? {
						layers: Object.fromEntries(
							Object.entries(document.layers).map(([id, layer]) => [id, LayerRecord.clone(layer)])
						)
					}
				: {}),
			...(document.assets
				? {
						assets: Object.fromEntries(
							Object.entries(document.assets).map(([id, asset]) => [
								id,
								{ ...asset, bytes: [...asset.bytes] }
							])
						)
					}
				: {}),
			shapes: Object.fromEntries(
				Object.entries(document.shapes).map(([id, shape]) => [id, ShapeRecord.clone(shape)])
			),
			bindings: Object.fromEntries(
				Object.entries(document.bindings).map(([id, binding]) => [id, BindingRecord.clone(binding)])
			)
		};
	}
};

/**
 * Ensures every page has a valid layer structure for the editor.
 *
 * Normalization is deterministic and idempotent. Existing flat shape order is
 * preserved exactly in a stable default layer, while layered documents retain
 * their layer and child order.
 */
export function ensureDocumentLayers(document: Document): Document {
	const pages = Object.fromEntries(Object.entries(document.pages).map(([id, page]) => [id, PageRecord.clone(page)]));
	const layers = Object.fromEntries(
		Object.entries(document.layers ?? {}).map(([id, layer]) => [id, LayerRecord.clone(layer)])
	);
	const shapes = Object.fromEntries(
		Object.entries(document.shapes).map(([id, shape]) => [id, ShapeRecord.clone(shape)])
	);

	for (const page of Object.values(pages)) {
		const ownedLayerIds = (page.layerIds ?? []).filter((id) => layers[id]?.pageId === page.id);
		const layerIds = ownedLayerIds.length > 0 ? ownedLayerIds : [`layer:${page.id}:default`];
		if (ownedLayerIds.length === 0) {
			const id = layerIds[0];
			layers[id] = {
				id,
				pageId: page.id,
				name: 'Default',
				shapeIds: [...page.shapeIds],
				visible: true,
				locked: false,
				opacity: 1
			};
		}

		const fallbackId = layerIds[0];
		const ordered = page.shapeIds.filter((id) => shapes[id]?.pageId === page.id);
		const seen = new Set<string>();
		for (const layerId of layerIds) {
			const layer = layers[layerId];
			layer.opacity = Math.max(0, Math.min(1, Number.isFinite(layer.opacity) ? layer.opacity : 1));
			layer.shapeIds = layer.shapeIds.filter((shapeId) => {
				const shape = shapes[shapeId];
				if (!shape || shape.pageId !== page.id || seen.has(shapeId)) return false;
				seen.add(shapeId);
				shape.layerId = layerId;
				return true;
			});
		}
		for (const shapeId of ordered) {
			if (seen.has(shapeId)) continue;
			const requestedLayerId = shapes[shapeId].layerId;
			const destinationId =
				requestedLayerId && layerIds.includes(requestedLayerId) ? requestedLayerId : fallbackId;
			layers[destinationId].shapeIds.push(shapeId);
			shapes[shapeId].layerId = destinationId;
			seen.add(shapeId);
		}
		for (const shape of Object.values(shapes)) {
			if (shape.pageId !== page.id || seen.has(shape.id)) continue;
			layers[fallbackId].shapeIds.push(shape.id);
			shape.layerId = fallbackId;
			seen.add(shape.id);
		}
		page.layerIds = layerIds;
		page.shapeIds = layerIds.flatMap((id) => layers[id].shapeIds);
	}

	return { ...document, pages, layers, shapes };
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Validate a document for consistency and referential integrity
 * @param doc - The document to validate
 * @returns ValidationResult with ok status and any errors found
 */
export function validateDoc(document: Document): ValidationResult {
	const errors: string[] = [];

	if (Object.keys(document.pages).length === 0 && Object.keys(document.shapes).length > 0) {
		errors.push('Document has shapes but no pages');
	}

	for (const [shapeId, shape] of Object.entries(document.shapes)) {
		if (shape.id !== shapeId) {
			errors.push(`Shape key '${shapeId}' does not match shape.id '${shape.id}'`);
		}

		if (!document.pages[shape.pageId]) {
			errors.push(`Shape '${shapeId}' references non-existent page '${shape.pageId}'`);
		}

		const page = document.pages[shape.pageId];
		if (page && !page.shapeIds.includes(shapeId)) {
			errors.push(`Shape '${shapeId}' not listed in page '${shape.pageId}' shapeIds`);
		}

		for (const [name, value] of [
			['opacity', shape.opacity],
			['fill opacity', shape.fillOpacity],
			['stroke opacity', shape.strokeOpacity]
		] as const) {
			if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
				errors.push(`Shape '${shapeId}' has invalid ${name}`);
			}
		}

		switch (shape.type) {
			case 'rect': {
				if (shape.props.w < 0) errors.push(`Rect shape '${shapeId}' has negative width`);
				if (shape.props.h < 0) errors.push(`Rect shape '${shapeId}' has negative height`);
				if (shape.props.radius < 0) errors.push(`Rect shape '${shapeId}' has negative radius`);

				break;
			}
			case 'ellipse': {
				if (shape.props.w < 0) errors.push(`Ellipse shape '${shapeId}' has negative width`);
				if (shape.props.h < 0) errors.push(`Ellipse shape '${shapeId}' has negative height`);

				break;
			}
			case 'line': {
				if (shape.props.width < 0) errors.push(`Line shape '${shapeId}' has negative width`);

				break;
			}
			case 'arrow': {
				const props = shape.props;

				if (!props.points || props.points.length < 2) {
					errors.push(`Arrow shape '${shapeId}' points array must have at least 2 points`);
				}
				if (!props.style) {
					errors.push(`Arrow shape '${shapeId}' missing style`);
				} else if (props.style.width < 0) {
					errors.push(`Arrow shape '${shapeId}' has negative width in style`);
				}
				if (props.routing) {
					if (props.routing.cornerRadius !== undefined && props.routing.cornerRadius < 0) {
						errors.push(`Arrow shape '${shapeId}' has negative cornerRadius`);
					}
				}
				if (props.label) {
					if (!['center', 'start', 'end'].includes(props.label.align)) {
						errors.push(`Arrow shape '${shapeId}' has invalid label alignment`);
					}
				}

				break;
			}
			case 'text': {
				if (shape.props.fontSize <= 0) errors.push(`Text shape '${shapeId}' has invalid fontSize`);
				if (shape.props.w !== undefined && shape.props.w < 0) {
					errors.push(`Text shape '${shapeId}' has negative width`);
				}

				break;
			}
			case 'stroke': {
				if (shape.props.points.length < 2) {
					errors.push(`Stroke shape '${shapeId}' has fewer than 2 points`);
				}
				if (shape.props.brush.size <= 0) {
					errors.push(`Stroke shape '${shapeId}' has invalid brush size`);
				}
				if (
					!Number.isFinite(shape.props.style.opacity) ||
					shape.props.style.opacity < 0 ||
					shape.props.style.opacity > 1
				) {
					errors.push(`Stroke shape '${shapeId}' has invalid opacity`);
				}

				break;
			}
			case 'path': {
				if (shape.props.subpaths.length === 0) {
					errors.push(`Path shape '${shapeId}' has no subpaths`);
				}
				if (shape.props.fill_rule !== 'nonzero' && shape.props.fill_rule !== 'evenodd') {
					errors.push(`Path shape '${shapeId}' has an invalid fill rule`);
				}
				for (const [subpathIndex, subpath] of shape.props.subpaths.entries()) {
					if (subpath.segments.length === 0 || subpath.segments[0]?.type !== 'move') {
						errors.push(`Path shape '${shapeId}' subpath ${subpathIndex} must begin with a move`);
					}
					if (subpath.segments.slice(1).some((segment) => segment.type === 'move')) {
						errors.push(`Path shape '${shapeId}' subpath ${subpathIndex} has a later move`);
					}
				}
				if (shape.props.stroke_width !== undefined && shape.props.stroke_width < 0) {
					errors.push(`Path shape '${shapeId}' has negative stroke width`);
				}
				break;
			}
			case 'image': {
				if (!document.assets?.[shape.props.assetId]) {
					errors.push(`Image shape '${shapeId}' references missing asset '${shape.props.assetId}'`);
				}
				if (shape.props.w < 0 || shape.props.h < 0) {
					errors.push(`Image shape '${shapeId}' has negative dimensions`);
				}
				if (shape.props.crop) {
					for (const [edge, value] of Object.entries(shape.props.crop)) {
						if (!Number.isFinite(value) || value < 0 || value > 1) {
							errors.push(`Image shape '${shapeId}' has invalid ${edge} crop`);
						}
					}
				}
				break;
			}
			case 'markdown': {
				if (shape.props.fontSize <= 0) {
					errors.push(`Markdown shape '${shapeId}' has invalid fontSize`);
				}
				if (shape.props.w <= 0) {
					errors.push(`Markdown shape '${shapeId}' has invalid width`);
				}
				if (shape.props.h !== undefined && shape.props.h <= 0) {
					errors.push(`Markdown shape '${shapeId}' has invalid height`);
				}

				break;
			}
			case 'container': {
				if (shape.props.w !== undefined && shape.props.w < 0)
					errors.push(`Container shape '${shapeId}' has negative width`);
				if (shape.props.h !== undefined && shape.props.h < 0)
					errors.push(`Container shape '${shapeId}' has negative height`);
				break;
			}
		}
	}

	for (const [pageId, page] of Object.entries(document.pages)) {
		if (page.id !== pageId) {
			errors.push(`Page key '${pageId}' does not match page.id '${page.id}'`);
		}

		for (const shapeId of page.shapeIds) {
			if (!document.shapes[shapeId]) {
				errors.push(`Page '${pageId}' references non-existent shape '${shapeId}'`);
			}
		}

		const uniqueIds = new Set(page.shapeIds);
		if (uniqueIds.size !== page.shapeIds.length) {
			errors.push(`Page '${pageId}' has duplicate shape IDs`);
		}
	}

	for (const [bindingId, binding] of Object.entries(document.bindings)) {
		if (binding.id !== bindingId) {
			errors.push(`Binding key '${bindingId}' does not match binding.id '${binding.id}'`);
		}

		const fromShape = document.shapes[binding.fromShapeId];
		if (!fromShape) {
			errors.push(`Binding '${bindingId}' references non-existent fromShape '${binding.fromShapeId}'`);
		} else if (fromShape.type !== 'arrow') {
			errors.push(`Binding '${bindingId}' fromShape '${binding.fromShapeId}' is not an arrow`);
		}

		if (!document.shapes[binding.toShapeId]) {
			errors.push(`Binding '${bindingId}' references non-existent toShape '${binding.toShapeId}'`);
		}

		if (binding.handle !== 'start' && binding.handle !== 'end') {
			errors.push(`Binding '${bindingId}' has invalid handle '${binding.handle}'`);
		}

		if (binding.anchor.kind === 'edge') {
			if (binding.anchor.nx < -1 || binding.anchor.nx > 1) {
				errors.push(`Binding '${bindingId}' has invalid nx '${binding.anchor.nx}' (must be in [-1, 1])`);
			}
			if (binding.anchor.ny < -1 || binding.anchor.ny > 1) {
				errors.push(`Binding '${bindingId}' has invalid ny '${binding.anchor.ny}' (must be in [-1, 1])`);
			}
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	return { ok: true };
}
