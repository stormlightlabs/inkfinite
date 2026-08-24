import type { DocumentSnapshot } from '@inkfinite/bindings/model';
import type { EditorProjection, EditorReconciliationRequest } from '@inkfinite/bindings/editor';
import type { CommitResult, TransactionDraft } from '@inkfinite/bindings/transaction';
import type {
	WasmArrowGeometryResponse,
	WasmDocumentMutationResponse,
	WasmDocumentSessionFailure,
	WasmDocumentSessionState,
	WasmEditorProjectionResponse,
	WasmEditorReconciliationResponse,
	WasmSvgImportCommitResponse,
	WasmSvgImportFailure,
	WasmSvgImportResponse,
	WasmSvgRenderFailure,
	WasmSvgRenderOptions,
	WasmSvgRenderResponse,
	WasmSvgRenderWarning
} from '@inkfinite/bindings/wasm';
export type { DocumentSnapshot } from '@inkfinite/bindings/model';
export type {
	EditorPatch,
	EditorProjection,
	EditorReconciliationRequest,
	EditorTransform
} from '@inkfinite/bindings/editor';
export type { TransactionDraft, CommitResult } from '@inkfinite/bindings/transaction';
export type { SvgImport, SvgImportWarning } from '@inkfinite/bindings/svg-import';
export type {
	WasmArrowGeometryResponse,
	WasmDocumentMutationResponse,
	WasmDocumentSessionFailure,
	WasmDocumentSessionState,
	WasmEditorProjectionResponse,
	WasmEditorReconciliationResponse,
	WasmSvgImportCommitResponse,
	WasmSvgImportFailure,
	WasmSvgImportResponse,
	WasmSvgRenderFailure,
	WasmSvgRenderOptions,
	WasmSvgRenderResponse,
	WasmSvgRenderWarning
} from '@inkfinite/bindings/wasm';

/** Structured error returned when Rust rejects an SVG. */
export type SvgImportFailure = WasmSvgImportFailure;
/** JSON envelope emitted by the `inkfinite-wasm` SVG importer. */
export type SvgImportResponse = WasmSvgImportResponse;
/** JSON envelope emitted after an SVG is committed to a document session. */
export type SvgImportCommitResponse = WasmSvgImportCommitResponse;
/** Options accepted by the Rust SVG renderer. */
export type SvgRenderOptions = Partial<WasmSvgRenderOptions>;
/** Structured warning emitted by deterministic Rust SVG rendering. */
export type SvgRenderWarning = WasmSvgRenderWarning;
/** Structured failure returned when Rust cannot render a snapshot. */
export type SvgRenderFailure = WasmSvgRenderFailure;
/** JSON envelope emitted by the `inkfinite-wasm` SVG renderer. */
export type SvgRenderResponse = WasmSvgRenderResponse;
/** Response envelope returned by Rust editor projection. */
export type EditorProjectionResponse = WasmEditorProjectionResponse;
/** Response envelope returned by Rust editor reconciliation. */
export type EditorReconciliationResponse = WasmEditorReconciliationResponse;
/** Stable failure returned by a stateful browser document session. */
export type DocumentSessionFailure = WasmDocumentSessionFailure;
/** Successful mutation envelope returned by the Rust document engine. */
export type DocumentMutationResponse = WasmDocumentMutationResponse;
/** Snapshot, projection, and history capabilities owned by one Rust session. */
export type DocumentSessionState = WasmDocumentSessionState;

type SvgImportCommitSuccess = Extract<SvgImportCommitResponse, { status: 'success' }>;

interface GeneratedDocumentSession {
	state_json(): string;
	save(): Uint8Array;
	apply_transaction(transactionJson: string): string;
	apply_editor_patches(requestJson: string): string;
	import_svg_document(
		source: Uint8Array,
		sourceName: string,
		pageId: string,
		layerId: string,
		timestamp: number
	): string;
	undo(): string;
	redo(): string;
	can_undo(): boolean;
	can_redo(): boolean;
	free(): void;
}

interface GeneratedWasmModule {
	default(input?: unknown): Promise<unknown>;
	import_svg(source: Uint8Array): string;
	project_editor(snapshotJson: string): string;
	resolve_arrow_geometry(snapshotJson: string, arrowId: string): string;
	reconcile_editor_patches(snapshotJson: string, requestJson: string): string;
	render_svg(snapshotJson: string, optionsJson: string): string;
	create_document(snapshotJson: string, actorId: string): GeneratedDocumentSession;
	open_document(bytes: Uint8Array, actorId: string): GeneratedDocumentSession;
}

/** A stateful WASM document session. Keep one instance per worker/document. */
export class WasmDocumentSession {
	private constructor(private readonly session: GeneratedDocumentSession) {}

	/** Creates a session from a normalized snapshot, used for new or migrated boards. */
	static async create(snapshot: DocumentSnapshot, actorId: string): Promise<WasmDocumentSession> {
		const module = await loadModule();
		return new WasmDocumentSession(module.create_document(JSON.stringify(snapshot), actorId));
	}

