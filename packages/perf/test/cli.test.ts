import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const cli = resolve(import.meta.dirname, '../dist/cli.mjs');

test('lists the performance commands', () => {
	const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /capture/);
	assert.match(result.stdout, /process/);
	assert.match(result.stdout, /browser/);
	assert.match(result.stdout, /profile/);
});

test('accepts the package-manager option separator', () => {
	const result = spawnSync(process.execPath, [cli, 'capture', '--', '--help'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Measure renderer traversal/);
});

test('rejects unknown options before starting a measurement', () => {
	const result = spawnSync(process.execPath, [cli, 'browser', '--unknown'], { encoding: 'utf8' });
	assert.notEqual(result.status, 0);
	assert.match(`${result.stdout}\n${result.stderr}`, /unknown option/i);
});
