import type {
	BoardInspectorData,
	FileHandle,
	InterchangeExport,
	PersistenceSink,
	PersistenceStatus,
	PersistentDocRepo
} from '@inkfinite/core';
import type { StatusStore } from './status';

/** Runtime selected by an application composition root. */
export type EditorPlatform = 'web' | 'desktop';

/** Small, renderer-facing projection of a Rust live proposal. */
export type LiveProposal = {
	id: string;
	transaction: { operations: readonly unknown[] };
	preview: { created: readonly unknown[]; changed: readonly unknown[]; deleted: readonly unknown[] };
	affected_regions: Array<{ page_id: string; bounds: { x: number; y: number; width: number; height: number } }>;
	operation_previews?: Array<{
		position: number;
		label: string;
		record_ids: readonly unknown[];
		bounds: Array<{ x: number; y: number; width: number; height: number }>;
	}>;
	warnings: Array<{ code: string; message: string }>;
	expires_at: number;
};

/** Change notification used by the desktop review surface. */
export type ProposalUpdate = { proposal: LiveProposal | null; message?: string };

/** Editor-only state shared with read-only agent context queries. */
export type AgentEditorContext = {
	pageId: string | null;
	activeLayerId: string | null;
	selectionIds: string[];
	viewport: { x: number; y: number; width: number; height: number } | null;
	camera: { x: number; y: number; zoom: number } | null;
	occludedRegions: Array<{ x: number; y: number; width: number; height: number }>;
};

/** Typed page, layer, selection, and camera control received from the live CLI. */
export type AgentUiControl = {
	page_id?: string | null;
	active_layer_id?: string | null;
	selection_ids?: string[] | null;
	camera?: { x: number; y: number; zoom: number } | null;
};

/** File command selected from a desktop application's native menu. */
export type NativeFileMenuAction =
	| 'new'
	| 'open'
	| 'save-as'
	| 'import'
	| 'import-svg'
	| 'export-excalidraw'
	| 'export-json-canvas';

/** User-selected external editable document. */
export type InterchangeSourceFile = { name: string; contents: string };

/** Platform file operations used by shared editable-format import and export. */
export interface InterchangeFileAccess {
	pickImport(): Promise<InterchangeSourceFile | null>;
	/** Picks an SVG source for the browser import path. */
	pickSvg?(): Promise<InterchangeSourceFile | null>;
	saveExport(file: InterchangeExport, defaultStem: string): Promise<boolean>;
}

/**
 * Desktop-only capabilities consumed by the shared editor.
 *
 * The Tauri adapter implements this contract without exposing Tauri APIs to
 * the editor package.
 */
export interface DesktopDocumentRepo extends PersistentDocRepo {
	openDraft(): Promise<{ boardId: string; doc: import('@inkfinite/core').LoadedDoc }>;
	isDraft(): boolean;
	getCurrentFile(): FileHandle | null;
	importSvg(): Promise<{
		doc: import('@inkfinite/core').LoadedDoc;
		warnings: string[];
		omitted_image_count: number;
		shape_ids: string[];
	} | null>;
	openFromDialog(
		prepareToOpen?: () => Promise<void>
	): Promise<{ boardId: string; doc: import('@inkfinite/core').LoadedDoc }>;
	/** Opens the native dialog, then waits for pending editor writes before saving the selected path. */
	saveAs(prepareToSave?: () => Promise<void>): Promise<{ boardId: string; doc: import('@inkfinite/core').LoadedDoc }>;
	getWorkspaceDir(): Promise<string | null>;
	setWorkspaceDir(path: string | null): Promise<void>;
	pickWorkspaceDir(): Promise<string | null>;
	closeSession(): Promise<void>;
	getProposal(): LiveProposal | null;
	getAgentAccess(): 'review' | 'direct';
	subscribeProposal(listener: (update: ProposalUpdate) => void): () => void;
	/** Receives document snapshots committed by the live CLI or trusted sync peers. */
	subscribeLiveDocument(listener: (doc: import('@inkfinite/core').LoadedDoc) => void): () => void;
	/** Receives authenticated live CLI navigation without changing document history. */
	subscribeAgentUi(listener: (control: AgentUiControl) => void): () => void;
	acceptProposal(proposalId: string, operationPositions?: number[]): Promise<import('@inkfinite/core').LoadedDoc>;
	rejectProposal(proposalId: string): Promise<void>;
	setAgentAccess(agentAccess: 'review' | 'direct'): Promise<{ agent_access: 'review' | 'direct' }>;
	/** Publishes the current page, selection, and visible world-space rectangle. */
	updateAgentContext(context: AgentEditorContext): Promise<void>;
}

/** Connected persistence services used for one mounted editor. */
export type EditorPlatformSession = {
	repo: PersistentDocRepo;
	sink: PersistenceSink;
	status: StatusStore;
	interchange?: InterchangeFileAccess;
	desktop?: DesktopDocumentRepo;
	inspectBoard?: (boardId: string) => Promise<BoardInspectorData>;
	setActiveBoard?: (boardId: string | null) => void;
	subscribeFileMenu?: (listener: (action: NativeFileMenuAction) => void) => () => void;
	dispose?: () => void;
};

/** Application-owned adapter that connects the editor to durable storage. */
export interface EditorPlatformAdapter {
	readonly kind: EditorPlatform;
	connect(): Promise<EditorPlatformSession>;
}

/** Creates the initial status shown while an application adapter connects. */
export function initialPersistenceStatus(platform: EditorPlatform): PersistenceStatus {
	return { backend: platform === 'desktop' ? 'filesystem' : 'indexeddb', state: 'saved', pendingWrites: 0 };
}