	/** Opens a session from canonical Automerge bytes. */
	static async open(bytes: Uint8Array, actorId: string): Promise<WasmDocumentSession> {
		const module = await loadModule();
		return new WasmDocumentSession(module.open_document(bytes, actorId));
	}

	/** Returns the current snapshot and Rust-owned undo/redo capabilities. */
	state(): DocumentSessionState {
		return JSON.parse(this.session.state_json()) as DocumentSessionState;
	}

	/** Returns canonical Automerge bytes for persistence. */
	save(): Uint8Array {
		return this.session.save();
	}

	/** Applies one transaction through Rust validation and history. */
	applyTransaction(transaction: TransactionDraft): CommitResult {
		return mutation(this.session.apply_transaction(JSON.stringify(transaction)));
	}

	/** Reconciles semantic editor patches and commits the resulting transaction. */
	applyEditorPatches(request: EditorReconciliationRequest): CommitResult {
		return mutation(this.session.apply_editor_patches(JSON.stringify(request)));
	}

	/** Parses and commits an SVG through the shared Rust transaction builder. */
	importSvg(
		source: Uint8Array,
		sourceName = '',
		pageId = '',
		layerId = '',
		timestamp = Date.now()
	): SvgImportCommitSuccess {
		const response = JSON.parse(
			this.session.import_svg_document(source, sourceName, pageId, layerId, timestamp)
		) as SvgImportCommitResponse;
		if (response.status === 'error') {
			throw new DocumentSessionError(response.error.code, response.error.message);
		}
		return response;
	}

	/** Compensates the latest transaction for this session actor. */
	undo(): CommitResult {
		return mutation(this.session.undo());
	}

	/** Reapplies the latest compensated transaction for this session actor. */
	redo(): CommitResult {
		return mutation(this.session.redo());
	}

	/** Reports whether the session actor can undo. */
	canUndo(): boolean {
		return this.session.can_undo();
	}

	/** Reports whether the session actor can redo. */
	canRedo(): boolean {
		return this.session.can_redo();
	}

	/** Releases the Rust session. */
	dispose(): void {
		this.session.free();
	}
}

/** Error thrown when Rust rejects a document mutation. */
export class DocumentSessionError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'DocumentSessionError';
	}
}

let modulePromise: Promise<GeneratedWasmModule> | null = null;

/** Loads the generated Rust module once and imports one SVG byte buffer. */
export async function importSvg(source: Uint8Array): Promise<SvgImportResponse> {
	const module = await loadModule();
	const response = JSON.parse(module.import_svg(source)) as SvgImportResponse;
	return response;
}

/** Projects a canonical document snapshot into the shared flat editor view. */
export async function projectEditor(snapshot: DocumentSnapshot): Promise<EditorProjection> {
	const module = await loadModule();
	const response = JSON.parse(module.project_editor(JSON.stringify(snapshot))) as EditorProjectionResponse;
	if (response.status === 'error') {
		throw new Error(response.error.message);
	}
	return response.projection;
}

/** Resolves one arrow through the Rust-owned connector geometry path. */
export async function resolveArrowGeometry(
	snapshot: DocumentSnapshot,
	arrowId: string
): Promise<WasmArrowGeometryResponse> {
	const module = await loadModule();
	return JSON.parse(module.resolve_arrow_geometry(JSON.stringify(snapshot), arrowId)) as WasmArrowGeometryResponse;
}

/** Reconciles semantic editor changes into one native transaction draft. */
export async function reconcileEditorPatches(
	snapshot: DocumentSnapshot,
	request: EditorReconciliationRequest
): Promise<TransactionDraft> {
	const module = await loadModule();
	const response = JSON.parse(
		module.reconcile_editor_patches(JSON.stringify(snapshot), JSON.stringify(request))
	) as EditorReconciliationResponse;
	if (response.status === 'error') {
		throw new Error(response.error.message);
	}
	return response.transaction;
}

/** Renders a canonical document snapshot through the Rust SVG renderer. */
export async function renderSvg(
	snapshot: DocumentSnapshot,
	options: SvgRenderOptions = {}
): Promise<SvgRenderResponse> {
	const module = await loadModule();
	const response = JSON.parse(
		module.render_svg(JSON.stringify(snapshot), JSON.stringify(options))
	) as SvgRenderResponse;
	return response;
}

function mutation(serialized: string): CommitResult {
	const response = JSON.parse(serialized) as DocumentMutationResponse;
	if (response.status === 'error') {
		throw new DocumentSessionError(response.error.code, response.error.message);
	}
	return response.commit;
}

/** Clears the lazy module cache, primarily for worker tests and hot reload. */
export function resetWasmModuleForTests() {
	modulePromise = null;
}

async function loadModule(): Promise<GeneratedWasmModule> {
	modulePromise ??= (async () => {
		const generatedUrl = new URL('../dist/inkfinite_wasm.js', import.meta.url);
		const generated = (await import(/* @vite-ignore */ generatedUrl.href)) as GeneratedWasmModule;
		await generated.default();
		return generated;
	})();
	return modulePromise;
}
