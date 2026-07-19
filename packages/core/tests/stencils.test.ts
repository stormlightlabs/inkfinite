import { EditorState, LayerRecord, PageRecord, stencils } from '../src';
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
		expect(after.ui.selectionIds).toHaveLength(2);
		expect(after.doc.layers?.layer.shapeIds).toEqual(after.ui.selectionIds);
		expect(after.doc.layers?.layer.opacity).toBe(layerState.opacity);
		const inserted = after.ui.selectionIds.map((id) => after.doc.shapes[id]);
		expect(inserted.every((shape) => shape.layerId === 'layer')).toBe(true);
		expect(new Set(inserted.map((shape) => shape.groupId)).size).toBe(1);
		expect(inserted[0].x).toBe(25);
		expect(inserted[0].y).toBe(25);
	});
});
