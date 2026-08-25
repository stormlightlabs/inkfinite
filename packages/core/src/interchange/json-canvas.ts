import { shapeBounds } from '../geom';
import { paintColor } from '../paint';
import {
	BindingRecord,
	ensureDocumentLayers,
	ShapeRecord,
	type BindingAnchor,
	type ShapeRecord as Shape
} from '../model';
import type { BoardExport } from '../persistence/document';
import type { InterchangeExport, InterchangeImport } from '../interchange';
import {
	addShape,
	bindingFor,
	blankSnapshot,
	finiteNumber,
	inkId,
	object,
	optionalArray,
	requiredString,
	selectPage,
	WarningCollector,
	type JsonObject
} from './shared';

type Point = { x: number; y: number };

const DEFAULT_FONT = 'Arial';

/** Converts a parsed JSON Canvas document into an Inkfinite snapshot. */
export function importJsonCanvas(root: JsonObject, fileName: string): InterchangeImport {
	const warnings = new WarningCollector();
	const nodes = optionalArray(root.nodes, 'nodes');
	const edges = optionalArray(root.edges, 'edges');
	const { snapshot, pageId, layerId } = blankSnapshot(fileName);
	const nodeShapes = new Map<string, Shape>();
	const groupNodes: Array<{
		id: string;
		x: number;
		y: number;
		width: number;
		height: number;
		label?: string;
		color?: string;
		background?: string;
		backgroundStyle?: string;
	}> = [];
	const sourceIds = new Set<string>();

	for (const [index, value] of nodes.entries()) {
		const node = object(value, `nodes[${index}]`);
		const id = requiredString(node.id, `nodes[${index}].id`);
		if (sourceIds.has(id)) {
			throw new Error(`JSON Canvas ID ${JSON.stringify(id)} is duplicated.`);
		}
		sourceIds.add(id);
		const type = requiredString(node.type, `nodes[${index}].type`);
		const x = finiteNumber(node.x, `nodes[${index}].x`);
		const y = finiteNumber(node.y, `nodes[${index}].y`);
		const width = positiveNumber(node.width, `nodes[${index}].width`);
		const height = positiveNumber(node.height, `nodes[${index}].height`);
		if (type === 'group') {
			const background = typeof node.background === 'string' ? node.background : undefined;
			groupNodes.push({
				id,
				x,
				y,
				width,
				height,
				...(typeof node.label === 'string' ? { label: node.label } : {}),
				...(typeof node.color === 'string' ? { color: canvasColor(node.color) } : {}),
				...(background ? { background } : {}),
				...(typeof node.backgroundStyle === 'string' ? { backgroundStyle: node.backgroundStyle } : {})
			});
			if (typeof node.label === 'string' && node.label.trim()) {
				warnings.add('json-canvas-group-label', 'Group labels were imported as frame titles.');
			}
			if (background) {
				warnings.add(
					'json-canvas-group-background',
					'Group background paths were retained as frame source metadata; file bytes were not available.'
				);
			}
			if (
				node.backgroundStyle !== undefined &&
				node.backgroundStyle !== 'cover' &&
				node.backgroundStyle !== 'ratio' &&
				node.backgroundStyle !== 'repeat'
			) {
				warnings.add(
					'json-canvas-group-background-style',
					'Unsupported JSON Canvas background styles were ignored.'
				);
			}
			continue;
		}

		let shape: Shape;
		switch (type) {
			case 'text': {
				if (typeof node.text !== 'string') throw new Error(`nodes[${index}].text must be a string.`);
				shape = ShapeRecord.createMarkdown(
					pageId,
					x,
					y,
					markdownProps(node.text, width, height, node.color),
					inkId('json-canvas', id)
				);
				break;
			}
			case 'file': {
				const path = requiredString(node.file, `nodes[${index}].file`);
				const subpath = typeof node.subpath === 'string' ? node.subpath : '';
				if (subpath && !subpath.startsWith('#'))
					warnings.add('json-canvas-file-subpath', 'File subpaths must start with # and were ignored.');
				shape = ShapeRecord.createReference(
					pageId,
					x,
					y,
					{
						w: width,
						h: height,
						referenceType: 'file',
						value: `${path}${subpath.startsWith('#') ? subpath : ''}`,
						label: path
					},
					inkId('json-canvas', id)
				);
				warnings.add(
					'json-canvas-file-card',
					'File cards remain references because JSON Canvas stores a path, not file bytes.'
				);
				break;
			}
			case 'link': {
				const url = requiredString(node.url, `nodes[${index}].url`);
				if (!/^https?:\/\//i.test(url)) {
					warnings.add(
						'json-canvas-link-card',
						'Non-http JSON Canvas links were imported as Markdown cards.'
					);
					shape = ShapeRecord.createMarkdown(
						pageId,
						x,
						y,
						markdownProps(`[${url}](${url})`, width, height, node.color),
						inkId('json-canvas', id)
					);
				} else {
					shape = ShapeRecord.createReference(
						pageId,
						x,
						y,
						{ w: width, h: height, referenceType: 'url', value: url, label: url },
						inkId('json-canvas', id)
					);
					warnings.add('json-canvas-link-card', 'Link cards remain editable URL references.');
				}
				break;
			}
			default:
				warnings.add('json-canvas-node-type', `Unsupported JSON Canvas ${type} nodes were omitted.`);
				continue;
		}
		shape.layerId = layerId;
		nodeShapes.set(id, shape);
	}

	for (const group of groupNodes) {
		const frame = ShapeRecord.createContainer(
			pageId,
			group.x,
			group.y,
			{ w: group.width, h: group.height, title: group.label || 'Frame', fill: group.color, stroke: group.color },
			inkId('json-canvas-group', group.id)
		);
		frame.layerId = layerId;
		if (group.background) {
			frame.metadata = {
				name: group.id,
				title: group.label || 'Frame',
				role: 'canvas.frame',
				description: null,
				body: null,
				tags: ['json-canvas'],
				source: group.background,
				link: null,
				customMetadata: { backgroundStyle: group.backgroundStyle ?? 'cover' },
				locked: false,
				agentEditable: true
			};
		}
		nodeShapes.set(group.id, frame);
		addShape(snapshot.doc, pageId, layerId, frame);
	}
	const frameIds = groupNodes.map((group) => inkId('json-canvas-group', group.id));
	snapshot.doc.pages[pageId].shapeIds = [
		...frameIds,
		...snapshot.doc.pages[pageId].shapeIds.filter((id) => !frameIds.includes(id))
	];
	snapshot.doc.layers![layerId].shapeIds = [...snapshot.doc.pages[pageId].shapeIds];

	for (const shape of nodeShapes.values()) {
		if (shape.type === 'container') continue;
		const bounds = shapeBounds(shape);
		const containing = groupNodes
			.filter(
				(group) =>
					bounds.min.x >= group.x &&
					bounds.min.y >= group.y &&
					bounds.max.x <= group.x + group.width &&
					bounds.max.y <= group.y + group.height
			)
			.sort((a, b) => a.width * a.height - b.width * b.height);
		if (containing[0]) shape.groupId = inkId('json-canvas-group', containing[0].id);
		if (containing.length > 1) {
			warnings.add(
				'json-canvas-nested-group',
				'Nested JSON Canvas groups were flattened to their innermost group.'
			);
		}
	}

	for (const shape of nodeShapes.values()) {
		if (shape.type !== 'container') addShape(snapshot.doc, pageId, layerId, shape);
	}

	for (const [index, value] of edges.entries()) {
		const edge = object(value, `edges[${index}]`);
		const id = requiredString(edge.id, `edges[${index}].id`);
		if (sourceIds.has(id)) {
			throw new Error(`JSON Canvas ID ${JSON.stringify(id)} is duplicated.`);
		}
		sourceIds.add(id);
		const fromId = requiredString(edge.fromNode, `edges[${index}].fromNode`);
		const toId = requiredString(edge.toNode, `edges[${index}].toNode`);
		const from = nodeShapes.get(fromId);
		const to = nodeShapes.get(toId);
		if (!from || !to) {
			warnings.add('json-canvas-dangling-edge', 'Edges connected to omitted or missing nodes were omitted.');
			continue;
		}
		const start = sidePoint(from, optionalSide(edge.fromSide));
		const end = sidePoint(to, optionalSide(edge.toSide));
		const startBinding = BindingRecord.create(
			inkId('json-canvas-edge', id),
			from.id,
			'start',
			anchorForSide(optionalSide(edge.fromSide)),
			inkId('json-canvas-binding-start', id)
		);
		const endBinding = BindingRecord.create(
			inkId('json-canvas-edge', id),
			to.id,
			'end',
			anchorForSide(optionalSide(edge.toSide)),
			inkId('json-canvas-binding-end', id)
		);
		const arrow = ShapeRecord.createArrow(
			pageId,
			start.x,
			start.y,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: end.x - start.x, y: end.y - start.y }
				],
				start: { kind: 'bound', bindingId: startBinding.id },
				end: { kind: 'bound', bindingId: endBinding.id },
				style: {
					stroke: canvasColor(edge.color) ?? '#1e1e1e',
					width: 2,
					headStart: edge.fromEnd === 'arrow',
					headEnd: edge.toEnd !== 'none'
				},
				routing: { kind: 'straight' },
				...(typeof edge.label === 'string' && edge.label
					? { label: { text: edge.label, align: 'center', offset: 0 } as const }
					: {})
			},
			inkId('json-canvas-edge', id)
		);
		arrow.layerId = layerId;
		addShape(snapshot.doc, pageId, layerId, arrow);
		snapshot.doc.bindings[startBinding.id] = startBinding;
		snapshot.doc.bindings[endBinding.id] = endBinding;
	}

	return { format: 'json-canvas', snapshot, warnings: warnings.values() };
}

