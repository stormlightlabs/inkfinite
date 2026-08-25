import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
	createEditorReconciliationRequest,
	createId,
	fromCanonicalDocumentSnapshot,
	fromEditorProjection
} from '@inkfinite/core';
import type {
	BoardExport,
	BoardMeta,
	DesktopFileOps,
	DocPatch,
	FileHandle,
	LoadedDoc,
	EditorLayerRecord,
	EditorPageRecord,
	PersistenceSink,
	PersistenceStatus,
	PersistentDocRepo
} from '@inkfinite/core';
import type {
	ChangeHash,
	CommitResult,
	DocumentSnapshot,
	Query,
	QueryResult,
	Proposal,
	TransactionDraft
} from '@inkfinite/bindings';
import type { EditorPatch, EditorProjection } from '@inkfinite/bindings/editor';

const ACTOR_ID = 'actor:desktop';

/** Serialized status returned by every desktop session command. */
export type SessionStatus = {
	session_id: string;
	path: string;
	actor_id: string;
	snapshot: DocumentSnapshot;
	/** Rust-owned projection used to materialize the editor mirror. */
	editor_projection?: EditorProjection;
	dirty: boolean;
	lock_held: boolean;
	recovery_available: boolean;
	can_undo: boolean;
	can_redo: boolean;
	sync: SyncState;
};

/** Trusted peer checkpoint projected across the desktop command boundary. */
export type SyncPeerStatus = {
	peer_id: string;
	pending_messages: number;
	shared_heads: ChangeHash[];
	quarantine: SyncQuarantine | null;
};

/** Diagnostic retained when a peer payload is rejected without replacing the document. */
export type SyncQuarantine = { sequence: number; reason: string };

/** Session-level synchronization state. */
export type SyncState = { status: 'disabled' } | { status: 'enabled'; peers: SyncPeerStatus[]; warning: string | null };

/** Transport-neutral Automerge envelope exchanged by trusted peers. */
export type SyncMessage = {
	protocol_id: string;
	version: number;
	document_id: string;
	sender: string;
	recipient: string;
	sequence: number;
	payload: number[];
};

/** Classification returned after one peer envelope is processed. */
export type SyncDisposition = 'applied' | 'duplicate' | 'deferred' | 'quarantined';

/** Document patch and validation result returned by a peer merge. */
export type SyncApplyResult = { disposition: SyncDisposition; adopted_messages: number; heads: ChangeHash[] } & Pick<
	CommitResult,
	'patch' | 'affected_ids' | 'affected_regions' | 'warnings'
>;

/** Result returned after creating or opening a desktop session. */
export type SessionOpened = { session_id: string; status: SessionStatus };

/** Result returned after committing, undoing, or redoing a transaction. */
export type SessionCommit = { commit: CommitResult; status: SessionStatus };

/** Result returned after importing an SVG through the Rust session service. */
export type SvgImportResult = { doc: LoadedDoc; warnings: string[]; omitted_image_count: number; shape_ids: string[] };

/** Result returned after persisting a session. */
export type SessionSaved = { save: { path: string; heads: ChangeHash[] }; status: SessionStatus };

/** Result returned after adopting, deferring, or quarantining a peer message. */
export type SessionSync = { sync: SyncApplyResult; status: SessionStatus };

/** State update emitted when a live proposal is created, refreshed, or cleared. */
export type ProposalUpdate = { proposal: Proposal | null; message?: string };

/** Typed editor navigation emitted by the authenticated live CLI. */
export type AgentUiControl = {
	page_id?: string | null;
	active_layer_id?: string | null;
	selection_ids?: string[] | null;
	camera?: { x: number; y: number; zoom: number } | null;
};

/** Typed command boundary used by the desktop adapter and its tests. */
export interface SessionApi {
	createDocument(args: {
		path: string;
		document_id: string;
		actor_id: string;
		page_name?: string;
	}): Promise<SessionOpened>;
	openDocument(args: { path: string; actor_id: string }): Promise<SessionOpened>;
	openOrCreateDraft(args: { document_id: string; actor_id: string }): Promise<SessionOpened>;
	snapshot(args: { session_id: string }): Promise<SessionStatus>;
	updateContext(args: {
		session_id: string;
		page_id: string | null;
		active_layer_id: string | null;
		selection_ids: string[];
		viewport: { x: number; y: number; width: number; height: number } | null;
		camera: { x: number; y: number; zoom: number } | null;
		occluded_regions: Array<{ x: number; y: number; width: number; height: number }>;
	}): Promise<void>;
	commit(args: { session_id: string; transaction: TransactionDraft }): Promise<SessionCommit>;
	reconcileEditorPatches(args: { session_id: string; patches: EditorPatch[] }): Promise<SessionCommit>;
	importSvg(args: {
		session_id: string;
		path: string;
	}): Promise<{
		session: SessionCommit;
		warnings: string[];
		omitted_image_count: number;
		shape_ids: string[];
		source_asset_id: string;
	}>;
	propose(args: { session_id: string; transaction: TransactionDraft }): Promise<Proposal>;
	acceptProposal(args: {
		session_id: string;
		proposal_id: string;
		operation_positions?: number[];
	}): Promise<SessionCommit>;
	rejectProposal(args: { session_id: string; proposal_id: string }): Promise<void>;
	undo(args: { session_id: string; actor_id: string }): Promise<SessionCommit>;
	redo(args: { session_id: string; actor_id: string }): Promise<SessionCommit>;
	save(args: { session_id: string; expected_heads: ChangeHash[] }): Promise<SessionSaved>;
	saveAs(args: { session_id: string; path: string; expected_heads: ChangeHash[] }): Promise<SessionSaved>;
	duplicateDocument(args: {
		session_id: string;
		path: string;
		document_id: string;
		actor_id: string;
		expected_heads: ChangeHash[];
	}): Promise<SessionOpened>;
	saveDraftAs(args: { session_id: string; path: string; expected_heads: ChangeHash[] }): Promise<SessionSaved>;
	query(args: { session_id: string; query: Query }): Promise<QueryResult>;
	validate(args: { session_id: string }): Promise<SessionStatus>;
	syncConnect(args: { session_id: string; peer_id: string }): Promise<SessionStatus>;
	syncDisconnect(args: { session_id: string; peer_id: string }): Promise<SessionStatus>;
	syncNext(args: { session_id: string; peer_id: string }): Promise<SyncMessage | null>;
	syncReceive(args: { session_id: string; message: SyncMessage }): Promise<SessionSync>;
	close(args: { session_id: string }): Promise<void>;
}

