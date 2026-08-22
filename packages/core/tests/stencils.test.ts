import { EditorState, LayerRecord, PageRecord, cardToContentObject, contentObjectToCard, stencils } from '../src';
import { describe, expect, it } from 'vitest';

function stateForLayer({ visible = true, locked = false, opacity = 1 } = {}) {
	const state = EditorState.create();
	const page = PageRecord.create('Page', 'page');
	const layer = { ...LayerRecord.create(page.id, 'Active', 'layer'), visible, locked, opacity };
	return {
		...state,
		doc: {
			pages: { [page.id]: { ...page, layerIds: [layer.id] } },
			layers: { [layer.id]: layer },
			shapes: {},
			bindings: {}
		},
		ui: { ...state.ui, currentPageId: page.id, activeLayerId: layer.id }
	};
}

describe('card content', () => {
	it('converts card fields to and from ordinary content records', () => {
		const [card] = contentObjectToCard(
			'page',
			{ x: 10, y: 20 },
			{
				title: 'Research note',
				body: 'Read the source',
				role: 'research.note',
				tags: ['source'],
				source: 'paper.pdf',
				link: 'https://example.com',
				customMetadata: { priority: 1 }
			}
		);
		const content = cardToContentObject(card);
		expect(content).toEqual({
			title: 'Research note',
			body: 'Read the source',
			role: 'research.note',
			tags: ['source'],
			source: 'paper.pdf',
			link: 'https://example.com',
			customMetadata: { priority: 1 }
		});
	});
});

describe('built-in stencils', () => {
	it('registers the curated flowchart, UI, and developer diagram sets once', () => {
		stencils.registerBuiltinStencils();
		stencils.registerBuiltinStencils();
		expect(stencils.registry.getAll().map(({ id }) => id)).toEqual(stencils.BUILTIN_STENCIL_IDS);
		expect(new Set(stencils.registry.getAll().map(({ category }) => category))).toEqual(
			new Set(['Flowchart', 'UI', 'Diagrams', 'Etc'])
		);
		for (const definition of stencils.registry.getAll()) {
			expect(definition.spawn({ x: 0, y: 0 }).length, definition.id).toBeGreaterThan(0);
		}
	});

	it.each([
		['visible', { visible: true, locked: false, opacity: 1 }, true],
		['hidden', { visible: false, locked: false, opacity: 1 }, false],
		['locked', { visible: true, locked: true, opacity: 1 }, false],
		['translucent', { visible: true, locked: false, opacity: 0.35 }, true]
	] as const)('inserts a grouped stencil atomically in a %s active layer', (_name, layerState, inserts) => {
		stencils.registerBuiltinStencils();
		const before = stateForLayer(layerState);
		const card = stencils.registry.get('ui:card')!;
		const after = stencils.insertStencil(
			before,
			card,
			{ x: 13, y: 37 },
			{ snapEnabled: true, gridEnabled: true, gridSize: 25 }
		);

		if (!inserts) {
			expect(after).toBe(before);
			return;
		}
		expect(after).not.toBe(before);
		expect(after.ui.selectionIds).toHaveLength(1);
		expect(after.doc.layers?.layer.shapeIds).toHaveLength(3);
		expect(after.doc.layers?.layer.opacity).toBe(layerState.opacity);
		const cardShape = after.doc.shapes[after.ui.selectionIds[0]];
		expect(cardShape?.type).toBe('container');
		expect(cardShape?.metadata?.title).toBe('Card title');
		expect(cardShape?.x).toBe(25);
		expect(cardShape?.y).toBe(25);
		const children = Object.values(after.doc.shapes).filter((shape) => shape.groupId === cardShape?.id);
		expect(children).toHaveLength(2);
		expect(children.map((shape) => shape.type)).toEqual(['text', 'markdown']);
		expect(children.every((shape) => shape.layerId === 'layer')).toBe(true);
	});
});
