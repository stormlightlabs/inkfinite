import type { InterchangeExport, SvgExport, SvgExportOptions } from '@inkfinite/core';
import type {
	BoardExport,
	BoardInspectorData,
	LoadedDoc,
	PersistenceSink,
	PersistentDocRepo
} from '@inkfinite/core/persistence';
import type { PersistenceStatus } from './statusbar';

/** A desktop document handle exposed to the shared editor surface. */
export type FileHandle = { path: string; name: string; modifiedAt?: number };
import type { StatusStore } from './status';

/** Runtime selected by an application composition root. */
export type EditorPlatform = 'web' | 'desktop';

/** Record-level before/after data produced by Rust for a live proposal. */
export type ProposalObjectPreview = {
	record_id: { kind: string; id: string };
	change: 'added' | 'modified' | 'moved' | 'removed';
	before: { kind: string; record: Record<string, unknown> } | null;
	after: { kind: string; record: Record<string, unknown> } | null;
	before_bounds: { x: number; y: number; width: number; height: number } | null;
	after_bounds: { x: number; y: number; width: number; height: number } | null;
	operation_positions: number[];
	changed_fields: string[];
};

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
	operation_previews?: Array<{
		position: number;
		label: string;
		record_ids: readonly unknown[];
		bounds: Array<{ x: number; y: number; width: number; height: number }>;
	}>;
	object_previews?: ProposalObjectPreview[];
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

/** User-selected external editable document or diagram source. */
export type InterchangeSourceFile = { name: string; contents: string };

/** User-selected SVG bytes kept out of the main-thread parser. */
export type SvgSourceFile = { name: string; bytes: Uint8Array };

/** Platform file operations used by shared editable-format import and export. */
export interface InterchangeFileAccess {
	pickImport(): Promise<InterchangeSourceFile | null>;
	/** Picks SVG bytes for the browser import path. */
	pickSvg?(): Promise<SvgSourceFile | null>;
	/** Renders a browser document through the application's shared Rust/WASM worker. */
	exportSvg?(snapshot: BoardExport, options?: SvgExportOptions): Promise<SvgExport>;
	saveExport(file: InterchangeExport | SvgExport, defaultStem: string): Promise<boolean>;
}

/**
 * Desktop-only capabilities consumed by the shared editor.
 *
 * The Tauri adapter implements this contract without exposing Tauri APIs to
 * the editor package.
 */
export interface DesktopDocumentRepo extends PersistentDocRepo {
	openDraft(): Promise<{ boardId: string; doc: LoadedDoc }>;
	isDraft(): boolean;
	getCurrentFile(): FileHandle | null;
	openPath(path: string): Promise<{ boardId: string; doc: LoadedDoc }>;
	importSvg(): Promise<{
		doc: LoadedDoc;
		warnings: string[];
		omitted_image_count: number;
		shape_ids: string[];
	} | null>;
	importSvgPath(
		path: string
	): Promise<{
		doc: LoadedDoc;
		warnings: string[];
		omitted_image_count: number;
		shape_ids: string[];
	} | null>;
	openFromDialog(
		prepareToOpen?: () => Promise<void>
	): Promise<{ boardId: string; doc: LoadedDoc }>;
	/** Opens the native dialog, then waits for pending editor writes before saving the selected path. */
	saveAs(prepareToSave?: () => Promise<void>): Promise<{ boardId: string; doc: LoadedDoc }>;
	getWorkspaceDir(): Promise<string | null>;
	setWorkspaceDir(path: string | null): Promise<void>;
	pickWorkspaceDir(): Promise<string | null>;
	closeSession(): Promise<void>;
	getProposal(): LiveProposal | null;
	subscribeProposal(listener: (update: ProposalUpdate) => void): () => void;
	/** Receives document snapshots committed by the live CLI or trusted sync peers. */
	subscribeLiveDocument(listener: (doc: LoadedDoc) => void): () => void;
	/** Receives authenticated live CLI navigation without changing document history. */
	subscribeAgentUi(listener: (control: AgentUiControl) => void): () => void;
	acceptProposal(proposalId: string, operationPositions?: number[]): Promise<LoadedDoc>;
	rejectProposal(proposalId: string): Promise<void>;

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
	/** Supplies the current editor document to a Rust-backed browser session and returns its projection. */
	setActiveDocument?: (boardId: string, doc: LoadedDoc) => Promise<LoadedDoc | null>;
	/** Opens dropped canonical `.inkfinite` bytes as a new browser board. */
	importCanonicalDocument?: (args: {
		name: string;
		source: Uint8Array;
	}) => Promise<{ boardId: string; doc: LoadedDoc }>;
	/** Commits browser SVG bytes through the active Rust document session. */
	commitSvgImport?: (args: {
		boardId: string;
		source: Uint8Array;
		sourceName: string;
		pageId?: string;
		layerId?: string;
	}) => Promise<{
		doc: LoadedDoc;
		warnings: Array<{ code: string; message: string; count: number }>;
		omittedImageCount: number;
		shapeIds: string[];
	}>;
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
