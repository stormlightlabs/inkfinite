import type { DocumentSnapshot } from '@inkfinite/bindings/model';
import type { EditorProjection, EditorReconciliationRequest } from '@inkfinite/bindings/editor';
import type { CommitResult, TransactionDraft } from '@inkfinite/bindings/transaction';
import type { SvgImport } from '@inkfinite/bindings/svg-import';
export type { DocumentSnapshot } from '@inkfinite/bindings/model';
export type {
	EditorPatch,
	EditorProjection,
	EditorReconciliationRequest,
	EditorTransform
} from '@inkfinite/bindings/editor';
export type { TransactionDraft, CommitResult } from '@inkfinite/bindings/transaction';
export type { SvgImport, SvgImportWarning } from '@inkfinite/bindings/svg-import';

/** Structured error returned when Rust rejects an SVG. */
export type SvgImportFailure = { code: string; message: string };

/** JSON envelope emitted by the `inkfinite-wasm` crate. */
export type SvgImportResponse =
	| { status: 'success'; import: SvgImport; omitted_image_count: number }
	| { status: 'error'; error: SvgImportFailure };

/** Options accepted by the Rust SVG renderer. Empty selections include the whole page. */
export type SvgRenderOptions = {
	page_id?: string;
	layer_ids?: string[];
	selection?: string[];
	region?: { x: number; y: number; width: number; height: number };
	available_font_families?: string[];
	available_asset_ids?: string[];
};

/** Structured warning emitted by deterministic Rust SVG rendering. */
export type SvgRenderWarning = { code: string; message: string };

/** Structured failure returned when Rust cannot render a snapshot. */
export type SvgRenderFailure = { code: string; message: string };

/** JSON envelope emitted by the `inkfinite-wasm` SVG renderer. */
export type SvgRenderResponse =
	| { status: 'success'; svg: string; warnings: SvgRenderWarning[] }
	| { status: 'error'; error: SvgRenderFailure };

/** Response envelope returned by Rust editor projection. */
export type EditorProjectionResponse =
	| { status: 'success'; projection: EditorProjection }
	| { status: 'error'; error: { code: string; message: string } };

/** Response envelope returned by Rust editor reconciliation. */
export type EditorReconciliationResponse =
	| { status: 'success'; transaction: TransactionDraft }
	| { status: 'error'; error: { code: string; message: string } };

interface GeneratedDocumentSession {
	state_json(): string;
	save(): Uint8Array;
	apply_transaction(transactionJson: string): string;
	apply_editor_patches(requestJson: string): string;
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
	reconcile_editor_patches(snapshotJson: string, requestJson: string): string;
	render_svg(snapshotJson: string, optionsJson: string): string;
	create_document(snapshotJson: string, actorId: string): GeneratedDocumentSession;
	open_document(bytes: Uint8Array, actorId: string): GeneratedDocumentSession;
}

/** Stable failure returned by a stateful browser document session. */
export type DocumentSessionFailure = { code: string; message: string };

/** Successful mutation envelope returned by the Rust document engine. */
export type DocumentMutationResponse =
	| { status: 'success'; commit: CommitResult }
	| { status: 'error'; error: DocumentSessionFailure };

/** Snapshot and history capabilities owned by one Rust document session. */
export type DocumentSessionState = { snapshot: DocumentSnapshot; can_undo: boolean; can_redo: boolean };

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
