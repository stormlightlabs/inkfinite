import { shapeBounds } from '../geom';
import { clamp, Vec2 } from '../math';
import { BindingRecord, ensureDocumentLayers, ShapeRecord, type ArrowShape, type ShapeRecord as Shape } from '../model';
import type { BoardExport } from '../persistence/document';
import type { InterchangeExport, InterchangeImport } from '../interchange';
import {
	addShape,
	bindingFor,
	blankSnapshot,
	finiteNumber,
	inkId,
	isObject,
	object,
	optionalArray,
	requiredString,
	selectPage,
	WarningCollector,
	type JsonObject
} from './shared';

type Point = { x: number; y: number };

const DEFAULT_FONT = 'Arial';
const DEFAULT_FONT_SIZE = 20;
const EXCALIDRAW_FONTS: Record<number, string> = { 2: 'Helvetica', 3: 'Cascadia Code', 5: 'Excalifont' };

/** Converts a parsed Excalidraw scene into an Inkfinite snapshot. */
export function importExcalidraw(root: JsonObject, fileName: string): InterchangeImport {
	if (root.type !== 'excalidraw') throw new Error('The selected file is not an Excalidraw scene.');
	const elements = optionalArray(root.elements, 'elements');
	const warnings = new WarningCollector();
	const { snapshot, pageId, layerId } = blankSnapshot(fileName);
	const imported = new Map<string, Shape>();
	const sourceById = new Map<string, JsonObject>();
	const pendingLabels = new Map<string, string>();

	for (const [index, value] of elements.entries()) {
		const element = object(value, `elements[${index}]`);
		const id = requiredString(element.id, `elements[${index}].id`);
		if (sourceById.has(id)) throw new Error(`Excalidraw element ID ${JSON.stringify(id)} is duplicated.`);
		sourceById.set(id, element);
		if (element.isDeleted === true) continue;
		if (element.type === 'text' && typeof element.containerId === 'string') {
			pendingLabels.set(element.containerId, typeof element.text === 'string' ? element.text : '');
		}
	}

	for (const [id, element] of sourceById) {
		if (element.isDeleted === true || (element.type === 'text' && typeof element.containerId === 'string'))
			continue;
		const type = requiredString(element.type, `element ${id}.type`);
		const x = finiteNumber(element.x, `element ${id}.x`);
		const y = finiteNumber(element.y, `element ${id}.y`);
		const width = nonNegativeNumber(element.width, `element ${id}.width`);
		const height = nonNegativeNumber(element.height, `element ${id}.height`);
		const angle = optionalFiniteNumber(element.angle, 0, `element ${id}.angle`);
		const rotationOffset = centerRotationOffset(width, height, angle);
		const origin = { x: x + rotationOffset.x, y: y + rotationOffset.y };
		const shapeId = inkId('excalidraw', id);
		const stroke = stringOr(element.strokeColor, '#1e1e1e');
		const background = stringOr(element.backgroundColor, 'transparent');
		const fill = background === 'transparent' ? '' : background;
		let shape: Shape | null = null;

		switch (type) {
			case 'rectangle':
				shape = ShapeRecord.createRect(
					pageId,
					origin.x,
					origin.y,
					{
						w: width,
						h: height,
						fill,
						stroke,
						radius: element.roundness ? Math.min(width, height) * 0.1 : 0
					},
					shapeId
				);
				break;
			case 'ellipse':
				shape = ShapeRecord.createEllipse(
					pageId,
					origin.x,
					origin.y,
					{ w: width, h: height, fill, stroke },
					shapeId
				);
				break;
			case 'line': {
				const points = excalidrawPoints(element.points, `element ${id}.points`);
				shape = ShapeRecord.createLine(
					pageId,
					origin.x,
					origin.y,
					{
						a: points[0] ?? { x: 0, y: 0 },
						b: points.at(-1) ?? { x: width, y: height },
						stroke,
						width: optionalFiniteNumber(element.strokeWidth, 2, `element ${id}.strokeWidth`)
					},
					shapeId
				);
				if (points.length > 2)
					warnings.add(
						'excalidraw-line-points',
						'Multi-point Excalidraw lines were reduced to their endpoints.'
					);
				break;
			}
			case 'arrow': {
				const points = excalidrawPoints(element.points, `element ${id}.points`);
				shape = ShapeRecord.createArrow(
					pageId,
					origin.x,
					origin.y,
					{
						points:
							points.length >= 2
								? points
								: [
										{ x: 0, y: 0 },
										{ x: width, y: height }
									],
						start: { kind: 'free' },
						end: { kind: 'free' },
						style: {
							stroke,
							width: optionalFiniteNumber(element.strokeWidth, 2, `element ${id}.strokeWidth`),
							headStart: element.startArrowhead !== null && element.startArrowhead !== undefined,
							headEnd: element.endArrowhead !== null,
							...(element.strokeStyle === 'dashed' ? { dash: [8, 6] } : {})
						},
						routing: { kind: element.elbowed === true ? 'orthogonal' : 'straight' },
						...(pendingLabels.get(id)
							? { label: { text: pendingLabels.get(id)!, align: 'center', offset: 0 } as const }
							: {})
					},
					shapeId
				);
				break;
			}
			case 'text':
				shape = ShapeRecord.createText(
					pageId,
					origin.x,
					origin.y,
					{
						text: stringOr(element.text, ''),
						fontSize: optionalFiniteNumber(element.fontSize, DEFAULT_FONT_SIZE, `element ${id}.fontSize`),
						fontFamily:
							typeof element.fontFamily === 'number'
								? (EXCALIDRAW_FONTS[element.fontFamily] ?? DEFAULT_FONT)
								: DEFAULT_FONT,
						color: stroke,
						w: width || undefined
					},
					shapeId
				);
				break;
			case 'freedraw': {
				const points = excalidrawPointTuples(element.points, `element ${id}.points`);
				const pressures = Array.isArray(element.pressures) ? element.pressures : [];
				shape = ShapeRecord.createStroke(
					pageId,
					origin.x,
					origin.y,
					{
						points: points.map((point, pointIndex) => [
							point[0],
							point[1],
							typeof pressures[pointIndex] === 'number' && Number.isFinite(pressures[pointIndex])
								? pressures[pointIndex]
								: undefined
						]),
						style: { color: stroke, opacity: 1 },
						brush: {
							size: optionalFiniteNumber(element.strokeWidth, 2, `element ${id}.strokeWidth`) * 2,
							thinning: 0.5,
							smoothing: 0.5,
							streamline: 0.5,
							simulatePressure: element.simulatePressure !== false
						}
					},
					shapeId
				);
				break;
			}
			case 'embeddable': {
				const url = typeof element.link === 'string' ? element.link : '';
				shape = ShapeRecord.createMarkdown(
					pageId,
					origin.x,
					origin.y,
					{
						md: url ? `[${url}](${url})` : 'Unsupported embedded content',
						w: width,
						h: height,
						fontSize: 16,
						fontFamily: DEFAULT_FONT,
						color: stroke,
						bg: fill || undefined,
						border: stroke
					},
					shapeId
				);
				warnings.add('excalidraw-embeddable', 'Embedded web content was imported as a Markdown link.');
				break;
			}
			case 'frame':
			case 'magicframe':
				warnings.add('excalidraw-frame', 'Excalidraw frames were retained only as element groups.');
				continue;
			case 'diamond':
			case 'image':
			case 'iframe':
				warnings.add(`excalidraw-${type}`, `Excalidraw ${type} elements are not supported and were omitted.`);
				continue;
			default:
				warnings.add('excalidraw-element-type', `Unsupported Excalidraw ${type} elements were omitted.`);
				continue;
		}

		shape.rot = angle;
		shape.opacity = clamp(optionalFiniteNumber(element.opacity, 100, `element ${id}.opacity`) / 100, 0, 1);
		shape.layerId = layerId;
		shape.agentEditable = element.locked !== true;
		const groupIds = Array.isArray(element.groupIds)
			? element.groupIds.filter((value): value is string => typeof value === 'string')
			: [];
		const group = typeof element.frameId === 'string' ? element.frameId : groupIds.at(-1);
		if (group) shape.groupId = inkId('excalidraw-group', group);
		if (groupIds.length > 1)
			warnings.add('excalidraw-nested-group', 'Nested Excalidraw groups were flattened to one Inkfinite group.');
		imported.set(id, shape);
		addShape(snapshot.doc, pageId, layerId, shape);
	}

	for (const [id, element] of sourceById) {
		const shape = imported.get(id);
		if (!shape || shape.type !== 'arrow') continue;
		for (const handle of ['start', 'end'] as const) {
			const bindingValue = element[`${handle}Binding`];
			if (!isObject(bindingValue) || typeof bindingValue.elementId !== 'string') continue;
			const target = imported.get(bindingValue.elementId);
			if (!target) {
				warnings.add('excalidraw-dangling-binding', 'Bindings to omitted or missing elements were removed.');
				continue;
			}
			const binding = BindingRecord.create(
				shape.id,
				target.id,
				handle,
				{ kind: 'center' },
				inkId(`excalidraw-binding-${handle}`, id)
			);
			snapshot.doc.bindings[binding.id] = binding;
			shape.props[handle] = { kind: 'bound', bindingId: binding.id };
		}
	}

	if (isObject(root.files) && Object.keys(root.files).length > 0) {
		warnings.add(
			'excalidraw-files',
			'Embedded Excalidraw files were omitted because Inkfinite has no image shape yet.',
			Object.keys(root.files).length
		);
	}
	if (isObject(root.appState) && root.appState.viewBackgroundColor !== undefined) {
		warnings.add('excalidraw-app-state', 'Excalidraw canvas background and editor settings were not imported.');
	}
	return { format: 'excalidraw', snapshot, warnings: warnings.values() };
}

