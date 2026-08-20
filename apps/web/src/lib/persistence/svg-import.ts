import { importSvg as importSvgWasm, type SvgImportResponse } from '@inkfinite/wasm';
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

/** A worker boundary that keeps SVG decoding and Rust parsing off the UI thread. */
export class SvgImportWorkerClient {
	private nextRequestId = 0;
	private readonly pending = new Map<
		number,
		{ resolve: (value: SvgImportResult) => void; reject: (error: Error) => void }
	>();

	constructor(private readonly worker: Worker) {
		worker.addEventListener('message', this.handleMessage);
		worker.addEventListener('error', this.handleError);
	}

	/** Imports one transferred byte buffer. */
	import(source: Uint8Array): Promise<SvgImportResult> {
		const id = ++this.nextRequestId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			const transferable = source.slice();
			this.worker.postMessage({ id, source: transferable.buffer }, [transferable.buffer]);
		});
	}

	/** Stops the shared worker and rejects requests that have not completed. */
	dispose() {
		this.worker.removeEventListener('message', this.handleMessage);
		this.worker.removeEventListener('error', this.handleError);
		this.worker.terminate();
		this.rejectPending(new Error('The SVG import worker was stopped.'));
	}

	private readonly handleMessage = (event: MessageEvent<WorkerResponse>) => {
		const request = this.pending.get(event.data.id);
		if (!request) return;
		this.pending.delete(event.data.id);
		if ('error' in event.data) {
			request.reject(new Error(event.data.error));
			return;
		}
		const response = event.data.response;
		if (response.status === 'error') {
			request.reject(new SvgImportWorkerError(response.error.code, response.error.message));
			return;
		}
		request.resolve({ ...response.import, omitted_image_count: response.omitted_image_count });
	};

	private readonly handleError = (event: ErrorEvent) => {
		this.rejectPending(new Error(event.message || 'The SVG import worker failed.'));
	};

	private rejectPending(error: Error) {
		for (const request of this.pending.values()) request.reject(error);
		this.pending.clear();
	}
}

type WorkerResponse = { id: number; response: SvgImportResponse } | { id: number; error: string };

let sharedClient: SvgImportWorkerClient | null = null;

/** Returns the one SVG worker shared by browser file, drop, and markup imports. */
export function getSharedSvgImportWorker(): SvgImportWorkerClient {
	if (typeof Worker === 'undefined')
		throw new Error('SVG import workers are unavailable in this environment.');
	sharedClient ??= new SvgImportWorkerClient(
		new Worker(new URL('./svg-import.worker.ts', import.meta.url), {
			type: 'module',
			name: 'inkfinite-svg-import'
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

/** Used by the worker entry point to run the generated Rust binding. */
export async function importSvgInWorkerRuntime(source: Uint8Array) {
	return importSvgWasm(source);
}