/** Converts one Inkfinite page into a JSON Canvas document. */
export function exportJsonCanvas(snapshot: BoardExport, requestedPageId?: string): InterchangeExport {
	const warnings = new WarningCollector();
	const document = ensureDocumentLayers(snapshot.doc);
	const page = selectPage(document, snapshot.order.pageIds, requestedPageId, warnings);
	const shapeIds = page.layerIds?.flatMap((id) => document.layers?.[id]?.shapeIds ?? []) ?? page.shapeIds;
	const exportable = new Map<string, JsonObject>();
	const groups = new Map<string, Shape[]>();
	const groupNodes = new Map<string, JsonObject>();

	for (const id of shapeIds) {
		const shape = document.shapes[id];
		if (!shape) continue;
		const layer = shape.layerId ? document.layers?.[shape.layerId] : undefined;
		if (layer && !layer.visible) {
			warnings.add('hidden-layer', 'Shapes on hidden layers were omitted.');
			continue;
		}
		const bounds = shapeBounds(shape);
		if (shape.rot !== 0)
			warnings.add('json-canvas-rotation', 'Rotated objects were exported using axis-aligned bounds.');
		const geometry = {
			id: shape.id,
			x: Math.round(bounds.min.x),
			y: Math.round(bounds.min.y),
			width: Math.max(1, Math.round(bounds.max.x - bounds.min.x)),
			height: Math.max(1, Math.round(bounds.max.y - bounds.min.y))
		};
		let node: JsonObject | null = null;
		switch (shape.type) {
			case 'text':
			case 'markdown':
				node = {
					...geometry,
					type: 'text',
					text: shape.type === 'text' ? shape.props.text : shape.props.md,
					...(paintColor(nodeColor(shape)) ? { color: paintColor(nodeColor(shape)) } : {})
				};
				break;
			case 'reference':
				if (shape.props.referenceType === 'url') node = { ...geometry, type: 'link', url: shape.props.value };
				else if (shape.props.referenceType === 'file') {
					const subpath = /#[^#]*$/.exec(shape.props.value)?.[0];
					node = {
						...geometry,
						type: 'file',
						file: subpath ? shape.props.value.slice(0, -subpath.length) : shape.props.value,
						...(subpath ? { subpath } : {})
					};
				} else
					warnings.add(
						'json-canvas-page-reference',
						'Page references have no JSON Canvas node type and were omitted.'
					);
				break;
			case 'image': {
				const asset = document.assets?.[shape.props.assetId];
				if (!asset) {
					warnings.add('json-canvas-asset', 'Images without an embedded asset were omitted.');
					break;
				}
				node = { ...geometry, type: 'file', file: asset.name };
				warnings.add(
					'json-canvas-asset',
					'Embedded images were exported as file nodes because JSON Canvas stores paths, not bytes.'
				);
				break;
			}
			case 'container': {
				const background =
					shape.metadata?.role === 'canvas.frame' && shape.metadata.source
						? shape.metadata.source
						: undefined;
				const backgroundStyle =
					shape.metadata?.role === 'canvas.frame' &&
					typeof shape.metadata.customMetadata.backgroundStyle === 'string' &&
					['cover', 'ratio', 'repeat'].includes(shape.metadata.customMetadata.backgroundStyle)
						? shape.metadata.customMetadata.backgroundStyle
						: undefined;
				const group = {
					...geometry,
					type: 'group',
					...(shape.props.title ? { label: shape.props.title } : {}),
					...(paintColor(shape.props.fill) ? { color: paintColor(shape.props.fill) } : {}),
					...(background ? { background } : {}),
					...(backgroundStyle ? { backgroundStyle } : {})
				};
				groupNodes.set(shape.id, group);
				node = group;
				break;
			}
			case 'arrow':
				break;
			default:
				warnings.add(
					'json-canvas-drawing-shape',
					'Drawing shapes that JSON Canvas cannot represent were omitted.'
				);
		}
		if (node) exportable.set(shape.id, node);
		if (shape.groupId && node && shape.type !== 'container') {
			const members = groups.get(shape.groupId) ?? [];
			members.push(shape);
			groups.set(shape.groupId, members);
		}
	}

	const nodes: JsonObject[] = [...groupNodes.values()];
	for (const [id, members] of groups) {
		if (groupNodes.has(id)) continue;
		if (members.length === 0) continue;
		const memberBounds = members.map(shapeBounds);
		const bounds = {
			min: {
				x: Math.min(...memberBounds.map((member) => member.min.x)),
				y: Math.min(...memberBounds.map((member) => member.min.y))
			},
			max: {
				x: Math.max(...memberBounds.map((member) => member.max.x)),
				y: Math.max(...memberBounds.map((member) => member.max.y))
			}
		};
		const group = {
			id,
			type: 'group',
			x: Math.floor(bounds.min.x - 20),
			y: Math.floor(bounds.min.y - 20),
			width: Math.max(1, Math.ceil(bounds.max.x - bounds.min.x + 40)),
			height: Math.max(1, Math.ceil(bounds.max.y - bounds.min.y + 40))
		};
		groupNodes.set(id, group);
		nodes.push(group);
	}
	for (const id of shapeIds) {
		const node = exportable.get(id);
		if (node && node.type !== 'group') nodes.push(node);
	}

	const edges: JsonObject[] = [];
	for (const id of shapeIds) {
		const shape = document.shapes[id];
		if (!shape || shape.type !== 'arrow') continue;
		const start = bindingFor(document, shape, 'start');
		const end = bindingFor(document, shape, 'end');
		if (!start || !end || !exportable.has(start.toShapeId) || !exportable.has(end.toShapeId)) {
			warnings.add('json-canvas-free-arrow', 'Arrows without two exportable card endpoints were omitted.');
			continue;
		}
		edges.push({
			id: shape.id,
			fromNode: start.toShapeId,
			fromSide: sideForAnchor(start.anchor),
			fromEnd: shape.props.style.headStart ? 'arrow' : 'none',
			toNode: end.toShapeId,
			toSide: sideForAnchor(end.anchor),
			toEnd: shape.props.style.headEnd === false ? 'none' : 'arrow',
			color: paintColor(shape.props.style.stroke) ?? '#000000',
			...(shape.props.label?.text
				? { label: shape.props.label.text }
				: start.relationType
					? { label: start.relationType }
					: {})
		});
	}
	for (const binding of Object.values(document.bindings).filter((candidate) => candidate.type === 'relation')) {
		if (!exportable.has(binding.fromShapeId) || !exportable.has(binding.toShapeId)) continue;
		if (
			edges.some(
				(edge) =>
					edge.id === binding.id ||
					(edge.fromNode === binding.fromShapeId && edge.toNode === binding.toShapeId)
			)
		)
			continue;
		edges.push({
			id: binding.id,
			fromNode: binding.fromShapeId,
			fromSide: 'right',
			fromEnd: 'none',
			toNode: binding.toShapeId,
			toSide: 'left',
			toEnd: 'none',
			...(binding.relationType ? { label: binding.relationType } : {})
		});
	}

	return {
		format: 'json-canvas',
		contents: JSON.stringify({ nodes, edges }, null, 2) + '\n',
		extension: 'canvas',
		mimeType: 'application/json',
		warnings: warnings.values()
	};
}

