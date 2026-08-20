import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
	BoardExport,
	BoardMeta,
	DesktopFileOps,
	DocPatch,
	FileHandle,
	LoadedDoc,
	LayerRecord as EditorLayerRecord,
	PageRecord as EditorPageRecord,
	BindingRecord as EditorBindingRecord,
	PersistenceSink,
	PersistenceStatus,
	PersistentDocRepo,
	ShapeRecord as EditorShapeRecord
} from '@inkfinite/core';
import { createId } from '@inkfinite/core';
import type {
	BindingRecord as SnapshotBindingRecord,
	ChangeHash,
	CommitResult,
	ContainerLayout,
	DocumentSnapshot,
	Query,
	QueryResult,
	Provenance,
	Proposal,
	ShapeProperties,
	ShapeRecord,
	ShapeStyle,
	TransactionDraft,
	Transform,
	JsonValue
} from '@inkfinite/bindings';
import type { EditorPatch, EditorProjection, EditorTransform } from '@inkfinite/bindings/editor';

const ACTOR_ID = 'actor:desktop';

/** Serialized status returned by every desktop session command. */
export type SessionStatus = {
	session_id: string;
	path: string;
	actor_id: string;
	agent_access: 'review' | 'direct';
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
	reconcileEditorPatches?(args: { session_id: string; patches: EditorPatch[] }): Promise<SessionCommit>;
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
	setAgentAccess(args: { session_id: string; agent_access: 'review' | 'direct' }): Promise<SessionStatus>;
	undo(args: { session_id: string; actor_id: string }): Promise<SessionCommit>;
	redo(args: { session_id: string; actor_id: string }): Promise<SessionCommit>;
	save(args: { session_id: string; expected_heads: ChangeHash[] }): Promise<SessionSaved>;
	saveAs(args: { session_id: string; path: string; expected_heads: ChangeHash[] }): Promise<SessionSaved>;
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
		setAgentAccess: (args) =>
			invokeSession<SessionStatus>('set_agent_access', {
				sessionId: args.session_id,
				agentAccess: args.agent_access
			}),
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
	importSvg(): Promise<SvgImportResult | null>;
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
	getAgentAccess(): 'review' | 'direct';
	getProposal(): Proposal | null;
	subscribeProposal(listener: (update: ProposalUpdate) => void): () => void;
	subscribeLiveDocument(listener: (doc: LoadedDoc) => void): () => void;
	subscribeAgentUi(listener: (control: AgentUiControl) => void): () => void;
	acceptProposal(proposalId: string, operationPositions?: number[]): Promise<LoadedDoc>;
	rejectProposal(proposalId: string): Promise<void>;
	setAgentAccess(agentAccess: 'review' | 'direct'): Promise<SessionStatus>;
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

	function setCurrentState(status: SessionStatus, boardName?: string, isDraft = false) {
		currentStatus = status;
		currentIsDraft = isDraft;
		currentFile = { path: status.path, name: fileName(status.path) };
		currentBoard = {
			id: status.snapshot.document_id,
			name: boardName || fileStem(status.path),
			createdAt: currentBoard?.createdAt ?? Date.now(),
			updatedAt: Date.now()
		};
		currentDoc = status.editor_projection
			? loadedDocFromProjection(status.editor_projection)
			: loadedDocFromSnapshot(status.snapshot);
		if (!isDraft) {
			boardFiles.set(currentBoard.id, currentFile);
			boardFiles.set(boardIdForPath(status.path), currentFile);
		}
	}

	function updateStatus(status: SessionStatus) {
		const previousPath = currentFile?.path;
		currentStatus = status;
		currentFile = { path: status.path, name: fileName(status.path) };
		currentDoc = status.editor_projection
			? loadedDocFromProjection(status.editor_projection)
			: loadedDocFromSnapshot(status.snapshot);
		if (currentBoard && !currentIsDraft) {
			currentBoard = { ...currentBoard, updatedAt: Date.now() };
			boardFiles.set(currentBoard.id, currentFile);
		}
		if (previousPath && previousPath !== status.path) boardFiles.delete(boardIdForPath(previousPath));
		if (!currentIsDraft) boardFiles.set(boardIdForPath(status.path), currentFile);
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
		setCurrentState(opened.status, boardName);
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
		if (workspace) {
			const entries = await listDocumentEntries(fileOps, workspace);
			for (const entry of entries) {
				if (!entry.isDir) handles.push({ path: entry.path, name: entry.name });
			}
		} else {
			handles.push(...(await fileOps.getRecentFiles()));
		}

		const boards = handles.map((handle) => {
			const id = boardIdForPath(handle.path);
			boardFiles.set(id, handle);
			return { id, name: fileStem(handle.name), createdAt: 0, updatedAt: 0 } satisfies BoardMeta;
		});
		if (currentBoard && !currentIsDraft) {
			const currentIndex = boards.findIndex((board) => boardFiles.get(board.id)?.path === currentFile?.path);
			if (currentIndex >= 0) {
				boards[currentIndex] = currentBoard;
			} else if (!boards.some((board) => board.id === currentBoard?.id)) {
				boards.unshift(currentBoard);
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

	async function importSvg(): Promise<SvgImportResult | null> {
		if (!currentStatus || !currentDoc) throw new Error('No board loaded');
		const path = await fileOps.showSvgDialog();
		if (!path) return null;
		const result = await api.importSvg({ session_id: currentStatus.session_id, path });
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
		const editorPatches = editorPatchesForDocuments(currentDoc, nextDoc);
		if (editorPatches && editorPatches.length === 0) return;

		let committed: SessionCommit;
		if (editorPatches && api.reconcileEditorPatches) {
			committed = await api.reconcileEditorPatches({
				session_id: currentStatus.session_id,
				patches: editorPatches
			});
		} else {
			const target = documentFromLoadedDoc(nextDoc, currentStatus.snapshot, ACTOR_ID);
			const operations = operationsForMirror(currentStatus.snapshot, target);
			if (operations.length === 0) return;
			const transaction: TransactionDraft = {
				id: createId('transaction'),
				actor_id: ACTOR_ID,
				origin: 'human',
				base_heads: currentStatus.snapshot.heads,
				description: 'Update desktop document mirror',
				operations,
				timestamp: Date.now()
			};
			committed = await api.commit({ session_id: currentStatus.session_id, transaction });
		}
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
			doc: { pages: doc.pages, shapes: doc.shapes, bindings: doc.bindings },
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
				bindings: Object.values(imported.bindings)
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

	async function setAgentAccess(agentAccess: 'review' | 'direct'): Promise<SessionStatus> {
		if (!currentStatus) throw new Error('No board loaded');
		const status = await api.setAgentAccess({ session_id: currentStatus.session_id, agent_access: agentAccess });
		updateStatus(status);
		return status;
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
		openBoard,
		renameBoard,
		deleteBoard,
		loadDoc,
		applyDocPatch,
		exportBoard,
		importBoard,
		getCurrentFile: () => (currentIsDraft ? null : currentFile),
		importSvg,
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
		getAgentAccess: () => currentStatus?.agent_access ?? 'review',
		getProposal,
		subscribeProposal,
		subscribeLiveDocument,
		subscribeAgentUi,
		acceptProposal,
		rejectProposal,
		setAgentAccess,
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

function loadedDocFromProjection(projection: EditorProjection): LoadedDoc {
	const pages: Record<string, EditorPageRecord> = {};
	const layers: Record<string, EditorLayerRecord> = {};
	const shapes: Record<string, EditorShapeRecord> = {};
	const bindings: Record<string, EditorBindingRecord> = {};

	for (const pageId of projection.order.page_ids) {
		const page = projection.pages[pageId];
		if (!page) continue;
		pages[page.id] = { id: page.id, name: page.name, shapeIds: [...page.shape_ids], layerIds: [...page.layer_ids] };
	}
	for (const layer of Object.values(projection.layers)) {
		layers[layer.id] = {
			id: layer.id,
			pageId: layer.page_id,
			name: layer.name,
			shapeIds: [...layer.shape_ids],
			visible: layer.visible,
			locked: layer.locked,
			opacity: layer.opacity
		};
	}
	for (const shape of Object.values(projection.shapes)) {
		shapes[shape.id] = {
			id: shape.id,
			type: shape.type as EditorShapeRecord['type'],
			pageId: shape.page_id,
			x: shape.x,
			y: shape.y,
			rot: shape.rot,
			editorTransform: shape.transform,
			opacity: shape.opacity,
			...(shape.fill_opacity !== null ? { fillOpacity: shape.fill_opacity } : {}),
			...(shape.stroke_opacity !== null ? { strokeOpacity: shape.stroke_opacity } : {}),
			...(shape.group_id ? { groupId: shape.group_id } : {}),
			layerId: shape.layer_id,
			agentEditable: shape.agent_editable,
			props: shape.props as EditorShapeRecord['props']
		} as EditorShapeRecord;
	}
	for (const binding of Object.values(projection.bindings)) {
		bindings[binding.id] = {
			id: binding.id,
			type: binding.type as 'arrow-end',
			fromShapeId: binding.from_shape_id,
			toShapeId: binding.to_shape_id,
			handle: binding.handle as 'start' | 'end',
			anchor:
				binding.anchor.kind === 'center'
					? { kind: 'center' }
					: { kind: 'edge', nx: binding.anchor.x, ny: binding.anchor.y }
		};
	}
	return {
		pages,
		layers,
		shapes,
		bindings,
		order: {
			pageIds: [...projection.order.page_ids],
			shapeOrder: Object.fromEntries(
				Object.entries(projection.order.shape_order).map(([pageId, shapeIds]) => [pageId, [...shapeIds]])
			),
			layers
		}
	};
}

function loadedDocFromSnapshot(snapshot: DocumentSnapshot): LoadedDoc {
	const pages: Record<string, EditorPageRecord> = {};
	const layers: Record<string, EditorLayerRecord> = {};
	const shapes: Record<string, EditorShapeRecord> = {};
	const bindings: Record<string, EditorBindingRecord> = {};
	const shapeOrder: Record<string, string[]> = {};

	for (const pageId of snapshot.document.page_ids) {
		const page = snapshot.document.pages[pageId];
		if (!page) continue;
		const flattened: string[] = [];
		for (const layerId of page.layer_ids) {
			const layer = snapshot.document.layers[layerId];
			if (!layer) continue;
			const layerShapeIds: string[] = [];
			for (const shapeId of layer.shape_ids) {
				flattenShape(snapshot, page.id, layer.id, shapeId, undefined, layerShapeIds, shapes);
			}
			flattened.push(...layerShapeIds);
			layers[layer.id] = {
				id: layer.id,
				pageId: page.id,
				name: layer.name,
				shapeIds: layerShapeIds,
				visible: layer.visible,
				locked: layer.locked,
				opacity: layer.opacity
			};
		}
		pages[page.id] = { id: page.id, name: page.name, shapeIds: flattened, layerIds: [...page.layer_ids] };
		shapeOrder[page.id] = [...flattened];
	}

	for (const binding of Object.values(snapshot.document.bindings)) {
		bindings[binding.id] = {
			id: binding.id,
			type: binding.kind as 'arrow-end',
			fromShapeId: binding.source_shape_id,
			toShapeId: binding.target_shape_id,
			handle: binding.source_handle as 'start' | 'end',
			anchor:
				binding.anchor.kind === 'center'
					? { kind: 'center' }
					: { kind: 'edge', nx: binding.anchor.x, ny: binding.anchor.y }
		};
	}

	return { pages, layers, shapes, bindings, order: { pageIds: [...snapshot.document.page_ids], shapeOrder, layers } };
}

function flattenShape(
	snapshot: DocumentSnapshot,
	pageId: string,
	layerId: string,
	shapeId: string,
	groupId: string | undefined,
	flattened: string[],
	shapes: Record<string, EditorShapeRecord>
) {
	const shape = snapshot.document.shapes[shapeId];
	if (!shape) return;
	if (shape.kind !== 'container') {
		flattened.push(shape.id);
		shapes[shape.id] = { ...editorShapeFromSnapshot(shape, pageId, groupId), layerId };
	}
	for (const childId of shape.child_ids) {
		flattenShape(
			snapshot,
			pageId,
			layerId,
			childId,
			shape.kind === 'container' ? shape.id : groupId,
			flattened,
			shapes
		);
	}
}

function editorShapeFromSnapshot(shape: ShapeRecord, pageId: string, groupId?: string): EditorShapeRecord {
	const properties = { ...(shape.properties as Record<string, JsonValue>) };
	if ('width' in properties) {
		properties.w = properties.width;
		delete properties.width;
	}
	if ('height' in properties) {
		properties.h = properties.height;
		delete properties.height;
	}
	if (shape.kind === 'stroke' && shape.style.stroke_opacity !== null) {
		const strokeStyle = properties.style;
		properties.style = {
			...(typeof strokeStyle === 'object' && strokeStyle !== null && !Array.isArray(strokeStyle)
				? strokeStyle
				: {}),
			opacity: shape.style.stroke_opacity
		};
	}
	return {
		id: shape.id,
		type: shape.kind as EditorShapeRecord['type'],
		pageId,
		x: shape.transform.translation.x,
		y: shape.transform.translation.y,
		rot: shape.transform.rotation,
		opacity: shape.style.opacity,
		...(shape.style.fill_opacity !== null ? { fillOpacity: shape.style.fill_opacity } : {}),
		...(shape.style.stroke_opacity !== null ? { strokeOpacity: shape.style.stroke_opacity } : {}),
		...(groupId ? { groupId } : {}),
		agentEditable: shape.metadata.agent_editable,
		props: properties as EditorShapeRecord['props']
	} as EditorShapeRecord;
}

function applyPatch(doc: LoadedDoc, patch: DocPatch): LoadedDoc {
	const next = structuredClone(doc);
	for (const id of patch.deletes?.pageIds ?? []) delete next.pages[id];
	for (const id of patch.deletes?.shapeIds ?? []) delete next.shapes[id];
	for (const id of patch.deletes?.bindingIds ?? []) delete next.bindings[id];
	for (const page of patch.upserts?.pages ?? []) next.pages[page.id] = page;
	for (const shape of patch.upserts?.shapes ?? []) next.shapes[shape.id] = shape;
	for (const binding of patch.upserts?.bindings ?? []) next.bindings[binding.id] = binding;
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
		order: {
			pageIds: [destinationPageId],
			shapeOrder: { [destinationPageId]: [...layer.shapeIds] },
			layers: { [destinationLayerId]: layer }
		}
	};
}

function editorPatchesForDocuments(before: LoadedDoc, after: LoadedDoc): EditorPatch[] | null {
	const beforePageIds = Object.keys(before.pages).sort();
	const afterPageIds = Object.keys(after.pages).sort();
	const beforeLayerIds = Object.keys(before.layers ?? {}).sort();
	const afterLayerIds = Object.keys(after.layers ?? {}).sort();
	// Page/layer creation and deletion still use the complete document adapter
	// until their semantic operations are needed by the editor.
	if (JSON.stringify(beforePageIds) !== JSON.stringify(afterPageIds)) return null;
	if (JSON.stringify(beforeLayerIds) !== JSON.stringify(afterLayerIds)) return null;

	const patches: EditorPatch[] = [];
	for (const pageId of after.order.pageIds) {
		const previous = before.pages[pageId];
		const next = after.pages[pageId];
		if (previous && next && previous.name !== next.name) {
			patches.push({ type: 'rename_page', page_id: pageId, name: next.name });
		}
	}
	for (const layerId of after.order.layers ? Object.keys(after.order.layers) : Object.keys(after.layers ?? {})) {
		const previous = before.layers?.[layerId];
		const next = after.layers?.[layerId];
		if (!previous || !next) continue;
		if (
			previous.name !== next.name ||
			previous.visible !== next.visible ||
			previous.locked !== next.locked ||
			previous.opacity !== next.opacity
		) {
			patches.push({
				type: 'patch_layer',
				layer_id: layerId,
				patch: {
					name: previous.name === next.name ? null : next.name,
					visible: previous.visible === next.visible ? null : next.visible,
					locked: previous.locked === next.locked ? null : next.locked,
					opacity: previous.opacity === next.opacity ? null : next.opacity
				}
			});
		}
	}

	for (const shapeId of Object.keys(before.shapes)) {
		const previous = before.shapes[shapeId];
		const next = after.shapes[shapeId];
		if (!next) {
			patches.push({ type: 'delete_shape', shape_id: shapeId });
			continue;
		}
		const transformChanged = previous.x !== next.x || previous.y !== next.y || previous.rot !== next.rot;
		const parentChanged = previous.groupId !== next.groupId || previous.layerId !== next.layerId;
		const orderChanged =
			JSON.stringify(siblingAnchorForShape(before, previous)) !==
			JSON.stringify(siblingAnchorForShape(after, next));
		const propertiesChanged = !jsonEqual(previous.props, next.props);
		const styleChanged =
			(previous.opacity ?? 1) !== (next.opacity ?? 1) ||
			(previous.fillOpacity ?? null) !== (next.fillOpacity ?? null) ||
			(previous.strokeOpacity ?? null) !== (next.strokeOpacity ?? null);
		if (transformChanged || parentChanged || orderChanged || propertiesChanged || styleChanged) {
			patches.push({
				type: 'shape',
				shape_id: shapeId,
				transform: transformChanged || parentChanged ? affineForEditorShape(next) : null,
				properties: propertiesChanged ? (structuredClone(next.props) as ShapeProperties) : null,
				metadata: null,
				style: styleChanged
					? {
							opacity: next.opacity ?? 1,
							fill_opacity: next.fillOpacity ?? null,
							stroke_opacity: next.strokeOpacity ?? null
						}
					: null,
				parent: parentChanged ? editorParent(next) : null,
				anchor: orderChanged ? siblingAnchorForShape(after, next) : null
			});
		}
	}
	for (const shape of Object.values(after.shapes)) {
		if (before.shapes[shape.id]) continue;
		patches.push({
			type: 'create_shape',
			shape: {
				id: shape.id,
				kind: shape.type,
				properties: structuredClone(shape.props) as ShapeProperties,
				metadata: null,
				style: {
					opacity: shape.opacity ?? 1,
					fill_opacity: shape.fillOpacity ?? null,
					stroke_opacity: shape.strokeOpacity ?? null
				},
				layout: null
			},
			parent: editorParent(shape),
			transform: affineForEditorShape(shape),
			anchor: siblingAnchorForShape(after, shape)
		});
	}
	for (const bindingId of Object.keys(before.bindings)) {
		if (!after.bindings[bindingId]) patches.push({ type: 'delete_binding', binding_id: bindingId });
	}
	for (const binding of Object.values(after.bindings)) {
		if (before.bindings[binding.id]) continue;
		patches.push({
			type: 'create_binding',
			binding: {
				id: binding.id,
				kind: binding.type,
				source_shape_id: binding.fromShapeId,
				target_shape_id: binding.toShapeId,
				source_handle: binding.handle,
				anchor:
					binding.anchor.kind === 'center'
						? { kind: 'center' }
						: { kind: 'edge', x: binding.anchor.nx, y: binding.anchor.ny },
				version: 1
			}
		});
	}
	return patches;
}

function editorParent(shape: EditorShapeRecord): { kind: 'layer'; id: string } | { kind: 'shape'; id: string } {
	return shape.groupId ? { kind: 'shape', id: shape.groupId } : { kind: 'layer', id: shape.layerId ?? '' };
}

function affineForEditorShape(shape: EditorShapeRecord): EditorTransform {
	const projected = shape.editorTransform;
	if (projected) {
		const projectedRotation = Math.atan2(projected.b, projected.a);
		if (Math.abs(projectedRotation - shape.rot) <= 1e-9) {
			return { ...projected, e: shape.x, f: shape.y };
		}
		const scaleX = Math.hypot(projected.a, projected.b);
		const scaleY = scaleX > Number.EPSILON ? (projected.a * projected.d - projected.b * projected.c) / scaleX : 1;
		const cos = Math.cos(shape.rot);
		const sin = Math.sin(shape.rot);
		return { a: cos * scaleX, b: sin * scaleX, c: -sin * scaleY, d: cos * scaleY, e: shape.x, f: shape.y };
	}
	const cos = Math.cos(shape.rot);
	const sin = Math.sin(shape.rot);
	return { a: cos, b: sin, c: -sin, d: cos, e: shape.x, f: shape.y };
}

function siblingAnchorForShape(
	doc: LoadedDoc,
	shape: EditorShapeRecord
): { position: 'last' } | { position: 'before'; sibling_id: string } {
	const layer = shape.layerId ? doc.layers?.[shape.layerId] : undefined;
	const siblings = layer?.shapeIds.filter((id) => doc.shapes[id]?.groupId === shape.groupId) ?? [];
	const nextId = siblings[siblings.indexOf(shape.id) + 1];
	return nextId ? { position: 'before', sibling_id: nextId } : { position: 'last' };
}

function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function documentFromLoadedDoc(doc: LoadedDoc, current: DocumentSnapshot, actor: string): DocumentSnapshot {
	const pages = structuredClone(current.document.pages);
	const layers = structuredClone(current.document.layers);
	const shapes: Record<string, ShapeRecord> = {};
	const groupChildren = new Map<string, string[]>();
	const shapePages = new Map<string, { pageId: string; layerId: string }>();

	for (const pageId of doc.order.pageIds) {
		const page = doc.pages[pageId];
		const currentPage = pages[pageId];
		if (!page || !currentPage) {
			throw new Error(`Desktop mirror cannot update unknown page ${pageId}`);
		}
		const layerIds = page.layerIds?.length ? page.layerIds : currentPage.layer_ids;
		for (const layerId of layerIds) {
			const editorLayer = doc.layers?.[layerId];
			const currentLayer = current.document.layers[layerId];
			if (!editorLayer && !currentLayer) continue;
			const layerShapeIds =
				editorLayer?.shapeIds ?? page.shapeIds.filter((id) => doc.shapes[id]?.layerId === layerId);
			const roots: string[] = [];
			for (const shapeId of layerShapeIds) {
				const shape = doc.shapes[shapeId];
				if (!shape) continue;
				if (shape.groupId) {
					const children = groupChildren.get(shape.groupId) ?? [];
					children.push(shape.id);
					groupChildren.set(shape.groupId, children);
					if (!roots.includes(shape.groupId)) roots.push(shape.groupId);
				} else {
					roots.push(shape.id);
				}
				shapePages.set(shape.id, { pageId, layerId });
			}
			layers[layerId] = {
				id: layerId,
				page_id: pageId,
				name: editorLayer?.name ?? currentLayer?.name ?? 'Layer',
				shape_ids: roots,
				visible: editorLayer?.visible ?? currentLayer?.visible ?? true,
				locked: editorLayer?.locked ?? currentLayer?.locked ?? false,
				opacity: editorLayer?.opacity ?? currentLayer?.opacity ?? 1,
				version: currentLayer?.version ?? 1
			};
		}
		pages[pageId] = { ...currentPage, name: page.name, layer_ids: [...layerIds] };
	}
	const retainedLayerIds = new Set(Object.values(pages).flatMap((page) => page.layer_ids));
	for (const layerId of Object.keys(layers)) {
		if (!retainedLayerIds.has(layerId)) delete layers[layerId];
	}

	for (const shape of Object.values(doc.shapes)) {
		const location = shapePages.get(shape.id);
		if (!location) continue;
		const existing = current.document.shapes[shape.id];
		shapes[shape.id] = shapeFromEditor(shape, location, existing, actor);
	}
	for (const [groupId, childIds] of groupChildren) {
		const location = shapePages.get(childIds[0]);
		if (!location) continue;
		const existing = current.document.shapes[groupId];
		shapes[groupId] = {
			id: groupId,
			kind: 'container',
			parent: { kind: 'layer', id: location.layerId },
			transform: identityTransform(),
			child_ids: childIds,
			layout: { kind: 'free' } satisfies ContainerLayout,
			properties: {},
			metadata: existing?.metadata ?? defaultMetadata(actor),
			style: existing?.style ?? defaultStyle(),
			version: existing?.version ?? 1
		};
	}

	const bindings: Record<string, SnapshotBindingRecord> = {};
	for (const binding of Object.values(doc.bindings)) {
		bindings[binding.id] = {
			id: binding.id,
			kind: binding.type,
			source_shape_id: binding.fromShapeId,
			target_shape_id: binding.toShapeId,
			source_handle: binding.handle,
			anchor:
				binding.anchor.kind === 'center'
					? { kind: 'center' }
					: { kind: 'edge', x: binding.anchor.nx, y: binding.anchor.ny },
			version: current.document.bindings[binding.id]?.version ?? 1
		};
	}

	return {
		...current,
		document: { ...current.document, page_ids: [...doc.order.pageIds], pages, layers, shapes, bindings }
	};
}

function shapeFromEditor(
	shape: EditorShapeRecord,
	location: { pageId: string; layerId: string },
	existing: ShapeRecord | undefined,
	actor: string
): ShapeRecord {
	const properties = structuredClone(shape.props) as Record<string, JsonValue>;
	if ('w' in properties) {
		properties.width = properties.w;
		delete properties.w;
	}
	if ('h' in properties) {
		properties.height = properties.h;
		delete properties.h;
	}
	const strokeStyle = shape.type === 'stroke' ? shape.props.style : undefined;
	const strokeOpacity =
		shape.strokeOpacity ??
		(strokeStyle && typeof strokeStyle.opacity === 'number' ? strokeStyle.opacity : undefined) ??
		existing?.style.stroke_opacity ??
		null;
	return {
		id: shape.id,
		kind: shape.type,
		parent: shape.groupId ? { kind: 'shape', id: shape.groupId } : { kind: 'layer', id: location.layerId },
		transform: {
			translation: { x: shape.x, y: shape.y },
			rotation: shape.rot,
			scale_x: existing?.transform.scale_x ?? 1,
			scale_y: existing?.transform.scale_y ?? 1
		} satisfies Transform,
		child_ids: [],
		layout: null,
		properties: properties as ShapeProperties,
		metadata: {
			...(existing?.metadata ?? defaultMetadata(actor)),
			agent_editable: shape.agentEditable ?? existing?.metadata.agent_editable ?? true
		},
		style: {
			opacity: shape.opacity ?? existing?.style.opacity ?? 1,
			fill_opacity: shape.fillOpacity ?? existing?.style.fill_opacity ?? null,
			stroke_opacity: strokeOpacity
		},
		version: existing?.version ?? 1
	};
}

function operationsForMirror(current: DocumentSnapshot, target: DocumentSnapshot): TransactionDraft['operations'] {
	const operations: TransactionDraft['operations'] = [];
	for (const binding of Object.values(current.document.bindings)) {
		operations.push({ type: 'delete_binding', binding_id: binding.id, expected_version: binding.version });
	}
	for (const page of Object.values(current.document.pages)) {
		if (target.document.pages[page.id]?.name !== page.name) {
			operations.push({
				type: 'rename_page',
				page_id: page.id,
				name: target.document.pages[page.id]?.name ?? page.name,
				expected_version: page.version
			});
		}
	}
	const currentRoots = Object.values(current.document.layers).flatMap((layer) => layer.shape_ids);
	for (const shapeId of currentRoots) {
		const shape = current.document.shapes[shapeId];
		if (shape) operations.push({ type: 'delete_shape', shape_id: shape.id, expected_version: shape.version });
	}
	const created = new Set<string>();
	const createShape = (shapeId: string) => {
		if (created.has(shapeId)) return;
		const shape = target.document.shapes[shapeId];
		if (!shape) return;
		if (shape.parent.kind === 'shape') createShape(shape.parent.id);
		operations.push({ type: 'create_shape', shape, anchor: { position: 'last' } });
		created.add(shapeId);
	};
	for (const layer of Object.values(target.document.layers)) {
		for (const shapeId of layer.shape_ids) createShape(shapeId);
	}
	for (const binding of Object.values(target.document.bindings)) {
		operations.push({ type: 'create_binding', binding });
	}
	return operations;
}

function defaultMetadata(actor: string) {
	return {
		name: null,
		role: null,
		description: null,
		tags: [],
		locked: false,
		agent_editable: true,
		provenance: { actor_id: actor, origin: 'human', timestamp: Date.now(), source: null } satisfies Provenance
	};
}

function defaultStyle(): ShapeStyle {
	return { opacity: 1, fill_opacity: null, stroke_opacity: null };
}

function identityTransform(): Transform {
	return { translation: { x: 0, y: 0 }, rotation: 0, scale_x: 1, scale_y: 1 };
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
