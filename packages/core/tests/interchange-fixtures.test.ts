import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	EditorBindingRecord,
	exportInterchange,
	importInterchange,
	EditorShapeRecord,
	validateDoc,
	type BoardExport,
	type ImportedAsset
} from '../src';

function fixture(path: string): string {
	return readFileSync(new URL(`../../../fixtures/interchange/${path}`, import.meta.url), 'utf8');
}

function mixedBoard(): BoardExport {
	const page = {
		id: 'page:mixed',
		name: 'Mixed',
		shapeIds: ['frame', 'card', 'image', 'link', 'svg-path', 'arrow'],
		layerIds: ['layer:mixed']
	};
	const layer = {
		id: 'layer:mixed',
		pageId: page.id,
		name: 'Mixed',
		shapeIds: [...page.shapeIds],
		visible: true,
		locked: false,
		opacity: 1
	};
	const frame = EditorShapeRecord.createContainer(
		page.id,
		0,
		0,
		{ w: 500, h: 300, title: 'Mixed content', fill: '#f8fafc', stroke: '#94a3b8' },
		'frame'
	);
	const card = EditorShapeRecord.createMarkdown(
		page.id,
		40,
		60,
		{
			md: '# Card',
			w: 160,
			h: 90,
			fontSize: 16,
			fontFamily: 'Arial',
			color: '#111827',
			bg: '#dbeafe',
			border: '#2563eb'
		},
		'card'
	);
	const asset: ImportedAsset = {
		id: 'asset:pixel',
		name: 'pixel.png',
		mediaType: 'image/png',
		digest: 'sha256:pixel',
		bytes: [137, 80, 78, 71]
	};
	const image = EditorShapeRecord.createImage(
		page.id,
		260,
		60,
		{ w: 120, h: 90, assetId: asset.id, caption: 'Raster asset' },
		'image'
	);
	const link = EditorShapeRecord.createReference(
		page.id,
		140,
		210,
		{ w: 220, h: 60, referenceType: 'url', value: 'https://example.com', label: 'External link' },
		'link'
	);
	const svgPath = EditorShapeRecord.createPath(
		page.id,
		420,
		210,
		{
			subpaths: [
				{
					segments: [
						{ type: 'move', to: { x: 0, y: 0 } },
						{ type: 'line', to: { x: 60, y: 0 } },
						{ type: 'line', to: { x: 30, y: 40 } }
					],
					closed: true
				}
			],
			fill_rule: 'nonzero',
			fill: '#f97316',
			stroke: '#c2410c',
			stroke_width: 2
		},
		'svg-path'
	);
	svgPath.metadata = {
		name: 'Imported SVG path',
		title: null,
		role: 'svg.path',
		description: null,
		body: null,
		tags: ['svg-import'],
		source: 'fixtures/svg-import/illustrations/night-garden.svg',
		link: null,
		customMetadata: {},
		locked: false,
		agentEditable: true
	};
	const start = {
		id: 'binding:start',
		type: 'arrow-end' as const,
		fromShapeId: 'arrow',
		toShapeId: 'card',
		handle: 'start' as const,
		anchor: { kind: 'edge' as const, nx: 1, ny: 0 }
	};
	const end = {
		id: 'binding:end',
		type: 'arrow-end' as const,
		fromShapeId: 'arrow',
		toShapeId: 'image',
		handle: 'end' as const,
		anchor: { kind: 'edge' as const, nx: -1, ny: 0 }
	};
	const relation = EditorBindingRecord.createRelation('card', 'link', 'references', 'binding:relation');
	const arrow = EditorShapeRecord.createArrow(
		page.id,
		0,
		0,
		{
			points: [
				{ x: 0, y: 0 },
				{ x: 200, y: 0 }
			],
			start: { kind: 'bound', bindingId: start.id },
			end: { kind: 'bound', bindingId: end.id },
			style: { stroke: '#64748b', width: 2, headEnd: true },
			routing: { kind: 'straight' },
			label: { text: 'imports', align: 'center', offset: 0 }
		},
		'arrow'
	);
	for (const shape of [frame, card, image, link, svgPath, arrow]) shape.layerId = layer.id;
	return {
		board: { id: 'board:mixed', name: 'Mixed', createdAt: 1, updatedAt: 1 },
		doc: {
			pages: { [page.id]: page },
			layers: { [layer.id]: layer },
			shapes: { frame, card, image, link, 'svg-path': svgPath, arrow },
			bindings: { [start.id]: start, [end.id]: end, [relation.id]: relation },
			assets: { [asset.id]: asset }
		},
		order: { pageIds: [page.id], shapeOrder: { [page.id]: [...page.shapeIds] }, layers: { [layer.id]: layer } }
	};
}

