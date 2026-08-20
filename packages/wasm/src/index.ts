import type { SvgImport } from '@inkfinite/bindings/svg-import';

export type { SvgImport, SvgImportWarning } from '@inkfinite/bindings/svg-import';

/** Structured error returned when Rust rejects an SVG. */
export type SvgImportFailure = { code: string; message: string };

/** JSON envelope emitted by the `inkfinite-wasm` crate. */
export type SvgImportResponse =
	| { status: 'success'; import: SvgImport; omitted_image_count: number }
	| { status: 'error'; error: SvgImportFailure };

type GeneratedWasmModule = { default(input?: unknown): Promise<unknown>; import_svg(source: Uint8Array): string };

let modulePromise: Promise<GeneratedWasmModule> | null = null;

/** Loads the generated Rust module once and imports one SVG byte buffer. */
export async function importSvg(source: Uint8Array): Promise<SvgImportResponse> {
	const module = await loadModule();
	const response = JSON.parse(module.import_svg(source)) as SvgImportResponse;
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
