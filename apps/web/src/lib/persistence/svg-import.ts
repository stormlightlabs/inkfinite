import {
	importSvg as importSvgWasm,
	projectEditor as projectEditorWasm,
	reconcileEditorPatches as reconcileEditorPatchesWasm,
	renderSvg as renderSvgWasm
} from '@inkfinite/wasm';
import type {
	DocumentSnapshot,
	EditorProjection,
	EditorReconciliationRequest,
	SvgImportResponse,
	SvgRenderOptions,
	SvgRenderResponse,
	TransactionDraft,
	DocumentSessionState
} from '@inkfinite/wasm';
import type { SvgImportResult } from '@inkfinite/core';

/** A structured parser failure returned by the SVG worker. */
export class SvgImportWorkerError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'SvgImportError';
	}
}

type WorkerRequestBody =
	| { type: 'import'; source: ArrayBuffer }
	| { type: 'open_document'; source: ArrayBuffer; actorId: string }
	| { type: 'create_document'; snapshot: DocumentSnapshot; actorId: string }
	| { type: 'document_state' }
	| { type: 'apply_transaction'; transaction: TransactionDraft }
	| { type: 'apply_editor_patches'; request: EditorReconciliationRequest }
	| { type: 'undo_document' }
	| { type: 'redo_document' }
	| { type: 'project'; snapshot: DocumentSnapshot }
	| { type: 'reconcile'; snapshot: DocumentSnapshot; request: EditorReconciliationRequest }
	| { type: 'render'; snapshot: DocumentSnapshot; options: SvgRenderOptions };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type WorkerRequest = WorkerRequestBody & { id: number };

type WorkerResponse =
	| {
			id: number;
			response:
				| SvgImportResponse
				| SvgRenderResponse
				| BrowserDocumentState
				| EditorProjection
				| TransactionDraft;
	  }
	| { id: number; error: string };

export type BrowserDocumentState = DocumentSessionState & { bytes: Uint8Array };

type WorkerResponseValue =
	| SvgImportResponse
	| SvgRenderResponse
	| EditorProjection
	| TransactionDraft
	| BrowserDocumentState;

/** A worker boundary that keeps Rust parsing, rendering, and document state off the UI thread. */
export class SvgImportWorkerClient {
	private nextRequestId = 0;
	private readonly pending = new Map<
		number,
		{ resolve: (value: WorkerResponseValue) => void; reject: (error: Error) => void }
	>();

	constructor(private readonly worker: Worker) {
		worker.addEventListener('message', this.handleMessage);
		worker.addEventListener('error', this.handleError);
	}

	/** Imports one transferred byte buffer. */
	async import(source: Uint8Array): Promise<SvgImportResult> {
		const transferable = source.slice();
		const response = await this.request<SvgImportResponse>(
			{ type: 'import', source: transferable.buffer },
			[transferable.buffer]
		);

		if (response.status === 'error') {
			throw new SvgImportWorkerError(response.error.code, response.error.message);
		}
		return { ...response.import, omitted_image_count: response.omitted_image_count };
	}

	/** Opens canonical bytes in the worker-owned Rust document session. */
	openDocument(source: Uint8Array, actorId: string): Promise<BrowserDocumentState> {
		const transferable = source.slice();
		return this.request<BrowserDocumentState>(
			{ type: 'open_document', source: transferable.buffer, actorId },
			[transferable.buffer]
		);
	}

	/** Creates a Rust document session from a migrated materialized snapshot. */
	createDocument(snapshot: DocumentSnapshot, actorId: string): Promise<BrowserDocumentState> {
		return this.request<BrowserDocumentState>({ type: 'create_document', snapshot, actorId });
	}

	/** Returns the worker session state and fresh canonical bytes. */
	documentState(): Promise<BrowserDocumentState> {
		return this.request<BrowserDocumentState>({ type: 'document_state' });
	}

	/** Applies one prepared transaction through the worker-owned Rust engine. */
	applyTransaction(transaction: TransactionDraft): Promise<BrowserDocumentState> {
		return this.request<BrowserDocumentState>({ type: 'apply_transaction', transaction });
	}

	/** Reconciles semantic editor patches through the worker-owned Rust engine. */
	applyEditorPatches(request: EditorReconciliationRequest): Promise<BrowserDocumentState> {
		return this.request<BrowserDocumentState>({ type: 'apply_editor_patches', request });
	}

	/** Compensates the latest document transaction in Rust. */
	undoDocument(): Promise<BrowserDocumentState> {
		return this.request<BrowserDocumentState>({ type: 'undo_document' });
	}