/** Converts one Inkfinite page into an Excalidraw v2 scene. */
export function exportExcalidraw(snapshot: BoardExport, requestedPageId?: string): InterchangeExport {
	const warnings = new WarningCollector();
	const document = ensureDocumentLayers(snapshot.doc);
	const page = selectPage(document, snapshot.order.pageIds, requestedPageId, warnings);
	const elements: JsonObject[] = [];
	const exportedIds = new Set<string>();
	const bindingsByTarget = new Map<string, Array<{ id: string; type: 'arrow' }>>();

	for (const layerId of page.layerIds ?? []) {
		const layer = document.layers?.[layerId];
		if (!layer) continue;
		if (!layer.visible) {
			warnings.add('hidden-layer', 'Shapes on hidden layers were omitted.');
			continue;
		}
		for (const shapeId of layer.shapeIds) {
			const shape = document.shapes[shapeId];
			if (!shape) continue;
			const opacity = clamp((shape.opacity ?? 1) * layer.opacity, 0, 1);
			const element = excalidrawElement(shape, opacity, layer.locked, warnings);
			if (!element) continue;
			elements.push(element);
			exportedIds.add(shape.id);
			if (shape.type === 'arrow') {
				for (const handle of ['start', 'end'] as const) {
					const binding = bindingFor(document, shape, handle);
					if (!binding) continue;
					element[`${handle}Binding`] = { elementId: binding.toShapeId, focus: 0, gap: 1 };
					const targetBindings = bindingsByTarget.get(binding.toShapeId) ?? [];
					targetBindings.push({ id: shape.id, type: 'arrow' });
					bindingsByTarget.set(binding.toShapeId, targetBindings);
				}
			}
		}
	}

	const labels: JsonObject[] = [];
	for (const element of elements) {
		const id = element.id as string;
		element.boundElements = bindingsByTarget.get(id) ?? [];
		if (element.type === 'arrow') {
			const shape = document.shapes[id] as ArrowShape;
			if (shape.props.label?.text) {
				const textId = `${id}:label`;
				element.boundElements = [...((element.boundElements as unknown[]) ?? []), { id: textId, type: 'text' }];
				labels.push(excalidrawArrowLabel(shape, textId, element));
			}
		}
	}
	elements.push(...labels);
	for (const element of elements) {
		for (const handle of ['start', 'end'] as const) {
			const value = element[`${handle}Binding`];
			if (isObject(value) && typeof value.elementId === 'string' && !exportedIds.has(value.elementId)) {
				element[`${handle}Binding`] = null;
				warnings.add(
					'excalidraw-missing-binding-target',
					'Bindings to omitted shapes were exported as free arrow endpoints.'
				);
			}
		}
	}

	const scene = {
		type: 'excalidraw',
		version: 2,
		source: 'https://inkfinite.app',
		elements,
		appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
		files: {}
	};
	return {
		format: 'excalidraw',
		contents: JSON.stringify(scene, null, 2) + '\n',
		extension: 'excalidraw',
		mimeType: 'application/json',
		warnings: warnings.values()
	};
}

