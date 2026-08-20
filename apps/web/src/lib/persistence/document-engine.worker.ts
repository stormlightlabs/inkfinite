/// <reference lib="webworker" />

import type {
	DocumentSnapshot,
	EditorReconciliationRequest,
	SvgRenderOptions,
	TransactionDraft
} from '@inkfinite/wasm';
import { WasmDocumentSession } from '@inkfinite/wasm';
import {
	importSvgInWorkerRuntime,
	projectEditorInWorkerRuntime,
	reconcileEditorPatchesInWorkerRuntime,
	renderSvgInWorkerRuntime
} from './document-engine';

type Request =
	| { type: 'import'; id: number; source: ArrayBuffer }
	| { type: 'open_document'; id: number; source: ArrayBuffer; actorId: string }
	| { type: 'create_document'; id: number; snapshot: DocumentSnapshot; actorId: string }
	| {
			type: 'import_document_svg';
			id: number;
			source: ArrayBuffer;
			sourceName: string;
			pageId: string;
			layerId: string;
			timestamp: number;
	  }
	| { type: 'document_state'; id: number }
	| { type: 'apply_transaction'; id: number; transaction: TransactionDraft }
	| { type: 'apply_editor_patches'; id: number; request: EditorReconciliationRequest }
	| { type: 'undo_document'; id: number }
	| { type: 'redo_document'; id: number }
	| { type: 'project'; id: number; snapshot: DocumentSnapshot }
	| {
			type: 'reconcile';
			id: number;
			snapshot: DocumentSnapshot;
			request: EditorReconciliationRequest;
	  }
	| { type: 'render'; id: number; snapshot: DocumentSnapshot; options: SvgRenderOptions };

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
let documentSession: WasmDocumentSession | null = null;

function documentState() {
	if (!documentSession) throw new Error('No browser document is open in the Rust worker.');
	return { ...documentSession.state(), bytes: documentSession.save() };
}

scope.onmessage = async (event: MessageEvent<Request>) => {
	try {
		let response: unknown;
		switch (event.data.type) {
			case 'open_document': {
				documentSession = await WasmDocumentSession.open(
					new Uint8Array(event.data.source),
					event.data.actorId
				);
				response = documentState();
				break;
			}
			case 'create_document': {
				documentSession = await WasmDocumentSession.create(
					event.data.snapshot,
					event.data.actorId
				);
				response = documentState();
				break;
			}
			case 'import_document_svg': {
				if (!documentSession) {
					throw new Error('No browser document is open in the Rust worker.');
				}
				const imported = documentSession.importSvg(
					new Uint8Array(event.data.source),
					event.data.sourceName,
					event.data.pageId,
					event.data.layerId,
					event.data.timestamp
				);
				response = { ...imported, ...imported.state, bytes: documentSession.save() };
				break;
			}
			case 'document_state':
			case 'apply_transaction':
			case 'apply_editor_patches':
			case 'undo_document':
			case 'redo_document': {
				if (!documentSession) {
					throw new Error('No browser document is open in the Rust worker.');
				}
				if (event.data.type === 'apply_transaction') {
					documentSession.applyTransaction(event.data.transaction);
				}
				if (event.data.type === 'apply_editor_patches') {
					documentSession.applyEditorPatches(event.data.request);
				}
				if (event.data.type === 'undo_document') documentSession.undo();
				if (event.data.type === 'redo_document') documentSession.redo();
				response = documentState();
				break;
			}
			case 'import': {
				response = await importSvgInWorkerRuntime(new Uint8Array(event.data.source));
				break;
			}
			case 'project': {
				response = await projectEditorInWorkerRuntime(event.data.snapshot);
				break;
			}
			case 'reconcile': {
				response = await reconcileEditorPatchesInWorkerRuntime(
					event.data.snapshot,
					event.data.request
				);
				break;
			}
			case 'render': {
				response = await renderSvgInWorkerRuntime(event.data.snapshot, event.data.options);
				break;
			}
		}
		const transfer =
			response &&
			typeof response === 'object' &&
			'bytes' in response &&
			response.bytes instanceof Uint8Array
				? [response.bytes.buffer]
				: [];
		scope.postMessage({ id: event.data.id, response }, transfer);
	} catch (error) {
		scope.postMessage({
			id: event.data.id,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
