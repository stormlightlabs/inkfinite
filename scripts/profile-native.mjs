#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const filterIndex = arguments_.indexOf('--filter');
const outputIndex = arguments_.indexOf('--output');
if (filterIndex >= 0 && !arguments_[filterIndex + 1]) {
	throw new Error('--filter requires a Criterion benchmark filter');
}
if (outputIndex >= 0 && !arguments_[outputIndex + 1]) {
	throw new Error('--output requires a profile path');
}
const filter = filterIndex >= 0 ? arguments_[filterIndex + 1] : 'document/load/flat/100$';
const output = path.resolve(
	root,
	outputIndex >= 0 ? arguments_[outputIndex + 1] : path.join('profiles', `native-${os.platform()}-${os.arch()}.json`)
);

requireTool('samply', ['--version']);
const cargo = spawnSync(
	'cargo',
	[
		'bench',
		'-p',
		'inkfinite-core',
		'--bench',
		'performance',
		'--profile',
		'profiling',
		'--no-run',
		'--message-format=json'
	],
	{ cwd: root, encoding: 'utf8' }
);
if (cargo.error) {
	throw cargo.error;
}
if (cargo.status !== 0) {
	process.stderr.write(cargo.stderr);
	throw new Error(`cargo bench exited with code ${cargo.status}`);
}

const executable = cargo.stdout
	.split('\n')
	.map((line) => {
		try {
			return JSON.parse(line);
		} catch {
			return null;
		}
	})
	.find(
		(message) =>
			message?.reason === 'compiler-artifact' &&
			message.target?.name === 'performance' &&
			message.target?.kind?.includes('bench') &&
			message.executable
	)?.executable;
if (!executable) {
	throw new Error('cargo did not report the compiled performance benchmark executable');
}

await mkdir(path.dirname(output), { recursive: true });
const result = spawnSync(
	'samply',
	['record', '--save-only', '--output', output, '--', executable, filter, '--noplot'],
	{ cwd: root, stdio: 'inherit' }
);
if (result.error) {
	throw result.error;
}
if (result.status !== 0) {
	throw new Error(`samply exited with code ${result.status}`);
}
console.log(`Wrote ${path.relative(root, output)}`);

function requireTool(command, arguments_) {
	const result = spawnSync(command, arguments_, { cwd: root, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${command} is required for native profiling; install it before running this command`);
	}
	if (result.status !== 0) {
		throw new Error(`${command} ${arguments_.join(' ')} failed with exit code ${result.status}`);
	}
}