function createSessionApi(): SessionApi {
	return {
		createDocument: (args) =>
			invokeSession<SessionOpened>('create_document', {
				path: args.path,
				documentId: args.document_id,
				actorId: args.actor_id,
				pageName: args.page_name
			}),
		openDocument: (args) =>
			invokeSession<SessionOpened>('open_document', { path: args.path, actorId: args.actor_id }),
		openOrCreateDraft: (args) =>
			invokeSession<SessionOpened>('open_or_create_draft', {
				documentId: args.document_id,
				actorId: args.actor_id
			}),
		snapshot: (args) => invokeSession<SessionStatus>('snapshot', { sessionId: args.session_id }),
		updateContext: (args) =>
			invokeSession<void>('update_context', {
				sessionId: args.session_id,
				context: {
					page_id: args.page_id,
					active_layer_id: args.active_layer_id,
					selection_ids: args.selection_ids,
					viewport: args.viewport,
					camera: args.camera,
					occluded_regions: args.occluded_regions
				}
			}),
		commit: (args) =>
			invokeSession<SessionCommit>('commit', { sessionId: args.session_id, transaction: args.transaction }),
		reconcileEditorPatches: (args) =>
			invokeSession<SessionCommit>('reconcile_editor_patches', {
				sessionId: args.session_id,
				patches: args.patches
			}),
		importSvg: (args) =>
			invokeSession<Awaited<ReturnType<SessionApi['importSvg']>>>('import_svg', {
				sessionId: args.session_id,
				path: args.path
			}),
		propose: (args) =>
			invokeSession<Proposal>('propose', { sessionId: args.session_id, transaction: args.transaction }),
		acceptProposal: (args) =>
			invokeSession<SessionCommit>('accept_proposal', {
				sessionId: args.session_id,
				proposalId: args.proposal_id,
				operationPositions: args.operation_positions
			}),
		rejectProposal: (args) =>
			invokeSession<void>('reject_proposal', { sessionId: args.session_id, proposalId: args.proposal_id }),
		undo: (args) => invokeSession<SessionCommit>('undo', { sessionId: args.session_id, actorId: args.actor_id }),
		redo: (args) => invokeSession<SessionCommit>('redo', { sessionId: args.session_id, actorId: args.actor_id }),
		save: (args) =>
			invokeSession<SessionSaved>('save', { sessionId: args.session_id, expectedHeads: args.expected_heads }),
		saveAs: (args) =>
			invokeSession<SessionSaved>('save_as', {
				sessionId: args.session_id,
				path: args.path,
				expectedHeads: args.expected_heads
			}),
		duplicateDocument: (args) =>
			invokeSession<SessionOpened>('duplicate_document', {
				sessionId: args.session_id,
				path: args.path,
				documentId: args.document_id,
				actorId: args.actor_id,
				expectedHeads: args.expected_heads
			}),
		saveDraftAs: (args) =>
			invokeSession<SessionSaved>('save_draft_as', {
				sessionId: args.session_id,
				path: args.path,
				expectedHeads: args.expected_heads
			}),
		query: (args) => invokeSession<QueryResult>('query', { sessionId: args.session_id, query: args.query }),
		validate: (args) => invokeSession<SessionStatus>('validate', { sessionId: args.session_id }),
		syncConnect: (args) =>
			invokeSession<SessionStatus>('sync_connect', { sessionId: args.session_id, peerId: args.peer_id }),
		syncDisconnect: (args) =>
			invokeSession<SessionStatus>('sync_disconnect', { sessionId: args.session_id, peerId: args.peer_id }),
		syncNext: (args) =>
			invokeSession<SyncMessage | null>('sync_next', { sessionId: args.session_id, peerId: args.peer_id }),
		syncReceive: (args) =>
			invokeSession<SessionSync>('sync_receive', { sessionId: args.session_id, message: args.message }),
		close: (args) => invokeSession<void>('close', { sessionId: args.session_id })
	};
}

/** Converts errors crossing the Tauri boundary into readable renderer text. */
function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (typeof error === 'object' && error !== null) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string' && message.trim()) return message;
		try {
			return JSON.stringify(error);
		} catch {
			return 'Unknown structured error';
		}
	}
	return String(error);
}

async function invokeSession<T>(command: string, args: Record<string, unknown>): Promise<T> {
	return invoke<T>(command, args).catch((error: unknown) => {
		const detail = describeError(error);
		const message = `${command} failed: ${detail}`;
		void invoke('record_renderer_error', { message }).catch(() => undefined);
		throw new Error(detail, { cause: error });
	});
}

