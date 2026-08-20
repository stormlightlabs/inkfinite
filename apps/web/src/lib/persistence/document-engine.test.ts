import type { DocumentSnapshot } from '@inkfinite/wasm';
import { describe, expect, it } from 'vitest';
import { DocumentEngineWorkerClient } from './document-engine';

type Listener = (event: { data: unknown; message?: string }) => void;

type FakeMessage =
	| { type: 'import'; id: number; source: ArrayBuffer }
	| {
			type: 'import_document_svg';
			id: number;
			source: ArrayBuffer;
			sourceName: string;
			pageId: string;
			layerId: string;
			timestamp: number;
	  }
	| { type: 'project'; id: number; snapshot: unknown }
	| { type: 'reconcile'; id: number; snapshot: unknown; request: unknown }
	| { type: 'render'; id: number; snapshot: unknown; options: unknown };

class FakeWorker {
	private listeners = new Map<string, Set<Listener>>();
	lastMessage: FakeMessage | null = null;
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

	postMessage(message: FakeMessage, transfer: ArrayBuffer[]) {
		this.lastMessage = message;
		this.lastTransfer = transfer;
		queueMicrotask(() =>
			this.listeners
				.get('message')
				?.forEach((listener) =>
					listener({
						data:
							message.type === 'import'
								? {
										id: message.id,
										response: {
											status: 'success',
											import: {},
											omitted_image_count: 0
										}
									}
								: message.type === 'import_document_svg'
									? {
											id: message.id,
											response: {
												snapshot: {},
												editor_projection: {},
												can_undo: false,
												can_redo: false,
												bytes: new Uint8Array(),
												warnings: [],
												omitted_image_count: 0,
												shape_ids: [],
												source_asset_id: 'asset:source'
											}
										}
									: message.type === 'render'
										? {
												id: message.id,
												response: {
													status: 'success',
													svg: '<svg/>',
													warnings: []
												}
											}
										: message.type === 'project'
											? {
													id: message.id,
													response: {
														pages: {},
														layers: {},
														shapes: {},
														bindings: {},
														order: {
															page_ids: [],
															shape_order: {},
															layers: {}
														}
													}
												}
											: {
													id: message.id,
													response: {
														id: 'transaction:one',
														operations: []
													}
												}
					})
				)
		);
	}

	terminate() {
		this.terminated = true;
	}
}

describe('document engine worker client', () => {
	it('transfers bytes and resolves the normalized worker response', async () => {
		const worker = new FakeWorker();
		const client = new DocumentEngineWorkerClient(worker as unknown as Worker);
		const source = new Uint8Array([60, 115, 118, 103]);

		const result = await client.import(source);

		expect(worker.lastMessage?.type).toBe('import');
		expect(
			worker.lastMessage && 'source' in worker.lastMessage ? worker.lastMessage.source : null
		).toBeInstanceOf(ArrayBuffer);
		expect(worker.lastTransfer).toHaveLength(1);
		expect(worker.lastTransfer[0]).toBe(
			worker.lastMessage && 'source' in worker.lastMessage ? worker.lastMessage.source : null
		);
		expect(result.omitted_image_count).toBe(0);
		expect(source).toEqual(new Uint8Array([60, 115, 118, 103]));
		client.dispose();
		expect(worker.terminated).toBe(true);
	});

	it('routes document SVG imports through the worker-owned session', async () => {
		const worker = new FakeWorker();
		const client = new DocumentEngineWorkerClient(worker as unknown as Worker);

		const state = await client.importDocumentSvg(
			new Uint8Array([60, 115, 118, 103]),
			'icon.svg',
			'page:one',
			'layer:one'
		);

		expect(worker.lastMessage).toMatchObject({
			type: 'import_document_svg',
			sourceName: 'icon.svg',
			pageId: 'page:one',
			layerId: 'layer:one'
		});
		expect(state.source_asset_id).toBe('asset:source');
		client.dispose();
	});

	it('routes projection and reconciliation requests through the same worker', async () => {
		const worker = new FakeWorker();
		const client = new DocumentEngineWorkerClient(worker as unknown as Worker);

		const projection = await client.project({} as DocumentSnapshot);
		expect(worker.lastMessage).toMatchObject({ type: 'project' });
		expect(projection.order.page_ids).toEqual([]);

		const transaction = await client.reconcile({} as DocumentSnapshot, {} as never);
		expect(worker.lastMessage).toMatchObject({ type: 'reconcile' });
		expect(transaction.id).toBe('transaction:one');
		client.dispose();
	});

	it('routes canonical render requests through the same worker', async () => {
		const worker = new FakeWorker();
		const client = new DocumentEngineWorkerClient(worker as unknown as Worker);

		const result = await client.render({} as DocumentSnapshot, { page_id: 'page:one' });

		expect(worker.lastMessage).toMatchObject({
			type: 'render',
			options: { page_id: 'page:one' }
		});
		expect(result).toEqual({ status: 'success', svg: '<svg/>', warnings: [] });
		client.dispose();
	});
});
