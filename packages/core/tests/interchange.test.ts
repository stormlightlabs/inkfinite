import { describe, expect, it } from 'vitest';
import {
	EditorBindingRecord,
	exportInterchange,
	importInterchange,
	EditorLayerRecord,
	EditorPageRecord,
	EditorShapeRecord,
	type BoardExport
} from '../src';

function board(): BoardExport {
	const page = EditorPageRecord.create('First', 'page:1');
	const layer = EditorLayerRecord.create(page.id, 'Default', 'layer:1');
	page.layerIds = [layer.id];
	const markdown = EditorShapeRecord.createMarkdown(
		page.id,
		10,
		20,
		{ md: '# Card', w: 240, h: 120, fontSize: 16, fontFamily: 'Arial', color: '#111111', bg: '#ffeeaa' },
		'shape:card'
	);
	markdown.layerId = layer.id;
	const text = EditorShapeRecord.createText(
		page.id,
		400,
		40,
		{ text: 'Target', fontSize: 20, fontFamily: 'Arial', color: '#222222', w: 100 },
		'shape:target'
	);
	text.layerId = layer.id;
	const start = EditorBindingRecord.create(
		'shape:arrow',
		markdown.id,
		'start',
		{ kind: 'edge', nx: 1, ny: 0 },
		'binding:start'
	);
	const end = EditorBindingRecord.create('shape:arrow', text.id, 'end', { kind: 'edge', nx: -1, ny: 0 }, 'binding:end');
	const arrow = EditorShapeRecord.createArrow(
		page.id,
		250,
		80,
		{
			points: [
				{ x: 0, y: 0 },
				{ x: 150, y: 0 }
			],
			start: { kind: 'bound', bindingId: start.id },
			end: { kind: 'bound', bindingId: end.id },
			style: { stroke: '#335577', width: 2, headEnd: true },
			routing: { kind: 'straight' },
			label: { text: 'connects', align: 'center', offset: 0 }
		},
		'shape:arrow'
	);
	arrow.layerId = layer.id;
	page.shapeIds = [markdown.id, text.id, arrow.id];
	layer.shapeIds = [...page.shapeIds];
	return {
		board: { id: 'board:1', name: 'Example', createdAt: 1, updatedAt: 1 },
		doc: {
			pages: { [page.id]: page },
			layers: { [layer.id]: layer },
			shapes: { [markdown.id]: markdown, [text.id]: text, [arrow.id]: arrow },
			bindings: { [start.id]: start, [end.id]: end }
		},
		order: { pageIds: [page.id], shapeOrder: { [page.id]: [...page.shapeIds] }, layers: { [layer.id]: layer } }
	};
}

describe('JSON Canvas interchange', () => {
	it('imports every JSON Canvas node kind and bound edges', () => {
		const result = importInterchange(
			JSON.stringify({
				nodes: [
					{ id: 'group', type: 'group', x: 0, y: 0, width: 600, height: 400, label: 'Group' },
					{ id: 'text', type: 'text', x: 20, y: 20, width: 200, height: 100, text: '# Hello', color: '4' },
					{
						id: 'file',
						type: 'file',
						x: 300,
						y: 20,
						width: 200,
						height: 100,
						file: 'Note.md',
						subpath: '#Heading'
					},
					{ id: 'link', type: 'link', x: 300, y: 200, width: 200, height: 100, url: 'https://example.com' }
				],
				edges: [
					{ id: 'edge', fromNode: 'text', fromSide: 'right', toNode: 'file', toSide: 'left', label: 'reads' }
				]
			}),
			'Notes.canvas'
		);

		expect(result.format).toBe('json-canvas');
		expect(result.snapshot.board.name).toBe('Notes');
		expect(Object.values(result.snapshot.doc.shapes).filter((shape) => shape.type === 'markdown')).toHaveLength(1);
		expect(Object.values(result.snapshot.doc.shapes).filter((shape) => shape.type === 'reference')).toHaveLength(2);
		expect(Object.values(result.snapshot.doc.shapes).filter((shape) => shape.type === 'arrow')).toHaveLength(1);
		expect(Object.values(result.snapshot.doc.bindings)).toHaveLength(2);
		expect(result.warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining(['json-canvas-group-label', 'json-canvas-file-card', 'json-canvas-link-card'])
		);
	});

	it('accepts empty text cards', () => {
		const result = importInterchange(
			JSON.stringify({
				nodes: [{ id: 'empty', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '' }],
				edges: []
			}),
			'Empty.canvas'
		);

		expect(Object.values(result.snapshot.doc.shapes)[0]).toMatchObject({ type: 'markdown', props: { md: '' } });
	});

	it('exports cards, groups, and bound arrows', () => {
		const snapshot = board();
		snapshot.doc.shapes['shape:card'].groupId = 'group:one';
		snapshot.doc.shapes['shape:target'].groupId = 'group:one';
		const result = exportInterchange(snapshot, 'json-canvas');
		const value = JSON.parse(result.contents);

		expect(value.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'group:one', type: 'group' }),
				expect.objectContaining({ id: 'shape:card', type: 'text', text: '# Card' })
			])
		);
		expect(value.edges).toEqual([
			expect.objectContaining({
				id: 'shape:arrow',
				fromNode: 'shape:card',
				toNode: 'shape:target',
				label: 'connects'
			})
		]);
	});
});