/** Persistent document repository backed by one backend/tauri-owned session. */
export type DesktopSessionRepo = PersistentDocRepo & {
	kind: 'desktop';
	openDraft(): Promise<{ boardId: string; doc: LoadedDoc }>;
	isDraft(): boolean;
	getCurrentFile(): FileHandle | null;
	openPath(path: string): Promise<{ boardId: string; doc: LoadedDoc }>;
	importSvg(): Promise<SvgImportResult | null>;
	importSvgPath(path: string): Promise<SvgImportResult | null>;
	openFromDialog(prepareToOpen?: () => Promise<void>): Promise<{ boardId: string; doc: LoadedDoc }>;
	saveAs(prepareToSave?: () => Promise<void>): Promise<{ boardId: string; doc: LoadedDoc }>;
	getWorkspaceDir(): Promise<string | null>;
	setWorkspaceDir(path: string | null): Promise<void>;
	pickWorkspaceDir(): Promise<string | null>;
	undo(): Promise<void>;
	redo(): Promise<void>;
	query(query: Query): Promise<QueryResult>;
	validate(): Promise<SessionStatus>;
	getSessionStatus(): SessionStatus | null;
	getProposal(): Proposal | null;
	subscribeProposal(listener: (update: ProposalUpdate) => void): () => void;
	subscribeLiveDocument(listener: (doc: LoadedDoc) => void): () => void;
	subscribeAgentUi(listener: (control: AgentUiControl) => void): () => void;
	acceptProposal(proposalId: string, operationPositions?: number[]): Promise<LoadedDoc>;
	rejectProposal(proposalId: string): Promise<void>;
	/** Publishes editor-only context for read-only agent queries. */
	updateAgentContext(context: {
		pageId: string | null;
		activeLayerId: string | null;
		selectionIds: string[];
		viewport: { x: number; y: number; width: number; height: number } | null;
		camera: { x: number; y: number; zoom: number } | null;
		occludedRegions: Array<{ x: number; y: number; width: number; height: number }>;
	}): Promise<void>;
	syncConnect(peerId: string): Promise<SessionStatus>;
	syncDisconnect(peerId: string): Promise<SessionStatus>;
	syncNext(peerId: string): Promise<SyncMessage | null>;
	syncReceive(message: SyncMessage): Promise<SessionSync>;
	closeSession(): Promise<void>;
};

/**
 * Creates the desktop repository adapter. Document bytes cross the Tauri command boundary only.
 *
 * This adapter keeps the editor projection in memory until the backend returns a committed snapshot.
 */
