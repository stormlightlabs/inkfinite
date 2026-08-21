import type { DesktopFileOps } from '@inkfinite/core';
import type { DocumentSnapshot, Proposal } from '@inkfinite/bindings';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(async () => () => undefined) }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));

import { createDesktopSessionRepo } from './desktop-session';
import type { SessionCommit, SessionOpened, SessionSaved, SessionStatus } from './desktop-session';

function snapshot(documentId: string): DocumentSnapshot {
	const pageId = `page:${documentId}:1`;
	const layerId = `layer:${documentId}:1`;
	return {
		format: 'inkfinite',
		format_version: 2,
		document_id: documentId,
		heads: ['head:1'],
		document: {
			pages: { [pageId]: { id: pageId, name: 'Page 1', layer_ids: [layerId], version: 1 } },
			page_ids: [pageId],
			layers: {
				[layerId]: {
					id: layerId,
					page_id: pageId,
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
}

function fileOps() {
	let savePath = '/tmp/Untitled.inkfinite';
	const ops: DesktopFileOps = {
		showOpenDialog: async () => null,
		showSaveDialog: async () => savePath,
		showSvgDialog: async () => null,
		getRecentFiles: async () => [],
		addRecentFile: async () => undefined,
		removeRecentFile: async () => undefined,
		clearRecentFiles: async () => undefined,
		getWorkspaceDir: async () => null,
		setWorkspaceDir: async () => undefined,
		pickWorkspaceDir: async () => null,
		readDirectory: async () => [],
		renameFile: async () => undefined,
		deleteFile: async () => undefined
	};
	return { ops, setSavePath: (path: string) => (savePath = path) };
}

describe('Tauri desktop session command boundary', () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockClear();
	});

	it('uses camelCase command arguments for files and agent access', async () => {
		const files = fileOps();
		let currentPath = '/tmp/Untitled.inkfinite';
		const document = snapshot('board:test');
		tauri.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
			if (command === 'create_document') {
				expect(args).toMatchObject({
					path: currentPath,
					documentId: expect.stringMatching(/^board:/),
					actorId: 'actor:desktop',
					pageName: 'Page 1'
				});
				expect(args).not.toHaveProperty('document_id');
				return {
					session_id: 'session:1',
					status: {
						session_id: 'session:1',
						path: currentPath,
						actor_id: 'actor:desktop',
						snapshot: document,
						dirty: false,
						lock_held: true,
						recovery_available: false,
						can_undo: false,
						can_redo: false,
						sync: { status: 'disabled' }
					}
				} satisfies SessionOpened;
			}
			if (command === 'save_as') {
				expect(args).toEqual({
					sessionId: 'session:1',
					path: '/tmp/Renamed.inkfinite',
					expectedHeads: ['head:1']
				});
				expect(args).not.toHaveProperty('session_id');
				currentPath = '/tmp/Renamed.inkfinite';
				return {
					save: { path: currentPath, heads: ['head:1'] },
					status: {
						session_id: 'session:1',
						path: currentPath,
						actor_id: 'actor:desktop',
						snapshot: document,
						dirty: false,
						lock_held: true,
						recovery_available: false,
						can_undo: false,
						can_redo: false,
						sync: { status: 'disabled' }
					}
				} satisfies SessionSaved;
			}

			throw new Error(`Unexpected command: ${command}`);
		});

		const repo = createDesktopSessionRepo(files.ops);
		await repo.createBoard('Untitled');
		files.setSavePath('/tmp/Renamed.inkfinite');
		await repo.saveAs();

		expect(tauri.invoke).toHaveBeenCalledWith('create_document', expect.any(Object));
		expect(tauri.invoke).toHaveBeenCalledWith('save_as', expect.any(Object));
	});

	it('turns structured Tauri failures into readable errors', async () => {
		const files = fileOps();
		tauri.invoke.mockImplementation(async (command: string) => {
			if (command === 'record_renderer_error') return undefined;
			throw { code: 'document_locked', message: 'Another editor holds the document lock.' };
		});

		const repo = createDesktopSessionRepo(files.ops);

		await expect(repo.createBoard('Locked')).rejects.toThrow('Another editor holds the document lock.');
		expect(tauri.invoke).toHaveBeenCalledWith('record_renderer_error', {
			message: 'create_document failed: Another editor holds the document lock.'
		});
	});

	it('publishes live CLI commits to mounted editor subscribers', async () => {
		const files = fileOps();
		const document = snapshot('board:live-commit');
		const status: SessionStatus = {
			session_id: 'session:1',
			path: '/tmp/Untitled.inkfinite',
			actor_id: 'actor:desktop',
			snapshot: document,
			dirty: false,
			lock_held: true,
			recovery_available: false,
			can_undo: true,
			can_redo: false,
			sync: { status: 'disabled' }
		};
		tauri.invoke.mockImplementation(async (command: string) => {
			if (command !== 'create_document') throw new Error(`Unexpected command: ${command}`);
			return { session_id: 'session:1', status } satisfies SessionOpened;
		});
		const repo = createDesktopSessionRepo(files.ops);
		await repo.createBoard('Untitled');
		const onDocument = vi.fn();
		repo.subscribeLiveDocument(onDocument);
		const listenCalls = tauri.listen.mock.calls as unknown as Array<
			[string, (event: { payload: { session_id: string; commit: SessionCommit } }) => void]
		>;
		const commitListener = listenCalls.find(([event]) => event === 'inkfinite-live-commit')?.[1];
		expect(commitListener).toBeTypeOf('function');

		commitListener?.({
			payload: {
				session_id: 'session:1',
				commit: {
					commit: {
						transaction_id: 'transaction:live',
						heads: document.heads,
						patch: { created: [], changed: [], deleted: [] },
						affected_ids: [],
						affected_regions: [],
						inverse: { actor_id: 'actor:desktop', operations: [] },
						warnings: []
					},
					status
				}
			}
		});

		expect(onDocument).toHaveBeenCalledOnce();
		expect(Object.keys(onDocument.mock.calls[0][0].pages)).toEqual(document.document.page_ids);
	});

	it('clears a live proposal when its review window expires', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		try {
			const files = fileOps();
			const document = snapshot('board:proposal-expiry');
			tauri.invoke.mockImplementation(async (command: string) => {
				if (command !== 'create_document') throw new Error(`Unexpected command: ${command}`);
				return {
					session_id: 'session:1',
					status: {
						session_id: 'session:1',
						path: '/tmp/Untitled.inkfinite',
						actor_id: 'actor:desktop',
						snapshot: document,
						dirty: false,
						lock_held: true,
						recovery_available: false,
						can_undo: false,
						can_redo: false,
						sync: { status: 'disabled' }
					}
				} satisfies SessionOpened;
			});

			const repo = createDesktopSessionRepo(files.ops);
			await repo.createBoard('Untitled');
			const updates: Array<{ proposal: Proposal | null; message?: string }> = [];
			repo.subscribeProposal((update) => updates.push(update));
			const listenCalls = tauri.listen.mock.calls as unknown as Array<
				[string, (event: { payload: { session_id?: string; proposal: Proposal } }) => void]
			>;
			const proposalListener = listenCalls.find(([event]) => event === 'inkfinite-proposal')?.[1];
			expect(proposalListener).toBeTypeOf('function');

			const proposal: Proposal = {
				id: 'proposal:1',
				transaction: {
					id: 'transaction:1',
					actor_id: 'actor:desktop',
					origin: 'agent',
					base_heads: ['head:1'],
					description: 'Preview expiry',
					operations: [],
					timestamp: 1_000
				},
				preview: { created: [], changed: [], deleted: [] },
				operation_previews: [],
				affected_regions: [],
				warnings: [],
				expires_at: 2_000
			};
			proposalListener?.({ payload: { session_id: 'session:1', proposal } });
			expect(repo.getProposal()?.id).toBe('proposal:1');

			vi.advanceTimersByTime(1_000);

			expect(repo.getProposal()).toBeNull();
			expect(updates.at(-1)).toEqual({
				proposal: null,
				message: 'The proposal expired without changing the document.'
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
