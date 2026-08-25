import { EditorPageRecord, EditorShapeRecord } from '@inkfinite/core';
import type { BoardExport } from '@inkfinite/core/persistence';
import type { DesktopFileOps, FileHandle } from '../fileops';
import type { ChangeHash, DocumentSnapshot, Proposal, ShapeProperties, TransactionDraft } from '@inkfinite/bindings';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDesktopSessionRepo } from '$lib/persistence/desktop-session';
import type {
	SessionApi,
	SessionCommit,
	SessionOpened,
	SessionSaved,
	SessionStatus
} from '$lib/persistence/desktop-session';

type FakeSession = { status: SessionStatus; undo: DocumentSnapshot[]; redo: DocumentSnapshot[] };

function createSnapshot(documentId: string, pageName = 'Page 1', heads: ChangeHash[] = ['head:0']): DocumentSnapshot {
	const pageId = `page:${documentId}:1`;
	const layerId = `layer:${documentId}:1`;
	return {
		format: 'inkfinite',
		format_version: 2,
		document_id: documentId,
		heads,
		document: {
			pages: { [pageId]: { id: pageId, name: pageName, layer_ids: [layerId], version: 1 } },
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

function createFakeSessionApi() {
	const draftPath = '/app-data/drafts/untitled.inkfinite';
	const files = new Map<string, DocumentSnapshot>();
	const sessions = new Map<string, FakeSession>();
	const agentContexts: Array<Parameters<SessionApi['updateContext']>[0]> = [];
	const editorPatchBatches: Array<Parameters<SessionApi['reconcileEditorPatches']>[0]['patches']> = [];
	let sessionNumber = 0;
	let headNumber = 0;

	function statusFor(sessionId: string, session: FakeSession): SessionStatus {
		return { ...session.status, snapshot: structuredClone(session.status.snapshot) };
	}

	function commitResult(transaction: TransactionDraft, snapshot: DocumentSnapshot): SessionCommit['commit'] {
		return {
			transaction_id: transaction.id,
			heads: snapshot.heads,
			patch: { created: [], changed: [], deleted: [] },
			affected_ids: [],
			affected_regions: [],
			inverse: { actor_id: transaction.actor_id, operations: [] },
			warnings: []
		};
	}

	const api = {
		async createDocument(args: Parameters<SessionApi['createDocument']>[0]): Promise<SessionOpened> {
			const sessionId = `session:${++sessionNumber}`;
			const snapshot = createSnapshot(args.document_id, args.page_name || 'Page 1');
			const status: SessionStatus = {
				session_id: sessionId,
				path: args.path,
				actor_id: args.actor_id,
				snapshot,
				dirty: false,
				lock_held: true,
				recovery_available: false,
				can_undo: false,
				can_redo: false,
				sync: { status: 'disabled' }
			};
			sessions.set(sessionId, { status, undo: [], redo: [] });
			files.set(args.path, structuredClone(snapshot));
			return { session_id: sessionId, status: statusFor(sessionId, sessions.get(sessionId)!) };
		},

		async openDocument(args: Parameters<SessionApi['openDocument']>[0]): Promise<SessionOpened> {
			const stored = files.get(args.path);
			if (!stored) throw new Error(`Missing fake document: ${args.path}`);
			const sessionId = `session:${++sessionNumber}`;
			const status: SessionStatus = {
				session_id: sessionId,
				path: args.path,
				actor_id: args.actor_id,
				snapshot: structuredClone(stored),
				dirty: false,
				lock_held: true,
				recovery_available: false,
				can_undo: false,
				can_redo: false,
				sync: { status: 'disabled' }
			};
			sessions.set(sessionId, { status, undo: [], redo: [] });
			return { session_id: sessionId, status: statusFor(sessionId, sessions.get(sessionId)!) };
		},

		async openOrCreateDraft(args: Parameters<SessionApi['openOrCreateDraft']>[0]): Promise<SessionOpened> {
			if (!files.has(draftPath)) {
				return this.createDocument({
					path: draftPath,
					document_id: args.document_id,
					actor_id: args.actor_id,
					page_name: 'Page 1'
				});
			}
			return this.openDocument({ path: draftPath, actor_id: args.actor_id });
		},

		async snapshot(args: Parameters<SessionApi['snapshot']>[0]) {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			return statusFor(args.session_id, session);
		},

		async updateContext(args: Parameters<SessionApi['updateContext']>[0]): Promise<void> {
			agentContexts.push(structuredClone(args));
		},

		async commit(args: Parameters<SessionApi['commit']>[0]): Promise<SessionCommit> {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			const next = structuredClone(session.status.snapshot);
			for (const operation of args.transaction.operations) {
				if (operation.type === 'rename_page') {
					const page = next.document.pages[operation.page_id];
					if (page) {
						page.name = operation.name;
						page.version += 1;
					}
				} else if (operation.type === 'create_shape') {
					next.document.shapes[operation.shape.id] = structuredClone(operation.shape);
					if (operation.shape.parent.kind === 'layer') {
						next.document.layers[operation.shape.parent.id]?.shape_ids.push(operation.shape.id);
					} else {
						next.document.shapes[operation.shape.parent.id]?.child_ids.push(operation.shape.id);
					}
				} else if (operation.type === 'create_binding') {
					next.document.bindings[operation.binding.id] = structuredClone(operation.binding);
				}
			}
			session.undo.push(structuredClone(session.status.snapshot));
			session.redo = [];
			next.heads = [`head:${++headNumber}`];
			session.status = { ...session.status, snapshot: next, dirty: true, can_undo: true, can_redo: false };
			return { commit: commitResult(args.transaction, next), status: statusFor(args.session_id, session) };
		},

		async reconcileEditorPatches(
			args: Parameters<SessionApi['reconcileEditorPatches']>[0]
		): Promise<SessionCommit> {
			editorPatchBatches.push(structuredClone(args.patches));
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			const next = structuredClone(session.status.snapshot);
			for (const patch of args.patches) {
				if (patch.type === 'rename_page') {
					const page = next.document.pages[patch.page_id];
					if (page) page.name = patch.name;
				} else if (patch.type === 'create_shape') {
					const properties = structuredClone(patch.shape.properties) as Record<string, unknown>;
					if ('w' in properties) {
						properties.width = properties.w;
						delete properties.w;
					}
					if ('h' in properties) {
						properties.height = properties.h;
						delete properties.h;
					}
					const scaleX = Math.hypot(patch.transform.a, patch.transform.b);
					const scaleY =
						scaleX > Number.EPSILON
							? (patch.transform.a * patch.transform.d - patch.transform.b * patch.transform.c) / scaleX
							: 1;
					next.document.shapes[patch.shape.id] = {
						id: patch.shape.id,
						kind: patch.shape.kind,
						parent: patch.parent,
						transform: {
							translation: { x: patch.transform.e, y: patch.transform.f },
							rotation: Math.atan2(patch.transform.b, patch.transform.a),
							scale_x: scaleX,
							scale_y: scaleY
						},
						child_ids: [],
						layout: patch.shape.layout,
						properties: properties as ShapeProperties,
						metadata: patch.shape.metadata ?? {
							name: null,
							title: null,
							role: null,
							description: null,
							body: null,
							tags: [],
							source: null,
							link: null,
							custom_metadata: {},
							locked: false,
							agent_editable: true,
							provenance: { actor_id: 'actor:desktop', origin: 'human', timestamp: 0, source: null }
						},
						style: patch.shape.style,
						version: 1
					};
					if (patch.parent.kind === 'layer') {
						next.document.layers[patch.parent.id]?.shape_ids.push(patch.shape.id);
					} else {
						next.document.shapes[patch.parent.id]?.child_ids.push(patch.shape.id);
					}
				} else if (patch.type === 'create_binding') {
					next.document.bindings[patch.binding.id] = structuredClone(patch.binding);
				}
			}
			next.heads = [`head:${++headNumber}`];
			session.undo.push(structuredClone(session.status.snapshot));
			session.redo = [];
			session.status = { ...session.status, snapshot: next, dirty: true, can_undo: true, can_redo: false };
			return {
				commit: commitResult(
					{
						id: 'transaction:editor',
						actor_id: 'actor:desktop',
						origin: 'human',
						base_heads: session.status.snapshot.heads,
						description: 'Editor patches',
						operations: [],
						timestamp: Date.now()
					},
					next
				),
				status: statusFor(args.session_id, session)
			};
		},

		async importSvg(_args: Parameters<SessionApi['importSvg']>[0]) {
			throw new Error('SVG import is not part of this fake session');
		},

		async propose(_args: Parameters<SessionApi['propose']>[0]): Promise<Proposal> {
			throw new Error('Proposals are not part of this fake session');
		},

		async acceptProposal(_args: Parameters<SessionApi['acceptProposal']>[0]): Promise<SessionCommit> {
			throw new Error('Proposals are not part of this fake session');
		},

		async rejectProposal(_args: Parameters<SessionApi['rejectProposal']>[0]): Promise<void> {
			throw new Error('Proposals are not part of this fake session');
		},

		async undo(args: Parameters<SessionApi['undo']>[0]): Promise<SessionCommit> {
			const session = sessions.get(args.session_id);
			const previous = session?.undo.pop();
			if (!session || !previous) throw new Error('No fake undo history');
			session.redo.push(structuredClone(session.status.snapshot));
			previous.heads = [`head:${++headNumber}`];
			session.status = {
				...session.status,
				snapshot: previous,
				dirty: true,
				can_undo: session.undo.length > 0,
				can_redo: true
			};
			return {
				commit: commitResult({ id: 'transaction:undo', actor_id: args.actor_id } as TransactionDraft, previous),
				status: statusFor(args.session_id, session)
			};
		},

		async redo(args: Parameters<SessionApi['redo']>[0]): Promise<SessionCommit> {
			const session = sessions.get(args.session_id);
			const next = session?.redo.pop();
			if (!session || !next) throw new Error('No fake redo history');
			session.undo.push(structuredClone(session.status.snapshot));
			next.heads = [`head:${++headNumber}`];
			session.status = {
				...session.status,
				snapshot: next,
				dirty: true,
				can_undo: true,
				can_redo: session.redo.length > 0
			};
			return {
				commit: commitResult({ id: 'transaction:redo', actor_id: args.actor_id } as TransactionDraft, next),
				status: statusFor(args.session_id, session)
			};
		},

		async save(args: Parameters<SessionApi['save']>[0]): Promise<SessionSaved> {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			files.set(session.status.path, structuredClone(session.status.snapshot));
			session.status = { ...session.status, dirty: false };
			return {
				save: { path: session.status.path, heads: session.status.snapshot.heads },
				status: statusFor(args.session_id, session)
			};
		},

		async saveAs(args: Parameters<SessionApi['saveAs']>[0]): Promise<SessionSaved> {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			if (session.status.path === args.path) throw new Error('Save As requires a different path');
			files.set(args.path, structuredClone(session.status.snapshot));
			session.status = { ...session.status, path: args.path, dirty: false };
			return {
				save: { path: args.path, heads: session.status.snapshot.heads },
				status: statusFor(args.session_id, session)
			};
		},

		async duplicateDocument(args: Parameters<SessionApi['duplicateDocument']>[0]): Promise<SessionOpened> {
			const source = sessions.get(args.session_id);
			if (!source) throw new Error('Missing fake session');
			const snapshot = structuredClone(source.status.snapshot);
			snapshot.document_id = args.document_id;
			const sessionId = `session:${++sessionNumber}`;
			const status: SessionStatus = {
				...source.status,
				session_id: sessionId,
				path: args.path,
				actor_id: args.actor_id,
				snapshot,
				dirty: false
			};
			sessions.delete(args.session_id);
			sessions.set(sessionId, { status, undo: [], redo: [] });
			files.set(args.path, structuredClone(snapshot));
			return { session_id: sessionId, status: statusFor(sessionId, sessions.get(sessionId)!) };
		},

		async saveDraftAs(args: Parameters<SessionApi['saveDraftAs']>[0]): Promise<SessionSaved> {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			files.set(args.path, structuredClone(session.status.snapshot));
			session.status = { ...session.status, path: args.path, dirty: false };
			files.delete(draftPath);
			return {
				save: { path: args.path, heads: session.status.snapshot.heads },
				status: statusFor(args.session_id, session)
			};
		},

		async query(args: Parameters<SessionApi['query']>[0]) {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			return {
				heads: session.status.snapshot.heads,
				records: [],
				bounds: {},
				details: [],
				total: 0,
				truncated: false
			};
		},

		async validate(args: Parameters<SessionApi['validate']>[0]) {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			return statusFor(args.session_id, session);
		},

		async syncConnect(args: Parameters<SessionApi['syncConnect']>[0]) {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			session.status = {
				...session.status,
				sync: {
					status: 'enabled',
					peers: [{ peer_id: args.peer_id, pending_messages: 0, shared_heads: [], quarantine: null }],
					warning: null
				}
			};
			return statusFor(args.session_id, session);
		},

		async syncDisconnect(args: Parameters<SessionApi['syncDisconnect']>[0]) {
			const session = sessions.get(args.session_id);
			if (!session) throw new Error('Missing fake session');
			session.status = { ...session.status, sync: { status: 'disabled' } };
			return statusFor(args.session_id, session);
		},

		async syncNext(_args: Parameters<SessionApi['syncNext']>[0]) {
			return null;
		},

		async syncReceive(_args: Parameters<SessionApi['syncReceive']>[0]): Promise<never> {
			throw new Error('Sync receive is not part of this fake session');
		},

		async close(args: Parameters<SessionApi['close']>[0]) {
			sessions.delete(args.session_id);
		}
	} satisfies SessionApi;

	return { api, files, draftPath, agentContexts, editorPatchBatches };
}

function createFakeFileOps() {
	const recent: FileHandle[] = [];
	let workspace: string | null = null;
	let openPath: string | null = null;
	let savePath: string | null = null;
	let saveDialogCount = 0;
	let entries: Array<{ path: string; name: string; isDir: boolean; modifiedAt?: number }> = [];

	const ops: DesktopFileOps = {
		async showOpenDialog() {
			return openPath;
		},
		async showSaveDialog() {
			saveDialogCount += 1;
			return savePath;
		},
		async showSvgDialog() {
			return null;
		},
		async getRecentFiles() {
			return [...recent];
		},
		async addRecentFile(handle) {
			recent.splice(0, recent.length, handle, ...recent.filter((item) => item.path !== handle.path));
		},
		async removeRecentFile(path) {
			const index = recent.findIndex((item) => item.path === path);
			if (index >= 0) recent.splice(index, 1);
		},
		async clearRecentFiles() {
			recent.splice(0, recent.length);
		},
		async getWorkspaceDir() {
			return workspace;
		},
		async setWorkspaceDir(path) {
			workspace = path;
		},
		async pickWorkspaceDir() {
			workspace = '/workspace';
			return workspace;
		},
		async readDirectory(directory, pattern) {
			const suffix = pattern?.replace('*', '') ?? '';
			return entries.filter(
				(entry) => entry.path.startsWith(directory) && (!suffix || entry.name.includes(suffix))
			);
		},
		async renameFile() {},
		async deleteFile(path) {
			entries = entries.filter((entry) => entry.path !== path);
		}
	};

	return {
		ops,
		recent,
		setWorkspace(path: string | null) {
			workspace = path;
		},
		setOpenPath(path: string | null) {
			openPath = path;
		},
		setSavePath(path: string | null) {
			savePath = path;
		},
		getSaveDialogCount() {
			return saveDialogCount;
		},
		setEntries(next: typeof entries) {
			entries = next;
		}
	};
}

describe('Rust-backed desktop session repository', () => {
	let fileOps: ReturnType<typeof createFakeFileOps>;
	let session: ReturnType<typeof createFakeSessionApi>;

	beforeEach(() => {
		fileOps = createFakeFileOps();
		session = createFakeSessionApi();
	});

	it('opens, edits, saves, reopens, undoes, and redoes through typed sessions', async () => {
		fileOps.setSavePath('/tmp/board.inkfinite');
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const boardId = await repo.createBoard('Board One');
		const pageId = Object.keys((await repo.loadDoc(boardId)).pages)[0];
		expect((await repo.validate()).snapshot.document_id).toBe(boardId);
		expect(
			(
				await repo.query({
					id: null,
					name: null,
					role: null,
					tag: null,
					relation_type: null,
					incoming_to: null,
					outgoing_from: null,
					shape_kind: null,
					page_id: null,
					layer_id: null,
					parent_id: null,
					bounds: null,
					include_records: false,
					limit: null
				})
			).records
		).toEqual([]);

		await repo.applyDocPatch(boardId, { upserts: { pages: [{ id: pageId, name: 'Renamed', shapeIds: [] }] } });
		expect((await repo.loadDoc(boardId)).pages[pageId].name).toBe('Renamed');
		expect(repo.getSessionStatus()?.dirty).toBe(false);

		await repo.undo();
		expect((await repo.loadDoc(boardId)).pages[pageId].name).toBe('Page 1');
		await repo.redo();
		expect((await repo.loadDoc(boardId)).pages[pageId].name).toBe('Renamed');

		await repo.closeSession();
		const boards = await repo.listBoards();
		await repo.openBoard(boards[0].id);
		expect((await repo.loadDoc(boards[0].id)).pages[pageId].name).toBe('Renamed');
		await repo.closeSession();
		const reopened = await repo.loadDoc(boards[0].id);
		expect(reopened.pages[pageId].name).toBe('Renamed');
	});

	it('duplicates the active board through the Rust session service', async () => {
		fileOps.setSavePath('/tmp/source.inkfinite');
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const sourceId = await repo.createBoard('Source');
		fileOps.setSavePath('/tmp/source-copy.inkfinite');

		const duplicateId = await repo.duplicateBoard(sourceId);

		expect(duplicateId).not.toBe(sourceId);
		expect(repo.getCurrentFile()?.path).toBe('/tmp/source-copy.inkfinite');
		expect(repo.getSessionStatus()?.snapshot.document_id).toBe(duplicateId);
	});

	it('routes layer changes through the Rust reconciliation command', async () => {
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const opened = await repo.openDraft();
		const pageId = opened.doc.order.pageIds[0];
		const existingLayerId = opened.doc.pages[pageId].layerIds?.[0];
		expect(existingLayerId).toBeDefined();
		const newLayer = {
			id: 'layer:desktop:new',
			pageId,
			name: 'New layer',
			shapeIds: [],
			visible: true,
			locked: false,
			opacity: 1
		};

		await repo.applyDocPatch(opened.boardId, {
			upserts: {
				pages: [{ ...opened.doc.pages[pageId], layerIds: [existingLayerId!, newLayer.id], shapeIds: [] }]
			},
			order: { layers: { [existingLayerId!]: opened.doc.layers![existingLayerId!]!, [newLayer.id]: newLayer } }
		});

		expect(session.editorPatchBatches.at(-1)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: 'create_layer', layer: expect.objectContaining({ id: newLayer.id }) })
			])
		);
	});

	it('publishes editor context only after a desktop session is open', async () => {
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		await repo.updateAgentContext({
			pageId: 'page:none',
			activeLayerId: null,
			selectionIds: [],
			viewport: null,
			camera: null,
			occludedRegions: []
		});
		expect(session.agentContexts).toEqual([]);

		const opened = await repo.openDraft();
		const pageId = opened.doc.order.pageIds[0];
		await repo.updateAgentContext({
			pageId,
			activeLayerId: 'layer:active',
			selectionIds: [],
			viewport: { x: -100, y: -50, width: 200, height: 100 },
			camera: { x: 0, y: 0, zoom: 2 },
			occludedRegions: [{ x: -100, y: -50, width: 20, height: 100 }]
		});

		expect(session.agentContexts.at(-1)).toMatchObject({
			page_id: pageId,
			active_layer_id: 'layer:active',
			viewport: { width: 200, height: 100 },
			camera: { zoom: 2 },
			occluded_regions: [{ width: 20 }]
		});
	});

	it('lists native document paths without reading document bytes in the frontend', async () => {
		fileOps.setWorkspace('/workspace');
		fileOps.setEntries([
			{ path: '/workspace/alpha.inkfinite', name: 'alpha.inkfinite', isDir: false, modifiedAt: 1234 },
			{ path: '/workspace/assets', name: 'assets', isDir: true }
		]);
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });

		const boards = await repo.listBoards();

		expect(boards.map((board) => board.name)).toEqual(['alpha']);
		expect(boards.every((board) => board.id.startsWith('path:'))).toBe(true);
		expect(boards[0]).toMatchObject({ updatedAt: 1234, storage: { kind: 'workspace', location: '/workspace' } });
	});

	it('persists the app-managed draft across renderer sessions without adding it to recent files', async () => {
		const firstRepo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const opened = await firstRepo.openDraft();
		const pageId = Object.keys(opened.doc.pages)[0];

		await firstRepo.applyDocPatch(opened.boardId, {
			upserts: { pages: [{ id: pageId, name: 'Recovered after reload', shapeIds: [] }] }
		});
		await firstRepo.closeSession();

		const reloadedRepo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const reloaded = await reloadedRepo.openDraft();

		expect(reloaded.doc.pages[pageId].name).toBe('Recovered after reload');
		expect(reloadedRepo.isDraft()).toBe(true);
		expect(reloadedRepo.getCurrentFile()).toBeNull();
		expect(await reloadedRepo.listBoards()).toEqual([]);
		expect(fileOps.recent).toEqual([]);
	});

	it('promotes a draft with Save As and removes the app-data source', async () => {
		fileOps.setSavePath('/tmp/promoted.inkfinite');
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const opened = await repo.openDraft();
		const saved = await repo.saveAs();

		expect(repo.isDraft()).toBe(false);
		expect(saved.boardId).toBe(opened.boardId);
		expect(saved.doc).toEqual(opened.doc);
		expect(repo.getCurrentFile()?.path).toBe('/tmp/promoted.inkfinite');
		expect(session.files.has(session.draftPath)).toBe(false);
		expect(fileOps.recent.map((file) => file.path)).toEqual(['/tmp/promoted.inkfinite']);
	});

	it('saves normally when Save As selects the current document path', async () => {
		fileOps.setSavePath('/tmp/Untitled.inkfinite');
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const boardId = await repo.createBoard('Untitled');

		const saved = await repo.saveAs(async () => {
			expect(fileOps.getSaveDialogCount()).toBe(2);
		});

		expect(saved.boardId).toBe(boardId);
		expect(repo.getCurrentFile()?.path).toBe('/tmp/Untitled.inkfinite');
		expect(repo.getSessionStatus()?.dirty).toBe(false);
	});

	it('flushes pending editor writes before replacing the open session', async () => {
		fileOps.setOpenPath('/tmp/Funtitled.inkfinite');
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const draft = await repo.openDraft();
		const pendingFailure = new Error('Pending write failed');

		await expect(
			repo.openFromDialog(async () => {
				throw pendingFailure;
			})
		).rejects.toBe(pendingFailure);

		expect(repo.getSessionStatus()?.snapshot.document_id).toBe(draft.boardId);
		expect(repo.isDraft()).toBe(true);
	});

	it('returns the committed document after accepting a proposal', async () => {
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });
		const opened = await repo.openDraft();
		const pageId = Object.keys(opened.doc.pages)[0];
		session.api.acceptProposal = ({ session_id }) =>
			session.api.commit({
				session_id,
				transaction: {
					id: 'transaction:accepted-proposal',
					actor_id: 'actor:desktop',
					origin: 'agent',
					base_heads: repo.getSessionStatus()?.snapshot.heads ?? [],
					description: 'Accepted proposal fixture',
					operations: [
						{ type: 'rename_page', page_id: pageId, name: 'Accepted proposal', expected_version: 1 }
					],
					timestamp: Date.now()
				}
			});

		const committed = await repo.acceptProposal('proposal:accepted');

		expect(committed.pages[pageId].name).toBe('Accepted proposal');
		expect((await repo.loadDoc(opened.boardId)).pages[pageId].name).toBe('Accepted proposal');
	});

	it('imports editable canvas content into the Rust-backed canonical document', async () => {
		fileOps.setSavePath('/tmp/imported.inkfinite');
		const page = EditorPageRecord.create('Imported canvas', 'page:imported');
		const shape = EditorShapeRecord.createRect(
			page.id,
			12,
			24,
			{ w: 160, h: 90, fill: '#ffffff', stroke: '#111827', radius: 8 },
			'shape:imported'
		);
		const snapshot: BoardExport = {
			board: { id: 'board:source', name: 'Imported board', createdAt: 1, updatedAt: 1 },
			doc: {
				pages: { [page.id]: { ...page, shapeIds: [shape.id] } },
				shapes: { [shape.id]: shape },
				bindings: {}
			},
			order: { pageIds: [page.id], shapeOrder: { [page.id]: [shape.id] } }
		};
		const repo = createDesktopSessionRepo(fileOps.ops, { api: session.api });

		const boardId = await repo.importBoard(snapshot);
		const imported = await repo.loadDoc(boardId);
		const importedPageId = imported.order.pageIds[0];

		expect(imported.pages[importedPageId].name).toBe('Imported canvas');
		expect(imported.shapes[shape.id]).toMatchObject({
			id: shape.id,
			pageId: importedPageId,
			x: 12,
			y: 24,
			type: 'rect'
		});
		expect(session.files.get('/tmp/imported.inkfinite')?.document.shapes[shape.id]).toBeDefined();
	});
});