export function createDesktopSessionRepo(fileOps: DesktopFileOps, opts: { api?: SessionApi } = {}): DesktopSessionRepo {
	const api = opts.api ?? createSessionApi();
	let currentFile: FileHandle | null = null;
	let currentBoard: BoardMeta | null = null;
	let currentDoc: LoadedDoc | null = null;
	let currentStatus: SessionStatus | null = null;
	let currentIsDraft = false;
	let currentProposal: Proposal | null = null;
	let proposalExpiryTimer: ReturnType<typeof setTimeout> | null = null;
	const proposalListeners = new Set<(update: ProposalUpdate) => void>();
	const liveDocumentListeners = new Set<(doc: LoadedDoc) => void>();
	const agentUiListeners = new Set<(control: AgentUiControl) => void>();
	const liveUnlisteners: Array<() => void> = [];
	const boardFiles = new Map<string, FileHandle>();

	type ProposalEvent = { session_id?: string | null; proposal: Proposal };
	type ProposalClearedEvent = { message?: string };
	type LiveCommitEvent = { session_id?: string | null; commit: SessionCommit };
	type LiveSyncEvent = { session_id?: string | null; sync: SessionSync };
	type AgentUiEvent = { session_id?: string | null; control: AgentUiControl };

	function notifyProposal(update: ProposalUpdate) {
		if (proposalExpiryTimer) clearTimeout(proposalExpiryTimer);
		proposalExpiryTimer = null;
		currentProposal = update.proposal;
		for (const listener of proposalListeners) listener(update);
		if (update.proposal) {
			const delay = update.proposal.expires_at - Date.now();
			if (delay <= 0) {
				notifyProposal({ proposal: null, message: 'The proposal expired without changing the document.' });
			} else {
				proposalExpiryTimer = setTimeout(() => {
					notifyProposal({ proposal: null, message: 'The proposal expired without changing the document.' });
				}, delay);
			}
		}
	}

	function clearExpiredProposal(proposalId: string): boolean {
		if (currentProposal?.id !== proposalId || Date.now() < currentProposal.expires_at) return false;
		notifyProposal({ proposal: null, message: 'The proposal expired without changing the document.' });
		return true;
	}

	function notifyLiveDocument() {
		if (!currentDoc) return;
		for (const listener of liveDocumentListeners) listener(currentDoc);
	}

	function eventBelongsToCurrentSession(sessionId?: string | null): boolean {
		return Boolean(currentStatus && (!sessionId || sessionId === currentStatus.session_id));
	}

	function startLiveListeners() {
		void listen<ProposalEvent>('inkfinite-proposal', (event) => {
			if (eventBelongsToCurrentSession(event.payload.session_id)) {
				notifyProposal({ proposal: event.payload.proposal });
			}
		})
			.then((stop) => liveUnlisteners.push(stop))
			.catch(() => undefined);
		void listen<ProposalClearedEvent>('inkfinite-proposal-cleared', (event) => {
			if (currentStatus) notifyProposal({ proposal: null, message: event.payload.message });
		})
			.then((stop) => liveUnlisteners.push(stop))
			.catch(() => undefined);
		void listen<LiveCommitEvent>('inkfinite-live-commit', (event) => {
			if (!eventBelongsToCurrentSession(event.payload.session_id)) return;
			const hadProposal = currentProposal !== null;
			updateStatus(event.payload.commit.status);
			notifyLiveDocument();
			notifyProposal(
				hadProposal
					? { proposal: null, message: 'The document changed while this proposal was open. Review it again.' }
					: { proposal: null }
			);
		})
			.then((stop) => liveUnlisteners.push(stop))
			.catch(() => undefined);
		void listen<LiveSyncEvent>('inkfinite-sync', (event) => {
			if (!eventBelongsToCurrentSession(event.payload.session_id)) return;
			updateStatus(event.payload.sync.status);
			notifyLiveDocument();
		})
			.then((stop) => liveUnlisteners.push(stop))
			.catch(() => undefined);
		void listen<AgentUiEvent>('inkfinite-ui-control', (event) => {
			if (!eventBelongsToCurrentSession(event.payload.session_id)) return;
			for (const listener of agentUiListeners) listener(event.payload.control);
		})
			.then((stop) => liveUnlisteners.push(stop))
			.catch(() => undefined);
	}

	startLiveListeners();

	function setCurrentState(status: SessionStatus, boardName?: string, isDraft = false, modifiedAt?: number) {
		currentStatus = status;
		currentIsDraft = isDraft;
		currentFile = {
			path: status.path,
			name: fileName(status.path),
			...(modifiedAt !== undefined ? { modifiedAt } : {})
		};
		currentBoard = {
			id: status.snapshot.document_id,
			name: boardName || fileStem(status.path),
			createdAt: currentBoard?.createdAt ?? Date.now(),
			updatedAt: modifiedAt ?? currentBoard?.updatedAt ?? Date.now()
		};
		currentDoc = status.editor_projection
			? fromEditorProjection(status.editor_projection, status.snapshot)
			: fromCanonicalDocumentSnapshot(status.snapshot);
		if (!isDraft) {
			boardFiles.set(currentBoard.id, currentFile);
			boardFiles.set(boardIdForPath(status.path), currentFile);
		}
	}

	function updateStatus(status: SessionStatus) {
		const previousPath = currentFile?.path;
		currentStatus = status;
		currentFile = { path: status.path, name: fileName(status.path), modifiedAt: Date.now() };
		currentDoc = status.editor_projection
			? fromEditorProjection(status.editor_projection, status.snapshot)
			: fromCanonicalDocumentSnapshot(status.snapshot);
		if (currentBoard && currentFile && !currentIsDraft) {
			currentBoard = { ...currentBoard, updatedAt: Date.now() };
			boardFiles.set(currentBoard.id, currentFile);
		}
		if (previousPath && previousPath !== status.path) boardFiles.delete(boardIdForPath(previousPath));
		if (!currentIsDraft && currentFile) boardFiles.set(boardIdForPath(status.path), currentFile);
	}

	async function closeCurrentSession() {
		if (!currentStatus) return;
		await api.close({ session_id: currentStatus.session_id });
		notifyProposal({ proposal: null });
		currentStatus = null;
		currentFile = null;
		currentBoard = null;
		currentDoc = null;
		currentIsDraft = false;
	}

	async function saveCurrentSession() {
		if (!currentStatus) return;
		const saved = await api.save({
			session_id: currentStatus.session_id,
			expected_heads: currentStatus.snapshot.heads
		});
		updateStatus(saved.status);
	}

	async function openPath(path: string, boardName?: string): Promise<LoadedDoc> {
		if (currentStatus && currentStatus.path !== path) {
			if (currentStatus.dirty) await saveCurrentSession();
			await closeCurrentSession();
		}
		if (currentStatus?.path === path && currentDoc) return currentDoc;

		const opened = await api.openDocument({ path, actor_id: ACTOR_ID });
		const knownHandle = [...boardFiles.values()].find((handle) => handle.path === path);
		setCurrentState(opened.status, boardName, false, knownHandle?.modifiedAt);
		const handle = currentFile;
		if (handle) await fileOps.addRecentFile(handle);
		return currentDoc!;
	}

	async function openDraft(): Promise<{ boardId: string; doc: LoadedDoc }> {
		if (currentStatus) await closeCurrentSession();
		const opened = await api.openOrCreateDraft({ document_id: createId('board'), actor_id: ACTOR_ID });
		setCurrentState(opened.status, 'Untitled', true);
		if (!currentBoard || !currentDoc) throw new Error('Failed to open desktop draft');
		return { boardId: currentBoard.id, doc: currentDoc };
	}

	async function listBoards(): Promise<BoardMeta[]> {
		const workspace = await fileOps.getWorkspaceDir();
		const handles: FileHandle[] = [];
		const storage = workspace
			? { kind: 'workspace' as const, label: 'Workspace', location: workspace }
			: { kind: 'recent' as const, label: 'Recent files' };
		if (workspace) {
			const entries = await listDocumentEntries(fileOps, workspace);
			for (const entry of entries) {
				if (!entry.isDir) {
					handles.push({
						path: entry.path,
						name: entry.name,
						...(entry.modifiedAt !== undefined ? { modifiedAt: entry.modifiedAt } : {})
					});
				}
			}
		} else {
			handles.push(...(await fileOps.getRecentFiles()));
		}

		const boards = await Promise.all(
			handles.map(async (handle) => {
				let modifiedAt = handle.modifiedAt;
				if (modifiedAt === undefined && fileOps.getFileModifiedAt) {
					try {
						modifiedAt = (await fileOps.getFileModifiedAt(handle.path)) ?? undefined;
					} catch {
						modifiedAt = undefined;
					}
				}
				const id = boardIdForPath(handle.path);
				const board = {
					id,
					name: fileStem(handle.name),
					createdAt: 0,
					updatedAt: modifiedAt ?? 0,
					storage
				} satisfies BoardMeta;
				boardFiles.set(id, { ...handle, ...(modifiedAt !== undefined ? { modifiedAt } : {}) });
				return board;
			})
		);
		boards.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
		if (currentBoard && !currentIsDraft) {
			const current = { ...currentBoard, storage };
			const currentIndex = boards.findIndex((board) => boardFiles.get(board.id)?.path === currentFile?.path);
			if (currentIndex >= 0) {
				boards[currentIndex] = current;
			} else if (!boards.some((board) => board.id === current.id)) {
				boards.unshift(current);
			}
		}
		return boards;
	}

	async function createBoard(name: string): Promise<string> {
		const boardName = name.trim() || 'Untitled Board';
		const workspace = await fileOps.getWorkspaceDir();
		const path = workspace
			? joinPath(workspace, `${safeFileStem(boardName)}.inkfinite`)
			: await fileOps.showSaveDialog(`${safeFileStem(boardName)}.inkfinite`);
		if (!path) throw new Error('Save cancelled');

		if (currentStatus) {
			if (currentStatus.dirty) await saveCurrentSession();
			await closeCurrentSession();
		}
		const opened = await api.createDocument({
			path,
			document_id: createId('board'),
			actor_id: ACTOR_ID,
			page_name: 'Page 1'
		});
		setCurrentState(opened.status, boardName);
		if (!workspace && currentFile) await fileOps.addRecentFile(currentFile);
		return opened.status.snapshot.document_id;
	}

	async function duplicateBoard(boardId: string, name?: string): Promise<string> {
		await ensureBoardLoaded(boardId);
		if (!currentStatus || !currentBoard || !currentFile) throw new Error('No board loaded');

		if (currentStatus.dirty) await saveCurrentSession();
		if (!currentStatus || !currentBoard || !currentFile) throw new Error('No board loaded');

		const boardName = name?.trim() || `Copy of ${currentBoard.name}`;
		const workspace = await fileOps.getWorkspaceDir();
		const path = workspace
			? joinPath(workspace, `${safeFileStem(boardName)}.inkfinite`)
			: await fileOps.showSaveDialog(`${safeFileStem(boardName)}.inkfinite`);
		if (!path) throw new Error('Save cancelled');

		const sourceStatus = currentStatus;
		const opened = await api.duplicateDocument({
			session_id: sourceStatus.session_id,
			path,
			document_id: createId('board'),
			actor_id: ACTOR_ID,
			expected_heads: sourceStatus.snapshot.heads
		});
		setCurrentState(opened.status, boardName);
		currentBoard = { ...currentBoard!, createdAt: Date.now(), updatedAt: Date.now() };
		if (!workspace && currentFile) await fileOps.addRecentFile(currentFile);
		return opened.status.snapshot.document_id;
	}

	async function importSvg(path?: string): Promise<SvgImportResult | null> {
		if (!currentStatus || !currentDoc) throw new Error('No board loaded');
		const selectedPath = path ?? (await fileOps.showSvgDialog());
		if (!selectedPath) return null;
		const result = await api.importSvg({ session_id: currentStatus.session_id, path: selectedPath });
		updateStatus(result.session.status);
		await saveCurrentSession();
		if (!currentDoc) throw new Error('SVG import did not return a document');
		return {
			doc: currentDoc,
			warnings: result.warnings,
			omitted_image_count: result.omitted_image_count,
			shape_ids: result.shape_ids
		};
	}

	async function renameBoard(boardId: string, name: string): Promise<void> {
		await ensureBoardLoaded(boardId);
		if (!currentStatus || !currentFile || !currentBoard) throw new Error('No board loaded');
		const nextName = name.trim() || 'Untitled Board';
		const nextPath = joinPath(parentPath(currentFile.path), `${safeFileStem(nextName)}.inkfinite`);
		const saved = await api.saveAs({
			session_id: currentStatus.session_id,
			path: nextPath,
			expected_heads: currentStatus.snapshot.heads
		});
		const oldPath = currentFile.path;
		updateStatus(saved.status);
		currentBoard = { ...currentBoard, name: nextName, updatedAt: Date.now() };
		if (nextPath !== oldPath) {
			await fileOps.deleteFile(oldPath);
		}
		if (currentFile) await fileOps.addRecentFile(currentFile);
	}

	async function deleteBoard(boardId: string): Promise<void> {
		const handle = boardFiles.get(boardId);
		if (!handle) return;
		const workspace = await fileOps.getWorkspaceDir();
		if (currentStatus && currentFile?.path === handle.path) await closeCurrentSession();
		if (workspace) {
			await fileOps.deleteFile(handle.path);
		} else {
			await fileOps.removeRecentFile(handle.path);
		}
		boardFiles.delete(boardId);
	}

	async function loadDoc(boardId: string): Promise<LoadedDoc> {
		await ensureBoardLoaded(boardId);
		if (!currentDoc) throw new Error('No board loaded');
		return currentDoc;
	}

	async function openBoard(boardId: string): Promise<void> {
		await ensureBoardLoaded(boardId);
	}

	async function applyDocPatch(boardId: string, patch: DocPatch): Promise<void> {
		await ensureBoardLoaded(boardId);
		if (!currentStatus || !currentDoc) throw new Error('No board loaded');
		const nextDoc = applyPatch(currentDoc, patch);
		const request = createEditorReconciliationRequest(currentDoc, nextDoc, {
			actor_id: ACTOR_ID,
			origin: 'human',
			transaction_id: createId('transaction'),
			description: 'Update desktop document',
			timestamp: Date.now(),
			topologyEdits: patch.topologyEdits
		});
		if (request.patches.length === 0) return;
		const committed = await api.reconcileEditorPatches({
			session_id: currentStatus.session_id,
			patches: request.patches
		});
		updateStatus(committed.status);
		if (currentProposal) {
			notifyProposal({
				proposal: null,
				message: 'The document changed while this proposal was open. Review it again.'
			});
		}
		// Desktop edits are persisted by the backend service before the input event
		// queue advances, so reopening cannot lose a completed gesture.
		await saveCurrentSession();
	}

	async function exportBoard(boardId: string): Promise<BoardExport> {
		const doc = await loadDoc(boardId);
		if (!currentBoard) throw new Error('No board loaded');
		return {
			board: currentBoard,
			doc: {
				pages: doc.pages,
				shapes: doc.shapes,
				bindings: doc.bindings,
				...(doc.layers ? { layers: doc.layers } : {}),
				...(doc.assets ? { assets: doc.assets } : {})
			},
			order: doc.order
		};
	}

	async function importBoard(snapshot: BoardExport): Promise<string> {
		const path = await fileOps.showSaveDialog(`${safeFileStem(snapshot.board.name)}.inkfinite`);
		if (!path) throw new Error('Save cancelled');
		if (currentStatus) {
			if (currentStatus.dirty) await saveCurrentSession();
			await closeCurrentSession();
		}
		const opened = await api.createDocument({
			path,
			document_id: createId('board'),
			actor_id: ACTOR_ID,
			page_name: snapshot.doc.pages[snapshot.order.pageIds[0]]?.name ?? 'Page 1'
		});
		setCurrentState(opened.status, snapshot.board.name);
		if (!currentBoard || !currentDoc) throw new Error('Failed to create the imported Inkfinite document');
		const imported = rebaseImportedDocument(snapshot, currentDoc);
		await applyDocPatch(currentBoard.id, {
			upserts: {
				pages: Object.values(imported.pages),
				shapes: Object.values(imported.shapes),
				bindings: Object.values(imported.bindings),
				assets: Object.values(imported.assets ?? {})
			},
			order: imported.order
		});
		currentBoard = { ...currentBoard, name: snapshot.board.name, updatedAt: Date.now() };
		if (currentFile) await fileOps.addRecentFile(currentFile);
		return currentBoard.id;
	}

	async function openFromDialog(prepareToOpen?: () => Promise<void>): Promise<{ boardId: string; doc: LoadedDoc }> {
		const path = await fileOps.showOpenDialog();
		if (!path) throw new Error('Open cancelled');
		await prepareToOpen?.();
		const doc = await openPath(path);
		if (!currentBoard) throw new Error('Failed to open document');
		return { boardId: currentBoard.id, doc };
	}

	async function saveAs(prepareToSave?: () => Promise<void>): Promise<{ boardId: string; doc: LoadedDoc }> {
		if (!currentStatus || !currentBoard || !currentDoc) throw new Error('No board loaded');
		const path = await fileOps.showSaveDialog(`${safeFileStem(currentBoard.name)}.inkfinite`);
		if (!path) throw new Error('Save cancelled');
		await prepareToSave?.();
		if (!currentStatus || !currentBoard || !currentDoc) throw new Error('No board loaded');
		const saved =
			path === currentStatus.path
				? await api.save({ session_id: currentStatus.session_id, expected_heads: currentStatus.snapshot.heads })
				: await (currentIsDraft ? api.saveDraftAs : api.saveAs)({
						session_id: currentStatus.session_id,
						path,
						expected_heads: currentStatus.snapshot.heads
					});
		updateStatus(saved.status);
		currentIsDraft = false;
		currentBoard = { ...currentBoard, name: fileStem(path), updatedAt: Date.now() };
		if (currentFile) {
			boardFiles.set(currentBoard.id, currentFile);
			boardFiles.set(boardIdForPath(currentFile.path), currentFile);
			await fileOps.addRecentFile(currentFile);
		}
		return { boardId: currentBoard.id, doc: currentDoc };
	}

	async function ensureBoardLoaded(boardId: string): Promise<void> {
		if (currentBoard?.id === boardId && currentDoc) return;
		const handle = boardFiles.get(boardId);
		if (!handle) throw new Error(`Unknown board: ${boardId}`);
		await openPath(handle.path, fileStem(handle.name));
	}

	async function undo(): Promise<void> {
		if (!currentStatus) return;
		const result = await api.undo({ session_id: currentStatus.session_id, actor_id: ACTOR_ID });
		updateStatus(result.status);
		if (currentProposal) {
			notifyProposal({
				proposal: null,
				message: 'The document changed while this proposal was open. Review it again.'
			});
		}
		await saveCurrentSession();
	}

	async function redo(): Promise<void> {
		if (!currentStatus) return;
		const result = await api.redo({ session_id: currentStatus.session_id, actor_id: ACTOR_ID });
		updateStatus(result.status);
		if (currentProposal) {
			notifyProposal({
				proposal: null,
				message: 'The document changed while this proposal was open. Review it again.'
			});
		}
		await saveCurrentSession();
	}

	async function query(queryValue: Query): Promise<QueryResult> {
		if (!currentStatus) throw new Error('No board loaded');
		return api.query({ session_id: currentStatus.session_id, query: queryValue });
	}

	async function validate(): Promise<SessionStatus> {
		if (!currentStatus) throw new Error('No board loaded');
		const status = await api.validate({ session_id: currentStatus.session_id });
		updateStatus(status);
		return status;
	}

	function getProposal(): Proposal | null {
		return currentProposal;
	}

	function subscribeProposal(listener: (update: ProposalUpdate) => void): () => void {
		proposalListeners.add(listener);
		if (currentProposal) listener({ proposal: currentProposal });
		return () => proposalListeners.delete(listener);
	}

	function subscribeLiveDocument(listener: (doc: LoadedDoc) => void): () => void {
		liveDocumentListeners.add(listener);
		return () => liveDocumentListeners.delete(listener);
	}

	function subscribeAgentUi(listener: (control: AgentUiControl) => void): () => void {
		agentUiListeners.add(listener);
		return () => agentUiListeners.delete(listener);
	}

	async function acceptProposal(proposalId: string, operationPositions?: number[]): Promise<LoadedDoc> {
		if (!currentStatus) throw new Error('No board loaded');
		if (clearExpiredProposal(proposalId)) {
			if (!currentDoc) throw new Error('No board loaded');
			return currentDoc;
		}
		const result = await api.acceptProposal({
			session_id: currentStatus.session_id,
			proposal_id: proposalId,
			...(operationPositions ? { operation_positions: operationPositions } : {})
		});
		updateStatus(result.status);
		notifyProposal({ proposal: null });
		await saveCurrentSession();
		if (!currentDoc) throw new Error('Accepted proposal did not return a document');
		return currentDoc;
	}

	async function rejectProposal(proposalId: string): Promise<void> {
		if (!currentStatus) throw new Error('No board loaded');
		if (clearExpiredProposal(proposalId)) return;
		await api.rejectProposal({ session_id: currentStatus.session_id, proposal_id: proposalId });
		notifyProposal({ proposal: null });
	}

	async function updateAgentContext(context: {
		pageId: string | null;
		activeLayerId: string | null;
		selectionIds: string[];
		viewport: { x: number; y: number; width: number; height: number } | null;
		camera: { x: number; y: number; zoom: number } | null;
		occludedRegions: Array<{ x: number; y: number; width: number; height: number }>;
	}): Promise<void> {
		if (!currentStatus) return;
		await api.updateContext({
			session_id: currentStatus.session_id,
			page_id: context.pageId,
			active_layer_id: context.activeLayerId,
			selection_ids: context.selectionIds,
			viewport: context.viewport,
			camera: context.camera,
			occluded_regions: context.occludedRegions
		});
	}

	async function syncConnect(peerId: string): Promise<SessionStatus> {
		if (!currentStatus) throw new Error('No board loaded');
		const status = await api.syncConnect({ session_id: currentStatus.session_id, peer_id: peerId });
		updateStatus(status);
		return status;
	}

	async function syncDisconnect(peerId: string): Promise<SessionStatus> {
		if (!currentStatus) throw new Error('No board loaded');
		const status = await api.syncDisconnect({ session_id: currentStatus.session_id, peer_id: peerId });
		updateStatus(status);
		return status;
	}

	async function syncNext(peerId: string): Promise<SyncMessage | null> {
		if (!currentStatus) throw new Error('No board loaded');
		return api.syncNext({ session_id: currentStatus.session_id, peer_id: peerId });
	}

	async function syncReceive(message: SyncMessage): Promise<SessionSync> {
		if (!currentStatus) throw new Error('No board loaded');
		const result = await api.syncReceive({ session_id: currentStatus.session_id, message });
		updateStatus(result.status);
		return result;
	}

	return {
		kind: 'desktop',
		openDraft,
		isDraft: () => currentIsDraft,
		listBoards,
		createBoard,
		duplicateBoard,
		openBoard,
		renameBoard,
		deleteBoard,
		loadDoc,
		applyDocPatch,
		exportBoard,
		importBoard,
		getCurrentFile: () => (currentIsDraft ? null : currentFile),
		openPath: async (path: string) => {
			const doc = await openPath(path);
			if (!currentBoard) throw new Error('Failed to open document');
			return { boardId: currentBoard.id, doc };
		},
		importSvg,
		importSvgPath: (path: string) => importSvg(path),
		openFromDialog,
		saveAs,
		getWorkspaceDir: () => fileOps.getWorkspaceDir(),
		setWorkspaceDir: (path: string | null) => fileOps.setWorkspaceDir(path),
		pickWorkspaceDir: () => fileOps.pickWorkspaceDir(),
		undo,
		redo,
		query,
		validate,
		getSessionStatus: () => currentStatus,
		getProposal,
		subscribeProposal,
		subscribeLiveDocument,
		subscribeAgentUi,
		acceptProposal,
		rejectProposal,
		updateAgentContext,
		syncConnect,
		syncDisconnect,
		syncNext,
		syncReceive,
		closeSession: closeCurrentSession
	};
}

