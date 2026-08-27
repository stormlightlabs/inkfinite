import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const requestedVersion = process.argv[2];
if (process.argv.length > 3 || requestedVersion === '--help' || requestedVersion === '-h') {
	console.log('Usage: node scripts/release/check-version.mjs [VERSION]');
	process.exit(requestedVersion === '--help' || requestedVersion === '-h' ? 0 : 2);
}

const workspaceManifest = readFileSync(join(root, 'Cargo.toml'), 'utf8');
const workspaceVersion = workspaceManifest.match(/^version = "([^"]+)"$/m)?.[1];
if (!workspaceVersion) throw new Error('Could not read the workspace version from Cargo.toml');
if (requestedVersion && requestedVersion !== workspaceVersion) {
	throw new Error(`Cargo.toml has version ${workspaceVersion}, expected ${requestedVersion}`);
}

const packageManifests = [join(root, 'package.json')];
for (const directory of ['apps', 'packages']) {
	for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
		if (entry.isDirectory()) packageManifests.push(join(root, directory, entry.name, 'package.json'));
	}
}
for (const manifest of packageManifests) {
	const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
	if (version !== workspaceVersion) {
		throw new Error(`${manifest.slice(root.length + 1)} has version ${version}, expected ${workspaceVersion}`);
	}
}

const desktopManifest = readFileSync(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
const desktopVersion = desktopManifest.match(/^version = "([^"]+)"$/m)?.[1];
if (desktopVersion !== workspaceVersion) {
	throw new Error(`apps/desktop/src-tauri/Cargo.toml has version ${desktopVersion}, expected ${workspaceVersion}`);
}

const tauriConfig = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
if (tauriConfig.version !== workspaceVersion) {
	throw new Error(
		`apps/desktop/src-tauri/tauri.conf.json has version ${tauriConfig.version}, expected ${workspaceVersion}`
	);
}

for (const changelog of ['CHANGELOG.md', 'apps/web/src/content/docs/changelog.md']) {
	const contents = readFileSync(join(root, changelog), 'utf8');
	if (!contents.includes(`\n## ${workspaceVersion}\n`)) {
		throw new Error(`${changelog} has no ${workspaceVersion} release`);
	}
}

console.log(`Release version ${workspaceVersion} is consistent`);