describe('Excalidraw interchange', () => {
	it('imports supported elements, bindings, labels, groups, and styles', () => {
		const result = importInterchange(
			JSON.stringify({
				type: 'excalidraw',
				version: 2,
				elements: [
					{
						id: 'box',
						type: 'rectangle',
						x: 10,
						y: 20,
						width: 100,
						height: 60,
						angle: Math.PI / 4,
						strokeColor: '#111111',
						backgroundColor: '#eeeeee',
						opacity: 80,
						groupIds: ['g'],
						isDeleted: false
					},
					{
						id: 'arrow',
						type: 'arrow',
						x: 110,
						y: 50,
						width: 100,
						height: 0,
						angle: 0,
						points: [
							[0, 0],
							[100, 0]
						],
						strokeColor: '#222222',
						strokeWidth: 2,
						endArrowhead: 'arrow',
						startBinding: { elementId: 'box', focus: 0, gap: 1 },
						endBinding: null,
						isDeleted: false
					},
					{
						id: 'label',
						type: 'text',
						x: 130,
						y: 30,
						width: 50,
						height: 20,
						angle: 0,
						text: 'Flow',
						fontSize: 20,
						fontFamily: 2,
						strokeColor: '#222222',
						containerId: 'arrow',
						isDeleted: false
					},
					{
						id: 'stroke',
						type: 'freedraw',
						x: 0,
						y: 0,
						width: 20,
						height: 20,
						angle: 0,
						points: [
							[0, 0],
							[20, 20]
						],
						pressures: [0.2, 0.8],
						strokeColor: '#333333',
						strokeWidth: 3,
						isDeleted: false
					},
					{
						id: 'image',
						type: 'image',
						fileId: 'image',
						x: 0,
						y: 0,
						width: 10,
						height: 10,
						angle: 0,
						isDeleted: false
					}
				],
				appState: { viewBackgroundColor: '#ffffff' },
				files: { image: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } }
			}),
			'Drawing.excalidraw'
		);

		const shapes = Object.values(result.snapshot.doc.shapes);
		const rectangle = shapes.find((shape) => shape.type === 'rect');
		const arrow = shapes.find((shape) => shape.type === 'arrow');
		expect(rectangle).toMatchObject({ rot: Math.PI / 4, opacity: 0.8, groupId: 'excalidraw-group:g' });
		expect(arrow?.type === 'arrow' && arrow.props.label?.text).toBe('Flow');
		expect(Object.values(result.snapshot.doc.bindings)).toHaveLength(1);
		expect(shapes.some((shape) => shape.type === 'stroke')).toBe(true);
		expect(shapes.some((shape) => shape.type === 'image')).toBe(true);
		expect(Object.keys(result.snapshot.doc.assets ?? {})).toHaveLength(1);
		expect(result.warnings.map((warning) => warning.code)).toEqual(['excalidraw-app-state']);
	});

	it('exports an editable Excalidraw v2 scene', () => {
		const result = exportInterchange(board(), 'excalidraw');
		const scene = JSON.parse(result.contents);
		const arrow = scene.elements.find((element: { id: string }) => element.id === 'shape:arrow');
		const label = scene.elements.find((element: { containerId?: string }) => element.containerId === 'shape:arrow');

		expect(scene).toMatchObject({ type: 'excalidraw', version: 2, files: {} });
		expect(arrow).toMatchObject({
			type: 'arrow',
			startBinding: { elementId: 'shape:card' },
			endBinding: { elementId: 'shape:target' }
		});
		expect(label).toMatchObject({ type: 'text', text: 'connects', containerId: 'shape:arrow' });
		expect(result.warnings.map((warning) => warning.code)).toContain('excalidraw-markdown');
	});
});

describe('interchange validation', () => {
	it('rejects malformed and oversized input', () => {
		expect(() => importInterchange('{', 'bad.canvas')).toThrow('valid JSON');
		expect(() => importInterchange(JSON.stringify({ nodes: [{ id: 'a' }] }), 'bad.canvas')).toThrow(
			'nodes[0].type'
		);
		expect(() => importInterchange('x'.repeat(16 * 1024 * 1024 + 1), 'large.canvas')).toThrow('16 MB');
		expect(() =>
			importInterchange(
				JSON.stringify({
					nodes: [{ id: 'same', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '' }],
					edges: [{ id: 'same', fromNode: 'same', toNode: 'same' }]
				}),
				'duplicate.canvas'
			)
		).toThrow('duplicated');
	});
});