type PersistenceStatusStore = { update(updater: (status: PersistenceStatus) => PersistenceStatus): void };

/** Creates a serialized desktop persistence queue for editor history events. */
export function createDesktopPersistenceSink(
	repo: DesktopSessionRepo,
	statusStore?: PersistenceStatusStore
): PersistenceSink {
	let queue = Promise.resolve();
	let lastError: unknown = null;

	function updatePendingStatus(error?: unknown) {
		statusStore?.update((status) => {
			const pendingWrites = Math.max(0, (status.pendingWrites ?? 1) - 1);
			const persistenceError = error ?? lastError;
			if (persistenceError) {
				return { ...status, state: 'error', pendingWrites, errorMsg: describeError(persistenceError) };
			}
			return {
				...status,
				state: pendingWrites === 0 ? 'saved' : 'saving',
				pendingWrites,
				lastSavedAt: pendingWrites === 0 ? Date.now() : status.lastSavedAt,
				errorMsg: undefined
			};
		});
	}

	return {
		enqueueDocPatch(boardId, patch) {
			statusStore?.update((status) => ({
				...status,
				state: 'saving',
				pendingWrites: (status.pendingWrites ?? 0) + 1,
				errorMsg: undefined
			}));
			queue = queue
				.catch(() => undefined)
				.then(() => repo.applyDocPatch(boardId, patch))
				.then(() => updatePendingStatus())
				.catch((error) => {
					lastError = error;
					updatePendingStatus(error);
				});
		},
		async flush() {
			await queue;
			if (lastError) {
				const error = lastError;
				lastError = null;
				throw error;
			}
		}
	};
}