describe('diagram and mixed-format fixtures', () => {
	it('imports the JSON Canvas fixture as editable references, a frame, and arrows', () => {
		const result = importInterchange(fixture('json-canvas/mixed.canvas'), 'mixed.canvas');
		const shapes = Object.values(result.snapshot.doc.shapes);
		expect(result.format).toBe('json-canvas');
		expect(shapes.some((shape) => shape.type === 'container')).toBe(true);
		expect(shapes.filter((shape) => shape.type === 'reference')).toHaveLength(2);
		expect(shapes.filter((shape) => shape.type === 'arrow')).toHaveLength(2);
		expect(result.warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining(['json-canvas-group-background', 'json-canvas-file-card', 'json-canvas-link-card'])
		);
		expect(validateDoc(result.snapshot.doc)).toEqual({ ok: true });
		const reexported = JSON.parse(exportInterchange(result.snapshot, 'json-canvas').contents) as {
			nodes: Array<Record<string, unknown>>;
		};
		expect(reexported.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'group',
					background: 'assets/board-background.png',
					backgroundStyle: 'cover'
				}),
				expect.objectContaining({ type: 'file', file: 'notes/architecture.md', subpath: '#Overview' }),
				expect.objectContaining({ type: 'link', url: 'https://ink.stormlightlabs.org' })
			])
		);
	});

	it('imports Mermaid nodes, groups, labels, links, styles, and graph bindings', () => {
		const result = importInterchange(fixture('diagrams/flowchart.mmd'), 'flowchart.mmd');
		const shapes = Object.values(result.snapshot.doc.shapes);
		expect(result.format).toBe('mermaid');
		expect(shapes.filter((shape) => shape.type === 'markdown').map((shape) => shape.props.md)).toEqual(
			expect.arrayContaining(['API server', 'Database', 'Cache', 'Client'])
		);
		expect(shapes.filter((shape) => shape.type === 'container')).toHaveLength(1);
		expect(shapes.filter((shape) => shape.type === 'arrow')).toHaveLength(3);
		expect(Object.values(result.snapshot.doc.bindings)).toHaveLength(6);
		expect(shapes.find((shape) => shape.id === 'mermaid-node:API')?.metadata?.link).toBe('https://example.com/api');
		expect(result.warnings.map((warning) => warning.code)).toContain('mermaid-unsupported-shape');
		expect(validateDoc(result.snapshot.doc)).toEqual({ ok: true });
	});

	it('imports D2 nested objects and connections through the shared flow layout', () => {
		const result = importInterchange(fixture('diagrams/architecture.d2'), 'architecture.d2');
		const shapes = Object.values(result.snapshot.doc.shapes);
		expect(result.format).toBe('d2');
		expect(shapes.filter((shape) => shape.type === 'container')).toHaveLength(1);
		expect(shapes.filter((shape) => shape.type === 'markdown').map((shape) => shape.props.md)).toEqual(
			expect.arrayContaining(['API server', 'Database', 'Client'])
		);
		expect(shapes.filter((shape) => shape.type === 'arrow')).toHaveLength(2);
		expect(result.snapshot.doc.shapes['d2-node:network.api']?.x).toBeGreaterThan(
			result.snapshot.doc.shapes['d2-node:client']?.x ?? -1
		);
		expect(validateDoc(result.snapshot.doc)).toEqual({ ok: true });
	});

	it('reports D2 unsupported shapes and embedded icons while keeping the node editable', () => {
		const result = importInterchange(fixture('diagrams/unsupported.d2'), 'unsupported.d2');
		expect(
			Object.values(result.snapshot.doc.shapes).some(
				(shape) => shape.type === 'markdown' && shape.props.md === 'Service'
			)
		).toBe(true);
		expect(result.warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining(['d2-unsupported-shape', 'd2-unsupported-construct'])
		);
	});

	it('exports a mixed native document and imports its JSON Canvas-compatible subset', () => {
		const exported = exportInterchange(mixedBoard(), 'json-canvas');
		const value = JSON.parse(exported.contents) as { nodes: Array<{ type: string }>; edges: unknown[] };
		expect(value.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(['group', 'text', 'file', 'link']));
		expect(value.edges).toHaveLength(2);
		const imported = importInterchange(exported.contents, 'round-trip.canvas');
		expect(validateDoc(imported.snapshot.doc)).toEqual({ ok: true });
		expect(Object.values(imported.snapshot.doc.shapes).filter((shape) => shape.type === 'reference')).toHaveLength(
			2
		);
		const editedCard = Object.values(imported.snapshot.doc.shapes).find((shape) => shape.type === 'markdown');
		if (!editedCard || editedCard.type !== 'markdown') throw new Error('round-trip fixture did not contain a card');
		editedCard.props.md = '# Edited card';
		const editedExport = exportInterchange(imported.snapshot, 'json-canvas');
		expect(JSON.parse(editedExport.contents).nodes).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'text', text: '# Edited card' })])
		);
	});
});
