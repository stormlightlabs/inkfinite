import { describe, expect, it } from 'vitest';
import { SvgImportWorkerClient } from './svg-import';

type Listener = (event: { data: unknown; message?: string }) => void;

class FakeWorker {
	private listeners = new Map<string, Set<Listener>>();
	lastMessage: { id: number; source: ArrayBuffer } | null = null;
	lastTransfer: ArrayBuffer[] = [];
	terminated = false;

	addEventListener(type: string, listener: Listener) {
		const listeners = this.listeners.get(type) ?? new Set<Listener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: Listener) {
		this.listeners.get(type)?.delete(listener);
	}

	postMessage(message: { id: number; source: ArrayBuffer }, transfer: ArrayBuffer[]) {
		this.lastMessage = message;
		this.lastTransfer = transfer;
		queueMicrotask(() =>
			this.listeners
				.get('message')
				?.forEach((listener) =>
					listener({
						data: {
							id: message.id,
							response: { status: 'success', import: {}, omitted_image_count: 0 }
						}
					})
				)
		);
	}

	terminate() {
		this.terminated = true;
	}
}

describe('SVG import worker client', () => {
	it('transfers bytes and resolves the normalized worker response', async () => {
		const worker = new FakeWorker();
		const client = new SvgImportWorkerClient(worker as unknown as Worker);
		const source = new Uint8Array([60, 115, 118, 103]);

		const result = await client.import(source);

		expect(worker.lastMessage?.source).toBeInstanceOf(ArrayBuffer);
		expect(worker.lastTransfer).toHaveLength(1);
		expect(worker.lastTransfer[0]).toBe(worker.lastMessage?.source);
		expect(result.omitted_image_count).toBe(0);
		expect(source).toEqual(new Uint8Array([60, 115, 118, 103]));
		client.dispose();
		expect(worker.terminated).toBe(true);
	});
});