/** Narrows the shared repository contract to the desktop adapter. */
export function isDesktopSessionRepo(repo: PersistentDocRepo): repo is DesktopSessionRepo {
	return (repo as DesktopSessionRepo).kind === 'desktop';
}

async function listDocumentEntries(fileOps: DesktopFileOps, directory: string) {
	const entries = await fileOps.readDirectory(directory, '*.inkfinite');
	const seen = new Set<string>();
	return entries.filter((entry) => {
		if (seen.has(entry.path)) return false;
		seen.add(entry.path);
		return true;
	});
}

function applyPatch(doc: LoadedDoc, patch: DocPatch): LoadedDoc {
	const next = structuredClone(doc);
	for (const id of patch.deletes?.pageIds ?? []) delete next.pages[id];
	for (const id of patch.deletes?.shapeIds ?? []) delete next.shapes[id];
	for (const id of patch.deletes?.bindingIds ?? []) delete next.bindings[id];
	for (const id of patch.deletes?.assetIds ?? []) {
		if (next.assets) delete next.assets[id];
	}
	for (const page of patch.upserts?.pages ?? []) {
		const previous = next.pages[page.id];
		next.pages[page.id] = previous
			? {
					...previous,
					...page,
					...(page.layerIds === undefined && previous.layerIds ? { layerIds: [...previous.layerIds] } : {})
				}
			: page;
	}
	for (const shape of patch.upserts?.shapes ?? []) next.shapes[shape.id] = shape;
	for (const binding of patch.upserts?.bindings ?? []) next.bindings[binding.id] = binding;
	if (patch.upserts?.assets?.length) {
		next.assets ??= {};
		for (const asset of patch.upserts.assets) next.assets[asset.id] = { ...asset, bytes: [...asset.bytes] };
	}
	if (patch.order?.pageIds) next.order.pageIds = [...patch.order.pageIds];
	if (patch.order?.shapeOrder)
		next.order.shapeOrder = { ...(next.order.shapeOrder ?? {}), ...structuredClone(patch.order.shapeOrder) };
	if (patch.order?.layers) {
		next.layers = structuredClone(patch.order.layers);
		next.order.layers = structuredClone(patch.order.layers);
	}
	return next;
}

