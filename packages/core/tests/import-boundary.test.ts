import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const forbidden = [
	/\bHTMLCanvasElement\b/,
	/\bCanvasRenderingContext2D\b/,
	/\bCanvasGradient\b/,
	/\bBlob\b/,
	/\bnavigator\b/,
	/\b(?:atob|btoa)\b/,
	/\bdocument\.createElement\b/,
	/\bwindow\./,
	/from\s+['"](?:svelte|@inkfinite\/(?:editor|ui|wasm)|@tauri-apps\/|\$app\/|\$lib\/)/,
	/import\s+['"](?:svelte|@inkfinite\/(?:editor|ui|wasm)|@tauri-apps\/|\$app\/|\$lib\/)/
];

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

describe('core import boundary', () => {
	it('keeps browser, UI, and application concerns out of core source', () => {
		const violations = sourceFiles(sourceRoot).flatMap((path) => {
			const source = readFileSync(path, 'utf8');
			return forbidden.filter((pattern) => pattern.test(source)).map((pattern) => `${path}: ${pattern}`);
		});

		expect(violations).toEqual([]);
	});
});
