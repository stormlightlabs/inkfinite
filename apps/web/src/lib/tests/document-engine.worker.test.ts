import type { DocumentSnapshot, EditorReconciliationRequest } from '@inkfinite/wasm';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getSharedDocumentEngineWorker,
	resetSharedDocumentEngineWorker
} from '../persistence/document-engine';

const snapshot: DocumentSnapshot = {
	format: 'inkfinite.document',
	format_version: 2,
	document_id: 'document:browser-smoke',
	heads: [],
	document: {
		pages: {
			'page:one': { id: 'page:one', name: 'Page 1', layer_ids: ['layer:one'], version: 1 }
		},
		page_ids: ['page:one'],
		layers: {
			'layer:one': {
				id: 'layer:one',
				page_id: 'page:one',
				name: 'Default',
				shape_ids: [],
				visible: true,
				locked: false,
				opacity: 1,
				version: 1
			}
		},
		shapes: {},
		bindings: {},
		assets: {}
	}
};

const request: EditorReconciliationRequest = {
	patches: [
		{
			type: 'create_shape',
			shape: {
				id: 'shape:rect',
				kind: 'rect',
				properties: { w: 20, h: 10, fill: '#ff0000' },
				metadata: null,
				style: { opacity: 1, fill_opacity: null, stroke_opacity: null },
				layout: null
			},
			parent: { kind: 'layer', id: 'layer:one' },
			transform: { a: 1, b: 0, c: 0, d: 1, e: 4, f: 5 },
			anchor: { position: 'last' }
		}
	],
	actor_id: 'browser',
	origin: 'human',
	transaction_id: 'transaction:create',
	description: 'Create rectangle',
	timestamp: 1
};

afterEach(resetSharedDocumentEngineWorker);

describe('compiled document engine worker', () => {
	it('runs the canonical browser document lifecycle', async () => {
		const worker = getSharedDocumentEngineWorker();
		let state = await worker.createDocument(snapshot, 'browser');
		expect(state.editor_projection.shapes).toEqual({});

		state = await worker.applyEditorPatches(request);
		expect(state.editor_projection.shapes['shape:rect']).toBeDefined();
		expect(state.can_undo).toBe(true);

		state = await worker.applyEditorPatches({
			...request,
			transaction_id: 'transaction:convert',
			description: 'Convert rectangle',
			patches: [
				{
					type: 'convert_shape',
					shape_id: 'shape:rect',
					kind: 'ellipse',
					properties: { w: 20, h: 10, fill: '#ff0000' },
					style: null
				}
			]
		});
		expect(state.snapshot.document.shapes['shape:rect']?.kind).toBe('ellipse');
		expect(state.snapshot.document.shapes['shape:rect']?.style.opacity).toBe(1);

		expect((await worker.undoDocument()).snapshot.document.shapes['shape:rect']?.kind).toBe(
			'rect'
		);
		state = await worker.redoDocument();
		expect(state.snapshot.document.shapes['shape:rect']).toBeDefined();

		const reopened = await worker.openDocument(state.bytes, 'browser');
		expect(reopened.snapshot.document.shapes['shape:rect']).toBeDefined();
		expect(reopened.editor_projection.shapes['shape:rect']).toBeDefined();

		const imported = await worker.importDocumentSvg(
			new TextEncoder().encode('<svg><path d="M0 0L8 8"/></svg>'),
			'line.svg',
			'page:one',
			'layer:one',
			2
		);
		expect(imported.shape_ids.length).toBeGreaterThan(1);
		const importedChildId = imported.shape_ids.at(-1)!;
		expect(imported.editor_projection.shapes[importedChildId]).toBeDefined();
		const rendered = await worker.render(imported.snapshot, { page_id: 'page:one' });
		expect(rendered.status).toBe('success');
		if (rendered.status === 'success') {
			expect(rendered.svg).toContain('<path');
			expect(rendered.svg).not.toContain('data:image/svg+xml');
		}

		const withoutImport = await worker.undoDocument();
		expect(withoutImport.snapshot.document.shapes[importedChildId]).toBeUndefined();
		const restoredImport = await worker.redoDocument();
		expect(restoredImport.snapshot.document.shapes[importedChildId]).toBeDefined();
		const reopenedImport = await worker.openDocument(restoredImport.bytes, 'browser');
		expect(reopenedImport.editor_projection.shapes[importedChildId]).toBeDefined();
	});
});