function excalidrawElement(
	shape: Shape,
	opacity: number,
	layerLocked: boolean,
	warnings: WarningCollector
): JsonObject | null {
	const groupIds = shape.groupId ? [shape.groupId] : [];
	const locked = layerLocked || shape.agentEditable === false;
	let width = 0;
	let height = 0;
	let localOrigin = { x: shape.x, y: shape.y };
	let specific: JsonObject;

	switch (shape.type) {
		case 'rect':
			width = shape.props.w;
			height = shape.props.h;
			specific = {
				type: 'rectangle',
				strokeColor: shape.props.stroke || 'transparent',
				backgroundColor: shape.props.fill || 'transparent',
				roundness: shape.props.radius > 0 ? { type: 3 } : null
			};
			break;
		case 'ellipse':
			width = shape.props.w;
			height = shape.props.h;
			specific = {
				type: 'ellipse',
				strokeColor: shape.props.stroke || 'transparent',
				backgroundColor: shape.props.fill || 'transparent',
				roundness: null
			};
			break;
		case 'line': {
			const normalized = normalizePoints([shape.props.a, shape.props.b], shape.x, shape.y, shape.rot);
			width = normalized.width;
			height = normalized.height;
			localOrigin = normalized.origin;
			specific = {
				type: 'line',
				points: normalized.points.map((point) => [point.x, point.y]),
				strokeColor: shape.props.stroke,
				backgroundColor: 'transparent',
				strokeWidth: shape.props.width,
				roundness: null,
				lastCommittedPoint: null,
				startBinding: null,
				endBinding: null,
				startArrowhead: null,
				endArrowhead: null
			};
			break;
		}
		case 'arrow': {
			const normalized = normalizePoints(shape.props.points, shape.x, shape.y, shape.rot);
			width = normalized.width;
			height = normalized.height;
			localOrigin = normalized.origin;
			specific = {
				type: 'arrow',
				points: normalized.points.map((point) => [point.x, point.y]),
				strokeColor: shape.props.style.stroke,
				backgroundColor: 'transparent',
				strokeWidth: shape.props.style.width,
				strokeStyle: shape.props.style.dash ? 'dashed' : 'solid',
				roundness: shape.props.routing?.kind === 'orthogonal' ? null : { type: 2 },
				lastCommittedPoint: null,
				startBinding: null,
				endBinding: null,
				startArrowhead: shape.props.style.headStart ? 'arrow' : null,
				endArrowhead: shape.props.style.headEnd === false ? null : 'arrow',
				elbowed: shape.props.routing?.kind === 'orthogonal'
			};
			break;
		}
		case 'text':
			width =
				shape.props.w ?? Math.max(shape.props.fontSize, shape.props.text.length * shape.props.fontSize * 0.6);
			height = shape.props.fontSize * 1.2;
			specific = {
				type: 'text',
				strokeColor: shape.props.color,
				backgroundColor: 'transparent',
				fontSize: shape.props.fontSize,
				fontFamily: 2,
				text: shape.props.text,
				originalText: shape.props.text,
				textAlign: 'left',
				verticalAlign: 'top',
				lineHeight: 1.25,
				containerId: null,
				boundElements: null,
				autoResize: shape.props.w === undefined
			};
			if (!/^(Arial|Helvetica|sans-serif)$/i.test(shape.props.fontFamily)) {
				warnings.add('excalidraw-font', 'Fonts were replaced with Excalidraw Helvetica.');
			}
			break;
		case 'markdown':
			width = shape.props.w;
			height = shape.props.h ?? shape.props.fontSize * 10;
			specific = {
				type: 'text',
				strokeColor: shape.props.color,
				backgroundColor: 'transparent',
				fontSize: shape.props.fontSize,
				fontFamily: 2,
				text: shape.props.md,
				originalText: shape.props.md,
				textAlign: 'left',
				verticalAlign: 'top',
				lineHeight: 1.25,
				containerId: null,
				boundElements: null,
				autoResize: false
			};
			warnings.add('excalidraw-markdown', 'Markdown blocks were exported as literal text.');
			break;
		case 'path':
			warnings.add('excalidraw-path', 'Native paths are omitted from Excalidraw export.');
			return null;
		case 'container':
			warnings.add('excalidraw-container', 'Containers are represented by their child shapes.');
			return null;
		case 'stroke': {
			const points = shape.props.points.map(([x, y]) => ({ x, y }));
			const normalized = normalizePoints(points, shape.x, shape.y, shape.rot);
			width = normalized.width;
			height = normalized.height;
			localOrigin = normalized.origin;
			specific = {
				type: 'freedraw',
				points: normalized.points.map((point) => [point.x, point.y]),
				pressures: shape.props.points.map((point) => point[2] ?? 0.5),
				simulatePressure: shape.props.brush.simulatePressure,
				strokeColor: shape.props.style.color,
				backgroundColor: 'transparent',
				strokeWidth: shape.props.brush.size / 2,
				lastCommittedPoint: null
			};
			break;
		}
	}

	const rotationOffset = centerRotationOffset(width, height, shape.rot);
	const position = { x: localOrigin.x - rotationOffset.x, y: localOrigin.y - rotationOffset.y };
	return {
		id: shape.id,
		x: position.x,
		y: position.y,
		width,
		height,
		angle: shape.rot,
		strokeColor: '#1e1e1e',
		backgroundColor: 'transparent',
		fillStyle: 'solid',
		strokeWidth: 2,
		strokeStyle: 'solid',
		roughness: 0,
		opacity: Math.round(opacity * 100),
		groupIds,
		frameId: null,
		roundness: null,
		seed: stableSeed(shape.id),
		version: 1,
		versionNonce: stableSeed(`${shape.id}:version`),
		isDeleted: false,
		boundElements: [],
		updated: 0,
		link: null,
		locked,
		...specific
	};
}