	/** Reapplies the latest compensated document transaction in Rust. */
	redoDocument(): Promise<BrowserDocumentState> {
		return this.request<BrowserDocumentState>({ type: 'redo_document' });
	}

	/** Projects one canonical snapshot into the shared flat editor view. */
	project(snapshot: DocumentSnapshot): Promise<EditorProjection> {
		return this.request<EditorProjection>({ type: 'project', snapshot });
	}

	/** Reconciles semantic editor changes into one native transaction draft. */
	reconcile(
		snapshot: DocumentSnapshot,
		request: EditorReconciliationRequest
	): Promise<TransactionDraft> {
		return this.request<TransactionDraft>({ type: 'reconcile', snapshot, request });
	}

	/** Renders one canonical snapshot through the Rust SVG renderer. */
	render(
		snapshot: DocumentSnapshot,
		options: SvgRenderOptions = {}
	): Promise<SvgRenderResponse> {
		return this.request<SvgRenderResponse>({ type: 'render', snapshot, options });
	}

	/** Stops the shared worker and rejects requests that have not completed. */
	dispose() {
		this.worker.removeEventListener('message', this.handleMessage);
		this.worker.removeEventListener('error', this.handleError);
		this.worker.terminate();
		this.rejectPending(new Error('The SVG worker was stopped.'));
	}

	private request<T extends WorkerResponseValue>(
		message: WorkerRequestBody,
		transfer: Transferable[] = []
	): Promise<T> {
		const id = ++this.nextRequestId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
			this.worker.postMessage({ ...message, id }, transfer);
		});
	}

	private readonly handleMessage = (event: MessageEvent<WorkerResponse>) => {
		const request = this.pending.get(event.data.id);
		if (!request) return;
		this.pending.delete(event.data.id);
		if ('error' in event.data) {
			request.reject(new Error(event.data.error));
			return;
		}
		request.resolve(event.data.response);
	};

	private readonly handleError = (event: ErrorEvent) => {
		this.rejectPending(new Error(event.message || 'The SVG worker failed.'));
	};

	private rejectPending(error: Error) {
		for (const request of this.pending.values()) request.reject(error);
		this.pending.clear();
	}
}

let sharedClient: SvgImportWorkerClient | null = null;

/** Returns the one SVG worker shared by browser file, drop, markup, and export actions. */
export function getSharedSvgImportWorker(): SvgImportWorkerClient {
	if (typeof Worker === 'undefined')
		throw new Error('SVG workers are unavailable in this environment.');
	sharedClient ??= new SvgImportWorkerClient(
		new Worker(new URL('./svg-import.worker.ts', import.meta.url), {
			type: 'module',
			name: 'inkfinite-svg'
		})
	);
	return sharedClient;
}

/** Allows browser tests and hot reload teardown to release the shared worker. */
export function resetSharedSvgImportWorker() {
	sharedClient?.dispose();
	sharedClient = null;
}

/** Imports SVG bytes through the shared worker. */
export function importSvgInWorker(source: Uint8Array) {
	return getSharedSvgImportWorker().import(source);
}

/** Projects a canonical snapshot through the shared worker. */
export function projectEditorInWorker(snapshot: DocumentSnapshot) {
	return getSharedSvgImportWorker().project(snapshot);
}

/** Reconciles semantic editor patches through the shared worker. */
export function reconcileEditorPatchesInWorker(
	snapshot: DocumentSnapshot,
	request: EditorReconciliationRequest
) {
	return getSharedSvgImportWorker().reconcile(snapshot, request);
}

/** Renders a canonical snapshot through the shared worker. */
export function renderSvgInWorker(snapshot: DocumentSnapshot, options: SvgRenderOptions = {}) {
	return getSharedSvgImportWorker().render(snapshot, options);
}

/** Used by the worker entry point to run the generated Rust/WASM bindings. */
export async function importSvgInWorkerRuntime(source: Uint8Array) {
	return importSvgWasm(source);
}

/** Used by the worker entry point to run the generated Rust/WASM bindings. */
export async function projectEditorInWorkerRuntime(snapshot: DocumentSnapshot) {
	return projectEditorWasm(snapshot);
}

/** Used by the worker entry point to run the generated Rust/WASM bindings. */
export async function reconcileEditorPatchesInWorkerRuntime(
	snapshot: DocumentSnapshot,
	request: EditorReconciliationRequest
) {
	return reconcileEditorPatchesWasm(snapshot, request);
}

/** Used by the worker entry point to run the generated Rust/WASM bindings. */
export async function renderSvgInWorkerRuntime(
	snapshot: DocumentSnapshot,
	options: SvgRenderOptions
) {
	return renderSvgWasm(snapshot, options);
}
