import type { DocumentSnapshot } from '@inkfinite/bindings/model';
import type { EditorProjection, EditorReconciliationRequest } from '@inkfinite/bindings/editor';
import type { TransactionDraft } from '@inkfinite/bindings/transaction';
import type { SvgImport } from '@inkfinite/bindings/svg-import';

export type { DocumentSnapshot } from '@inkfinite/bindings/model';
export type {
	EditorPatch,
	EditorProjection,
	EditorReconciliationRequest,
	EditorTransform
} from '@inkfinite/bindings/editor';
export type { TransactionDraft } from '@inkfinite/bindings/transaction';
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

type GeneratedWasmModule = {
	default(input?: unknown): Promise<unknown>;
	import_svg(source: Uint8Array): string;
	project_editor(snapshotJson: string): string;
	reconcile_editor_patches(snapshotJson: string, requestJson: string): string;
	render_svg(snapshotJson: string, optionsJson: string): string;
};

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
	if (response.status === 'error') throw new Error(response.error.message);
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
	if (response.status === 'error') throw new Error(response.error.message);
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
