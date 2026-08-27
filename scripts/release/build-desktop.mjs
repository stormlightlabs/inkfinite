import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let target;
let noSign = false;
for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];
	if (argument === '--target') {
		target = process.argv[(index += 1)];
		if (!target) throw new Error('--target requires a Rust target triple');
	} else if (argument === '--no-sign') {
		noSign = true;
	} else if (argument === '--help' || argument === '-h') {
		console.log('Usage: node scripts/release/build-desktop.mjs [--target TARGET] [--no-sign]');
		process.exit(0);
	} else {
		throw new Error(`Unknown argument: ${argument}`);
	}
}

if (!target) {
	const rustc = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
	target = rustc.match(/^host: (.+)$/m)?.[1];
}
if (!target || !/^[A-Za-z0-9._-]+$/.test(target)) throw new Error(`Invalid Rust target: ${target}`);

let bundles;
let artifactExtensions;
if (target.includes('apple-darwin')) {
	bundles = ['dmg'];
	artifactExtensions = ['.dmg'];
} else if (target.includes('linux')) {
	bundles = ['appimage', 'deb'];
	artifactExtensions = ['.AppImage', '.deb'];
} else if (target.includes('windows')) {
	bundles = ['nsis', 'msi'];
	artifactExtensions = ['.exe', '.msi'];
} else {
	throw new Error(`The desktop release matrix does not include ${target}`);
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, env: { ...process.env, CI: 'true' }, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

run(process.execPath, [join(root, 'scripts/release/check-version.mjs')]);

const bundleDirectory = join(root, 'target', target, 'release', 'bundle');
rmSync(bundleDirectory, { force: true, recursive: true });
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const buildArguments = [
	'--filter',
	'@inkfinite/desktop',
	'tauri',
	'build',
	'--ci',
	'--target',
	target,
	'--bundles',
	...bundles
];
if (noSign) buildArguments.push('--no-sign');
run(pnpm, buildArguments);

const artifacts = [];
const pending = [bundleDirectory];
while (pending.length > 0) {
	const directory = pending.pop();
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) pending.push(path);
		else if (artifactExtensions.some((extension) => entry.name.endsWith(extension))) artifacts.push(path);
	}
}
for (const extension of artifactExtensions) {
	const matches = artifacts.filter((artifact) => artifact.endsWith(extension));
	if (matches.length !== 1) {
		throw new Error(`Expected one ${extension} bundle in ${bundleDirectory}, found ${matches.length}`);
	}
}

const cargoManifest = execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
	cwd: root,
	encoding: 'utf8'
});
const metadata = JSON.parse(cargoManifest);
const version = metadata.packages.find((packageMetadata) => packageMetadata.name === 'desktop')?.version;
if (!version) throw new Error('Could not read the desktop package version');

const distribution = join(root, 'dist');
mkdirSync(distribution, { recursive: true });
for (const artifact of artifacts) {
	const extension = artifact.endsWith('.AppImage') ? '.AppImage' : extname(artifact);
	const destination = join(distribution, `Inkfinite-v${version}-${target}${extension}`);
	copyFileSync(artifact, destination);
	console.log(`Copied ${destination}`);
}
run('cargo', ['xtask', 'checksums']);
