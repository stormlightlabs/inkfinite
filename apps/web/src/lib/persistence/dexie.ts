import {
	createEditorReconciliationRequest,
	diffDoc,
	toCanonicalDocumentSnapshot
} from '@inkfinite/core';
import type {
	BoardExport,
	DocPatch,
	EditorDocumentChange,
	InterchangeExport,
	PersistenceSink,
	PersistentDocRepo,
	SvgExport,
	SvgExportOptions
} from '@inkfinite/core';
import { createStatusStore } from '@inkfinite/ui/editor';
import type { EditorPlatformAdapter, EditorPlatformSession } from '@inkfinite/ui/editor';
import { liveQuery } from 'dexie';
import { InkfiniteDB } from './database';
import { createDexieDocRepo, createPersistenceSink, getBoardInspectorData } from './repository';
import { getSharedSvgImportWorker, importSvgInWorker, renderSvgInWorker } from './svg-import';
import type { BrowserDocumentState } from './svg-import';
import type { PersistenceSinkOptions } from './repository';
import type { LoadedDoc } from '@inkfinite/core';

type LiveQueryFactory = typeof liveQuery;

/** Test and tuning hooks for the Dexie persistence adapter. */
export type DexieAdapterOptions = {
	database?: InkfiniteDB;
	sink?: PersistenceSinkOptions;
	liveQueryFn?: LiveQueryFactory;
};

/** Creates the static web application's Dexie-backed editor adapter. */
export function createDexiePlatformAdapter(opts: DexieAdapterOptions = {}): EditorPlatformAdapter {
	return {
		kind: 'web',
		async connect() {
			const database = opts.database ?? new InkfiniteDB();
			const repo = createDexieDocRepo(database);
			return createDexieSession(database, repo, opts);
		}
	};
}