function rebaseImportedDocument(snapshot: BoardExport, destination: LoadedDoc): LoadedDoc {
	const sourcePageId = snapshot.order.pageIds[0] ?? Object.keys(snapshot.doc.pages)[0];
	const destinationPageId = destination.order.pageIds[0] ?? Object.keys(destination.pages)[0];
	const destinationPage = destination.pages[destinationPageId];
	const destinationLayerId = destinationPage?.layerIds?.[0] ?? Object.keys(destination.layers ?? {})[0];
	if (!sourcePageId || !destinationPageId || !destinationPage || !destinationLayerId) {
		throw new Error('Imported and destination documents must each contain a page and layer');
	}
	const sourcePage = snapshot.doc.pages[sourcePageId];
	const sourceShapeIds = snapshot.order.shapeOrder?.[sourcePageId] ?? sourcePage?.shapeIds ?? [];
	const shapes = Object.fromEntries(
		sourceShapeIds.flatMap((id) => {
			const shape = snapshot.doc.shapes[id];
			return shape
				? [[id, { ...structuredClone(shape), pageId: destinationPageId, layerId: destinationLayerId }]]
				: [];
		})
	) as LoadedDoc['shapes'];
	const bindings = Object.fromEntries(
		Object.entries(snapshot.doc.bindings).filter(
			([, binding]) => shapes[binding.fromShapeId] && shapes[binding.toShapeId]
		)
	);
	const assets = snapshot.doc.assets ? structuredClone(snapshot.doc.assets) : undefined;
	const layer: EditorLayerRecord = {
		...(destination.layers?.[destinationLayerId] ?? {
			id: destinationLayerId,
			pageId: destinationPageId,
			name: 'Imported',
			visible: true,
			locked: false,
			opacity: 1
		}),
		shapeIds: sourceShapeIds.filter((id) => Boolean(shapes[id]))
	};
	const page: EditorPageRecord = {
		...destinationPage,
		name: sourcePage?.name ?? destinationPage.name,
		shapeIds: [...layer.shapeIds],
		layerIds: [destinationLayerId]
	};
	return {
		pages: { [destinationPageId]: page },
		layers: { [destinationLayerId]: layer },
		shapes,
		bindings,
		...(assets ? { assets } : {}),
		order: {
			pageIds: [destinationPageId],
			shapeOrder: { [destinationPageId]: [...layer.shapeIds] },
			layers: { [destinationLayerId]: layer }
		}
	};
}

function fileName(path: string): string {
	return path.split(/[\\/]/).pop() || 'Untitled.inkfinite';
}

function fileStem(name: string): string {
	return name.replace(/\.inkfinite$/i, '');
}

function safeFileStem(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
}

function parentPath(path: string): string {
	const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return separator < 0 ? '.' : path.slice(0, separator);
}

function joinPath(parent: string, child: string): string {
	const separator = parent.includes('\\') ? '\\' : '/';
	return `${parent.replace(/[\\/]$/, '')}${separator}${child}`;
}

function boardIdForPath(path: string): string {
	return `path:${path}`;
}
