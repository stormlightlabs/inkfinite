import { invoke } from '@tauri-apps/api/core';
import type {
	BoardExport,
	BoardMeta,
	DesktopFileOps,
	DocPatch,
	FileHandle,
	LoadedDoc,
	LayerRecord as LegacyLayerRecord,
	PageRecord as LegacyPageRecord,
	BindingRecord as LegacyBindingRecord,
	PersistenceSink,
	PersistentDocRepo,
	ShapeRecord as LegacyShapeRecord
} from '@inkfinite/core';
import { createId } from '@inkfinite/core';
import type {
	BindingRecord as V2BindingRecord,
	ChangeHash,
	CommitResult,
	ContainerLayout,
	DocumentSnapshot,
	Query,
	QueryResult,
	Provenance,
	ShapeProperties,
	ShapeRecord,
	ShapeStyle,
	TransactionDraft,
	Transform,
	JsonValue
} from '@inkfinite/bindings';

const ACTOR_ID = 'actor:desktop';

/** Serialized status returned by every desktop session command. */
export type SessionStatus = {
	session_id: string;
	path: string;
	actor_id: string;
	snapshot: DocumentSnapshot;
	dirty: boolean;
	lock_held: boolean;
	recovery_available: boolean;
	can_undo: boolean;
	can_redo: boolean;
	sync: { status: 'disabled' };
};

/** Result returned after creating or opening a desktop session. */
export type SessionOpened = { session_id: string; status: SessionStatus };

/** Result returned after committing, undoing, or redoing a transaction. */
export type SessionCommit = { commit: CommitResult; status: SessionStatus };

/** Result returned after persisting a session. */
export type SessionSaved = { save: { path: string; heads: ChangeHash[] }; status: SessionStatus };

/** Typed command boundary used by the desktop adapter and its tests. */
export interface SessionApi {
	createDocument(args: {
		path: string;
		document_id: string;
		actor_id: string;
		page_name?: string;
	}): Promise<SessionOpened>;
	openDocument(args: { path: string; actor_id: string }): Promise<SessionOpened>;
	snapshot(args: { session_id: string }): Promise<SessionStatus>;
	commit(args: { session_id: string; transaction: TransactionDraft }): Promise<SessionCommit>;
	undo(args: { session_id: string; actor_id: string }): Promise<SessionCommit>;
	redo(args: { session_id: string; actor_id: string }): Promise<SessionCommit>;
	save(args: { session_id: string; expected_heads: ChangeHash[] }): Promise<SessionSaved>;
	saveAs(args: { session_id: string; path: string; expected_heads: ChangeHash[] }): Promise<SessionSaved>;
	query(args: { session_id: string; query: Query }): Promise<QueryResult>;
	validate(args: { session_id: string }): Promise<SessionStatus>;
	close(args: { session_id: string }): Promise<void>;
}

function createSessionApi(): SessionApi {
	return {
		createDocument: (args) => invoke<SessionOpened>('create_document', args),
		openDocument: (args) => invoke<SessionOpened>('open_document', args),
		snapshot: (args) => invoke<SessionStatus>('snapshot', args),
		commit: (args) => invoke<SessionCommit>('commit', args),
		undo: (args) => invoke<SessionCommit>('undo', args),
		redo: (args) => invoke<SessionCommit>('redo', args),
		save: (args) => invoke<SessionSaved>('save', args),
		saveAs: (args) => invoke<SessionSaved>('save_as', args),
		query: (args) => invoke<QueryResult>('query', args),
		validate: (args) => invoke<SessionStatus>('validate', args),
		close: (args) => invoke<void>('close', args)
	};
}

/** Persistent document repository backed by one backend/tauri-owned session. */
export type DesktopSessionRepo = PersistentDocRepo & {
	kind: 'desktop';
	getCurrentFile(): FileHandle | null;
	openFromDialog(): Promise<{ boardId: string; doc: LoadedDoc }>;
	getWorkspaceDir(): Promise<string | null>;
	setWorkspaceDir(path: string | null): Promise<void>;
	pickWorkspaceDir(): Promise<string | null>;
	undo(): Promise<void>;
	redo(): Promise<void>;
	query(query: Query): Promise<QueryResult>;
	validate(): Promise<SessionStatus>;
	getSessionStatus(): SessionStatus | null;
	closeSession(): Promise<void>;
};