/** Connects an existing Dexie database and repository to the editor contract. */
export function createDexieSession(
	database: InkfiniteDB,
	repo: PersistentDocRepo,
	opts: Omit<DexieAdapterOptions, 'database'> = {}
): EditorPlatformSession {
	const sink = createPersistenceSink(repo, opts.sink);
	const status = createStatusStore({ backend: 'indexeddb', state: 'saved', pendingWrites: 0 });
	const liveQueryFactory = opts.liveQueryFn ?? liveQuery;
	let activeBoardId: string | null = null;
	let subscription: { unsubscribe(): void } | null = null;
	let documentWorker: ReturnType<typeof getSharedSvgImportWorker> | null = null;
	let documentBoardId: string | null = null;
	let documentReady: Promise<void> | null = null;
	let documentQueue: Promise<void> = Promise.resolve();
	let transactionNumber = 0;
	const canonicalEnabled =
		typeof Worker !== 'undefined' &&
		typeof repo.loadCanonical === 'function' &&
		typeof repo.saveCanonical === 'function';

	function markSaved(timestamp?: number) {
		status.update((current) => ({
			...current,
			pendingWrites: 0,
			state: 'saved',
			lastSavedAt: timestamp ?? current.lastSavedAt,
			errorMsg: undefined
		}));
	}

	function markError(error: unknown) {
		status.update((current) => ({
			...current,
			state: 'error',
			errorMsg: error instanceof Error ? error.message : String(error)
		}));
	}

	function ensureDocumentWorker() {
		if (!canonicalEnabled) return null;
		documentWorker ??= getSharedSvgImportWorker();
		return documentWorker;
	}

	function loadedDocument(doc: LoadedDoc) {
		return {
			pages: doc.pages,
			...(doc.layers ? { layers: doc.layers } : {}),
			...(doc.assets ? { assets: doc.assets } : {}),
			...(doc.svgGroups ? { svgGroups: doc.svgGroups } : {}),
			shapes: doc.shapes,
			bindings: doc.bindings
		};
	}

	function openCanonicalDocument(boardId: string, doc: LoadedDoc): Promise<void> {
		const worker = ensureDocumentWorker();
		if (!worker || !repo.loadCanonical || !repo.saveCanonical) return Promise.resolve();
		documentBoardId = boardId;
		return (async () => {
			const canonical = await repo.loadCanonical!(boardId);
			const state = canonical
				? await worker.openDocument(canonical.bytes, 'browser')
				: await worker.createDocument(
						toCanonicalDocumentSnapshot(loadedDocument(doc), { documentId: boardId }),
						'browser'
					);
			if (!canonical) await repo.saveCanonical!(boardId, state);
		})();
	}

	function setActiveDocument(boardId: string, doc: LoadedDoc) {
		if (!canonicalEnabled) return;
		if (documentBoardId === boardId && documentReady) return;
		documentReady = openCanonicalDocument(boardId, doc).catch((error) => {
			documentBoardId = null;
			throw error;
		});
	}

	function enqueueEditorChange(change: EditorDocumentChange) {
		if (!canonicalEnabled || !repo.saveCanonical) {
			sink.enqueueDocPatch(change.boardId, diffDoc(change.before, change.after));
			return;
		}
		status.update((current) => ({
			...current,
			pendingWrites: (current.pendingWrites ?? 0) + 1,
			state: 'saving',
			errorMsg: undefined
		}));
		const run = async () => {
			setActiveDocument(change.boardId, {
				pages: change.before.pages,
				layers: change.before.layers,
				assets: change.before.assets,
				svgGroups: change.before.svgGroups,
				shapes: change.before.shapes,
				bindings: change.before.bindings,
				order: { pageIds: Object.keys(change.before.pages), layers: change.before.layers }
			});
			await documentReady;
			const worker = ensureDocumentWorker();
			if (!worker) throw new Error('The browser document worker is unavailable.');
			let state;
			if (change.op === 'undo') {
				state = await worker.undoDocument();
			} else if (change.op === 'redo') {
				state = await worker.redoDocument();
			} else {
				const request = createEditorReconciliationRequest(change.before, change.after, {
					actor_id: 'browser',
					origin: 'human',
					transaction_id: `transaction:browser:${++transactionNumber}`,
					description: change.description,
					timestamp: Date.now()
				});
				if (request.patches.length === 0) return;
				state = await worker.applyEditorPatches(request);
			}
			await repo.saveCanonical!(change.boardId, state);
		};
		documentQueue = documentQueue
			.catch(() => {})
			.then(run)
			.catch((error) => {
				markError(error);
				throw error;
			});
	}

	const trackedSink: PersistenceSink = {
		enqueueDocPatch(boardId, patch) {
			if (hasPatchChanges(patch)) {
				status.update((current) => ({
					...current,
					pendingWrites: (current.pendingWrites ?? 0) + 1,
					state: 'saving',
					errorMsg: undefined
				}));
			}
			sink.enqueueDocPatch(boardId, patch);
		},
		enqueueEditorChange,
		async flush() {
			try {
				await documentReady;
				await documentQueue;
				await sink.flush();
			} catch (error) {
				markError(error);
				throw error;
			}
		}
	};

	return {
		repo,
		sink: trackedSink,
		status,
		interchange: createBrowserInterchangeFiles(async (boardId) => {
			if (!documentWorker || documentBoardId !== boardId) return null;
			await documentReady;
			await documentQueue;
			return (await documentWorker.documentState()).snapshot;
		}),
		inspectBoard: (boardId) => getBoardInspectorData(database, boardId),
		setActiveBoard(boardId) {
			if (activeBoardId === boardId) return;
			subscription?.unsubscribe();
			subscription = null;
			activeBoardId = boardId;
			if (!boardId) return;

			subscription = liveQueryFactory(() => database.boards.get(boardId)).subscribe({
				next(board) {
					if (board?.updatedAt !== undefined) markSaved(board.updatedAt);
				},
				error: markError
			});
		},
		setActiveDocument,
		dispose() {
			subscription?.unsubscribe();
			subscription = null;
		}
	};
}

