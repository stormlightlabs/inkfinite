import { importSvgInWorkerRuntime } from './svg-import';

type Request = { id: number; source: ArrayBuffer };
type WorkerScope = {
	onmessage: ((event: MessageEvent<Request>) => void) | null;
	postMessage(message: unknown): void;
};

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = async (event) => {
	try {
		const response = await importSvgInWorkerRuntime(new Uint8Array(event.data.source));
		scope.postMessage({ id: event.data.id, response });
	} catch (error) {
		scope.postMessage({
			id: event.data.id,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
