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
	preview: {
		created: readonly unknown[];
		changed: readonly unknown[];
		deleted: readonly unknown[];
	};
	affected_regions: Array<{
		page_id: string;
		bounds: { x: number; y: number; width: number; height: number };
	}>;
	warnings: Array<{ code: string; message: string }>;
	expires_at: number;
};

/** Change notification used by the desktop review surface. */
export type ProposalUpdate = { proposal: LiveProposal | null; message?: string };

/** File command selected from a desktop application's native menu. */
export type NativeFileMenuAction =
	| 'new'
	| 'open'
	| 'save-as'
	| 'import'
	| 'export-excalidraw'
	| 'export-json-canvas';

/** User-selected external editable document. */
export type InterchangeSourceFile = { name: string; contents: string };

/** Platform file operations used by shared editable-format import and export. */
export interface InterchangeFileAccess {
	pickImport(): Promise<InterchangeSourceFile | null>;
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
	openFromDialog(
		prepareToOpen?: () => Promise<void>
	): Promise<{ boardId: string; doc: import('@inkfinite/core').LoadedDoc }>;
	/** Opens the native dialog, then waits for pending editor writes before saving the selected path. */
	saveAs(
		prepareToSave?: () => Promise<void>
	): Promise<{ boardId: string; doc: import('@inkfinite/core').LoadedDoc }>;
	getWorkspaceDir(): Promise<string | null>;
	setWorkspaceDir(path: string | null): Promise<void>;
	pickWorkspaceDir(): Promise<string | null>;
	closeSession(): Promise<void>;
	getProposal(): LiveProposal | null;
	subscribeProposal(listener: (update: ProposalUpdate) => void): () => void;
	acceptProposal(
		proposalId: string,
		operationPositions?: number[]
	): Promise<import('@inkfinite/core').LoadedDoc>;
	rejectProposal(proposalId: string): Promise<void>;
	authorizeApply(): Promise<{ token: string; session_id: string; expires_at: number }>;
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
	return {
		backend: platform === 'desktop' ? 'filesystem' : 'indexeddb',
		state: 'saved',
		pendingWrites: 0
	};
}
