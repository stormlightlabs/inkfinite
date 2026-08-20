import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(root, 'packages/wasm/dist');
const target = path.join(root, 'target/wasm32-unknown-unknown/release/inkfinite_wasm.wasm');

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
	});
}

await run('cargo', ['build', '-p', 'inkfinite-wasm', '--target', 'wasm32-unknown-unknown', '--release']);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await run('wasm-bindgen', [target, '--target', 'web', '--out-dir', output, '--out-name', 'inkfinite_wasm']);