/**
 * Creates the desktop repository adapter. Document bytes cross the Tauri
 * command boundary only; this adapter keeps the renderer's legacy mirror in
 * memory until the backend returns a committed snapshot.
 */
export function createDesktopSessionRepo(fileOps: DesktopFileOps, opts: { api?: SessionApi } = {}): DesktopSessionRepo {
	const api = opts.api ?? createSessionApi();
	let currentFile: FileHandle | null = null;
	let currentBoard: BoardMeta | null = null;
	let currentDoc: LoadedDoc | null = null;
	let currentStatus: SessionStatus | null = null;
	const boardFiles = new Map<string, FileHandle>();

	function setCurrentState(status: SessionStatus, boardName?: string) {
		currentStatus = status;
		currentFile = { path: status.path, name: fileName(status.path) };
		currentBoard = {
			id: status.snapshot.document_id,
			name: boardName || fileStem(status.path),
			createdAt: currentBoard?.createdAt ?? Date.now(),
			updatedAt: Date.now()
		};
		currentDoc = loadedDocFromSnapshot(status.snapshot);
		boardFiles.set(currentBoard.id, currentFile);
		boardFiles.set(boardIdForPath(status.path), currentFile);
	}

	function updateStatus(status: SessionStatus) {
		const previousPath = currentFile?.path;
		currentStatus = status;
		currentFile = { path: status.path, name: fileName(status.path) };
		currentDoc = loadedDocFromSnapshot(status.snapshot);
		if (currentBoard) {
			currentBoard = { ...currentBoard, updatedAt: Date.now() };
			boardFiles.set(currentBoard.id, currentFile);
		}
		if (previousPath && previousPath !== status.path) boardFiles.delete(boardIdForPath(previousPath));
		boardFiles.set(boardIdForPath(status.path), currentFile);
	}

	async function closeCurrentSession() {
		if (!currentStatus) return;
		await api.close({ session_id: currentStatus.session_id });
		currentStatus = null;
		currentFile = null;
		currentBoard = null;
		currentDoc = null;
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
		if (currentBoard) {
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

	async function renameBoard(boardId: string, name: string): Promise<void> {
		await ensureBoardLoaded(boardId);
		if (!currentStatus || !currentFile || !currentBoard) throw new Error('No board loaded');
		const nextName = name.trim() || 'Untitled Board';
		const nextPath = joinPath(
			parentPath(currentFile.path),
			`${safeFileStem(nextName)}${canonicalExtension(currentFile.path)}`
		);
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
		const committed = await api.commit({ session_id: currentStatus.session_id, transaction });
		updateStatus(committed.status);
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
		if (!currentStatus || !currentBoard) throw new Error('No board loaded');
		const path = await fileOps.showSaveDialog(`${safeFileStem(snapshot.board.name)}.inkfinite`);
		if (!path) throw new Error('Save cancelled');
		const saved = await api.saveAs({
			session_id: currentStatus.session_id,
			path,
			expected_heads: currentStatus.snapshot.heads
		});
		updateStatus(saved.status);
		currentBoard = { ...currentBoard, name: snapshot.board.name, updatedAt: Date.now() };
		if (currentFile) await fileOps.addRecentFile(currentFile);
		return currentBoard.id;
	}

	async function openFromDialog(): Promise<{ boardId: string; doc: LoadedDoc }> {
		const path = await fileOps.showOpenDialog();
		if (!path) throw new Error('Open cancelled');
		const doc = await openPath(path);
		if (!currentBoard) throw new Error('Failed to open document');
		return { boardId: currentBoard.id, doc };
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
		await saveCurrentSession();
	}

	async function redo(): Promise<void> {
		if (!currentStatus) return;
		const result = await api.redo({ session_id: currentStatus.session_id, actor_id: ACTOR_ID });
		updateStatus(result.status);
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

	return {
		kind: 'desktop',
		listBoards,
		createBoard,
		openBoard,
		renameBoard,
		deleteBoard,
		loadDoc,
		applyDocPatch,
		exportBoard,
		importBoard,
		getCurrentFile: () => currentFile,
		openFromDialog,
		getWorkspaceDir: () => fileOps.getWorkspaceDir(),
		setWorkspaceDir: (path: string | null) => fileOps.setWorkspaceDir(path),
		pickWorkspaceDir: () => fileOps.pickWorkspaceDir(),
		undo,
		redo,
		query,
		validate,
		getSessionStatus: () => currentStatus,
		closeSession: closeCurrentSession
	};
}

/** Creates a serialized desktop persistence queue for editor history events. */
export function createDesktopPersistenceSink(repo: DesktopSessionRepo): PersistenceSink {
	let queue = Promise.resolve();
	let lastError: unknown = null;
	return {
		enqueueDocPatch(boardId, patch) {
			queue = queue
				.catch(() => undefined)
				.then(() => repo.applyDocPatch(boardId, patch))
				.catch((error) => {
					lastError = error;
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
	const [canonical, legacy] = await Promise.all([
		fileOps.readDirectory(directory, '*.inkfinite'),
		fileOps.readDirectory(directory, '*.inkfinite.json')
	]);
	const canonicalPaths = new Set(canonical.map((entry) => entry.path));
	const seen = new Set<string>();
	return [...canonical, ...legacy].filter((entry) => {
		if (entry.path.endsWith('.inkfinite.json') && canonicalPaths.has(entry.path.slice(0, -5))) {
			return false;
		}
		if (seen.has(entry.path)) return false;
		seen.add(entry.path);
		return true;
	});
}

function loadedDocFromSnapshot(snapshot: DocumentSnapshot): LoadedDoc {
	const pages: Record<string, LegacyPageRecord> = {};
	const layers: Record<string, LegacyLayerRecord> = {};
	const shapes: Record<string, LegacyShapeRecord> = {};
	const bindings: Record<string, LegacyBindingRecord> = {};
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
	shapes: Record<string, LegacyShapeRecord>
) {
	const shape = snapshot.document.shapes[shapeId];
	if (!shape) return;
	if (shape.kind !== 'container') {
		flattened.push(shape.id);
		shapes[shape.id] = { ...legacyShapeFromV2(shape, pageId, groupId), layerId };
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

function legacyShapeFromV2(shape: ShapeRecord, pageId: string, groupId?: string): LegacyShapeRecord {
	const properties = { ...(shape.properties as Record<string, JsonValue>) };
	if ('width' in properties) {
		properties.w = properties.width;
		delete properties.width;
	}
	if ('height' in properties) {
		properties.h = properties.height;
		delete properties.height;
	}
	return {
		id: shape.id,
		type: shape.kind as LegacyShapeRecord['type'],
		pageId,
		x: shape.transform.translation.x,
		y: shape.transform.translation.y,
		rot: shape.transform.rotation,
		...(groupId ? { groupId } : {}),
		props: properties as LegacyShapeRecord['props']
	} as LegacyShapeRecord;
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
			const legacyLayer = doc.layers?.[layerId];
			const currentLayer = current.document.layers[layerId];
			if (!legacyLayer && !currentLayer) continue;
			const layerShapeIds =
				legacyLayer?.shapeIds ?? page.shapeIds.filter((id) => doc.shapes[id]?.layerId === layerId);
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
				name: legacyLayer?.name ?? currentLayer?.name ?? 'Layer',
				shape_ids: roots,
				visible: legacyLayer?.visible ?? currentLayer?.visible ?? true,
				locked: legacyLayer?.locked ?? currentLayer?.locked ?? false,
				opacity: legacyLayer?.opacity ?? currentLayer?.opacity ?? 1,
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
		shapes[shape.id] = shapeFromLegacy(shape, location, existing, actor);
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

	const bindings: Record<string, V2BindingRecord> = {};
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

function shapeFromLegacy(
	shape: LegacyShapeRecord,
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
		metadata: existing?.metadata ?? defaultMetadata(actor),
		style: existing?.style ?? defaultStyle(),
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
	return name.replace(/\.inkfinite(?:\.json)?$/i, '');
}

function safeFileStem(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
}

function canonicalExtension(path: string): string {
	return path.endsWith('.inkfinite.json') ? '.inkfinite.json' : '.inkfinite';
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
