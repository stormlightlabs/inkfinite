/// <reference lib="webworker" />

import type {
	DocumentSnapshot,
	EditorReconciliationRequest,
	SvgRenderOptions
} from '@inkfinite/wasm';
import {
	importSvgInWorkerRuntime,
	projectEditorInWorkerRuntime,
	reconcileEditorPatchesInWorkerRuntime,
	renderSvgInWorkerRuntime
} from './svg-import';

type Request =
	| { type: 'import'; id: number; source: ArrayBuffer }
	| { type: 'project'; id: number; snapshot: DocumentSnapshot }
	| {
			type: 'reconcile';
			id: number;
			snapshot: DocumentSnapshot;
			request: EditorReconciliationRequest;
	  }
	| { type: 'render'; id: number; snapshot: DocumentSnapshot; options: SvgRenderOptions };

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<Request>) => {
	try {
		let response: unknown;
		switch (event.data.type) {
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
		scope.postMessage({ id: event.data.id, response });
	} catch (error) {
		scope.postMessage({
			id: event.data.id,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