function sidePoint(shape: Shape, side?: CanvasSide): Point {
	const bounds = shapeBounds(shape);
	const center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
	switch (side) {
		case 'top':
			return { x: center.x, y: bounds.min.y };
		case 'right':
			return { x: bounds.max.x, y: center.y };
		case 'bottom':
			return { x: center.x, y: bounds.max.y };
		case 'left':
			return { x: bounds.min.x, y: center.y };
		default:
			return center;
	}
}

type CanvasSide = 'top' | 'right' | 'bottom' | 'left';

function optionalSide(value: unknown): CanvasSide | undefined {
	return value === 'top' || value === 'right' || value === 'bottom' || value === 'left' ? value : undefined;
}

function anchorForSide(side?: CanvasSide) {
	switch (side) {
		case 'top':
			return { kind: 'edge', nx: 0, ny: -1 } as const;
		case 'right':
			return { kind: 'edge', nx: 1, ny: 0 } as const;
		case 'bottom':
			return { kind: 'edge', nx: 0, ny: 1 } as const;
		case 'left':
			return { kind: 'edge', nx: -1, ny: 0 } as const;
		default:
			return { kind: 'center' } as const;
	}
}

function sideForAnchor(anchor: BindingAnchor): CanvasSide {
	if (anchor.kind === 'center') return 'right';
	if (Math.abs(anchor.nx) >= Math.abs(anchor.ny)) return anchor.nx < 0 ? 'left' : 'right';
	return anchor.ny < 0 ? 'top' : 'bottom';
}

function markdownProps(text: string, width: number, height: number, color: unknown) {
	const paint = canvasColor(color);
	return {
		md: text,
		w: width,
		h: height,
		fontSize: 16,
		fontFamily: DEFAULT_FONT,
		color: '#1e1e1e',
		...(paint ? { bg: paint, border: paint } : {})
	};
}

function nodeColor(shape: Shape) {
	if (shape.type === 'markdown') return shape.props.bg || shape.props.border;
	if (shape.type === 'text') return shape.props.color;
	return undefined;
}

function canvasColor(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const presets: Record<string, string> = {
		'1': '#fb464c',
		'2': '#e9973f',
		'3': '#e0de71',
		'4': '#44cf6e',
		'5': '#53dfdd',
		'6': '#a882ff'
	};
	return presets[value] ?? (/^#[\da-f]{3,8}$/i.test(value) ? value : undefined);
}

function positiveNumber(value: unknown, name: string) {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new Error(`${name} must be greater than zero.`);
	return number;
}