/** Creates browser-backed file selection and download operations. */
export function createBrowserInterchangeFiles(
	getCanonicalSnapshot?: (boardId: string) => Promise<BrowserDocumentState['snapshot'] | null>
) {
	function pickTextFile(accept: string): Promise<{ name: string; contents: string } | null> {
		return new Promise((resolve, reject) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = accept;
			input.hidden = true;
			const finish = (value: { name: string; contents: string } | null) => {
				input.remove();
				resolve(value);
			};
			input.addEventListener('cancel', () => finish(null), { once: true });
			input.addEventListener(
				'change',
				() => {
					const file = input.files?.[0];
					if (!file) {
						finish(null);
						return;
					}
					if (file.size > 16 * 1024 * 1024) {
						input.remove();
						reject(
							new Error('The selected file is larger than the 16 MB import limit.')
						);
						return;
					}
					void file.text().then(
						(contents) => finish({ name: file.name, contents }),
						(error) => {
							input.remove();
							reject(
								new Error(`Failed to read the selected file: ${String(error)}`)
							);
						}
					);
				},
				{ once: true }
			);
			document.body.appendChild(input);
			input.click();
		});
	}

	function pickSvgFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
		return new Promise((resolve, reject) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.svg,image/svg+xml';
			input.hidden = true;
			const finish = (value: { name: string; bytes: Uint8Array } | null) => {
				input.remove();
				resolve(value);
			};
			input.addEventListener('cancel', () => finish(null), { once: true });
			input.addEventListener(
				'change',
				() => {
					const file = input.files?.[0];
					if (!file) {
						finish(null);
						return;
					}
					if (file.size > 16 * 1024 * 1024) {
						input.remove();
						reject(
							new Error('The selected file is larger than the 16 MB import limit.')
						);
						return;
					}
					void file.arrayBuffer().then(
						(bytes) => finish({ name: file.name, bytes: new Uint8Array(bytes) }),
						(error) => {
							input.remove();
							reject(new Error(`Failed to read the selected SVG: ${String(error)}`));
						}
					);
				},
				{ once: true }
			);
			document.body.appendChild(input);
			input.click();
		});
	}

	return {
		pickImport: () => pickTextFile('.excalidraw,.canvas,application/json'),
		pickSvg: pickSvgFile,
		importSvg: importSvgInWorker,
		async exportSvg(
			snapshot: BoardExport,
			options: SvgExportOptions = {}
		): Promise<SvgExport> {
			const canonical =
				(await getCanonicalSnapshot?.(snapshot.board.id)) ??
				toCanonicalDocumentSnapshot(snapshot);
			if (options.selectionOnly && !(options.selectionIds?.length ?? 0)) {
				canonical.document = {
					...canonical.document,
					layers: Object.fromEntries(
						Object.entries(canonical.document.layers).map(([id, layer]) => [
							id,
							{ ...layer, shape_ids: [] }
						])
					),
					shapes: {},
					bindings: {}
				};
			}
			const response = await renderSvgInWorker(canonical, {
				page_id: options.pageId,
				selection: options.selectionIds ?? []
			});
			if (response.status === 'error') {
				throw new Error(`${response.error.code}: ${response.error.message}`);
			}
			return {
				format: 'svg',
				contents: response.svg,
				extension: 'svg',
				mimeType: 'image/svg+xml',
				warnings: response.warnings.map((warning) => ({
					code: `svg-${warning.code}`,
					message: warning.message,
					count: 1
				}))
			};
		},
		async saveExport(
			file: InterchangeExport | SvgExport,
			defaultStem: string
		): Promise<boolean> {
			const blob = new Blob([file.contents], { type: file.mimeType });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `${safeFileStem(defaultStem)}.${file.extension}`;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
			return true;
		}
	};
}

function safeFileStem(value: string) {
	return (
		value
			.trim()
			.replace(/[\\/:*?"<>|]+/g, '-')
			.replace(/^\.+|\.+$/g, '') || 'Untitled'
	);
}

function hasPatchChanges(patch: DocPatch): boolean {
	const upserts = patch.upserts;
	if (upserts?.pages?.length || upserts?.shapes?.length || upserts?.bindings?.length)
		return true;

	const deletes = patch.deletes;
	if (deletes?.pageIds?.length || deletes?.shapeIds?.length || deletes?.bindingIds?.length)
		return true;

	return Boolean(
		patch.order?.pageIds?.length ||
		Object.keys(patch.order?.shapeOrder ?? {}).length ||
		Object.keys(patch.order?.layers ?? {}).length
	);
}