function excalidrawArrowLabel(shape: ArrowShape, id: string, arrow: JsonObject): JsonObject {
	const bounds = shapeBounds(shape);
	const fontSize = 20;
	const text = shape.props.label?.text ?? '';
	const width = Math.max(fontSize, text.length * fontSize * 0.6);
	const height = fontSize * 1.25;
	return {
		id,
		type: 'text',
		x: (bounds.min.x + bounds.max.x - width) / 2,
		y: (bounds.min.y + bounds.max.y - height) / 2,
		width,
		height,
		angle: 0,
		strokeColor: shape.props.style.stroke,
		backgroundColor: 'transparent',
		fillStyle: 'solid',
		strokeWidth: 1,
		strokeStyle: 'solid',
		roughness: 0,
		opacity: arrow.opacity,
		groupIds: arrow.groupIds,
		frameId: null,
		roundness: null,
		seed: stableSeed(id),
		version: 1,
		versionNonce: stableSeed(`${id}:version`),
		isDeleted: false,
		boundElements: null,
		updated: 0,
		link: null,
		locked: arrow.locked,
		fontSize,
		fontFamily: 2,
		text,
		originalText: text,
		textAlign: 'center',
		verticalAlign: 'middle',
		lineHeight: 1.25,
		containerId: shape.id,
		autoResize: true
	};
}

