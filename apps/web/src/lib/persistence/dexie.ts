import {
	type DocPatch,
	type InterchangeExport,
	type PersistenceSink,
	type PersistentDocRepo
} from '@inkfinite/core';
import { createStatusStore } from '@inkfinite/ui/editor';
import type { EditorPlatformAdapter, EditorPlatformSession } from '@inkfinite/ui/editor';
import { liveQuery } from 'dexie';
import { InkfiniteDB } from './database';
import { createDexieDocRepo, createPersistenceSink, getBoardInspectorData } from './repository';
import type { PersistenceSinkOptions } from './repository';

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
		async flush() {
			try {
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
		interchange: createBrowserInterchangeFiles(),
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
		dispose() {
			subscription?.unsubscribe();
			subscription = null;
		}
	};
}

/** Creates browser-backed file selection and download operations. */
export function createBrowserInterchangeFiles() {
	return {
		pickImport(): Promise<{ name: string; contents: string } | null> {
			return new Promise((resolve, reject) => {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = '.excalidraw,.canvas,application/json';
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
							reject(new Error('The selected file is larger than the 16 MB import limit.'));
							return;
						}
						void file.text().then(
							(contents) => finish({ name: file.name, contents }),
							(error) => {
								input.remove();
								reject(new Error(`Failed to read the selected file: ${String(error)}`));
							}
						);
					},
					{ once: true }
				);
				document.body.appendChild(input);
				input.click();
			});
		},
		async saveExport(file: InterchangeExport, defaultStem: string): Promise<boolean> {
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