function centerRotationOffset(width: number, height: number, angle: number): Point {
	const center = { x: width / 2, y: height / 2 };
	const rotated = Vec2.rotate(center, angle);
	return { x: center.x - rotated.x, y: center.y - rotated.y };
}

function normalizePoints(points: Point[], x: number, y: number, angle: number) {
	if (points.length === 0) return { points: [{ x: 0, y: 0 }], width: 0, height: 0, origin: { x, y } };
	const minX = Math.min(...points.map((point) => point.x));
	const minY = Math.min(...points.map((point) => point.y));
	const maxX = Math.max(...points.map((point) => point.x));
	const maxY = Math.max(...points.map((point) => point.y));
	const offset = Vec2.rotate({ x: minX, y: minY }, angle);
	return {
		points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })),
		width: maxX - minX,
		height: maxY - minY,
		origin: { x: x + offset.x, y: y + offset.y }
	};
}

function excalidrawPoints(value: unknown, name: string): Point[] {
	return excalidrawPointTuples(value, name).map(([x, y]) => ({ x, y }));
}

function excalidrawPointTuples(value: unknown, name: string): Array<[number, number]> {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
	return value.map((point, index) => {
		if (!Array.isArray(point) || point.length < 2) throw new Error(`${name}[${index}] must contain x and y.`);
		return [finiteNumber(point[0], `${name}[${index}][0]`), finiteNumber(point[1], `${name}[${index}][1]`)];
	});
}

function stableSeed(value: string) {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function stringOr(value: unknown, fallback: string) {
	return typeof value === 'string' ? value : fallback;
}

function optionalFiniteNumber(value: unknown, fallback: number, name: string) {
	return value === undefined || value === null ? fallback : finiteNumber(value, name);
}

function nonNegativeNumber(value: unknown, name: string) {
	const number = finiteNumber(value, name);
	if (number < 0) throw new Error(`${name} must not be negative.`);
	return number;
}
