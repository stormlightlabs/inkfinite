#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(root, 'fixtures/native/performance/corpus.json');
const defaultOutput = path.join(root, 'fixtures/native/performance/process-budget.json');

const options = parseArguments(process.argv.slice(2));
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
const hyperfineVersion = requireTool('hyperfine', ['--version']);
const warmups = options.warmups ?? corpus.warmups;
const samples = options.samples ?? corpus.samples;
const selectedProfiles = selectProfiles(corpus.profiles, options);

const binaries = {
	cli: path.join(root, 'target/profiling/inkfinite'),
	mcp: path.join(root, 'target/profiling/inkfinite-mcp'),
	fixture: path.join(root, 'target/profiling/examples/performance-fixture')
};

run('cargo', ['build', '-p', 'inkfinite-cli', '--bin', 'inkfinite', '--profile', 'profiling']);
run('cargo', ['build', '-p', 'inkfinite-mcp', '--bin', 'inkfinite-mcp', '--profile', 'profiling']);
run('cargo', ['build', '-p', 'inkfinite-core', '--example', 'performance-fixture', '--profile', 'profiling']);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'inkfinite-process-performance-'));
const documents = path.join(temporaryRoot, 'documents');
const mutationDocument = path.join(temporaryRoot, 'mutation.inkfinite');
const renderOutput = path.join(temporaryRoot, 'render.svg');
const exportRoot = path.join(temporaryRoot, 'hyperfine');
await mkdir(exportRoot, { recursive: true });
run(binaries.fixture, ['--output-dir', documents]);

const measurements = [];
try {
	for (const profile of selectedProfiles) {
		for (const size of corpus.sizes) {
			const document = path.join(documents, `${profile.id}-${size}.inkfinite`);
			const shapeId = `shape:performance:${profile.id}:${size}:00000`;
			const mutationCommand = [
				quote(binaries.cli),
				'shape',
				'patch',
				quote(mutationDocument),
				'--shape-id',
				quote(shapeId),
				'--patch',
				quote('{"transform":{"translation":{"x":1,"y":0},"rotation":0,"scale_x":1,"scale_y":1}}'),
				'--json'
			].join(' ');
			const prepareMutation = `cp ${quote(document)} ${quote(mutationDocument)}`;
			const commands = [
				['inspect', `${quote(binaries.cli)} inspect ${quote(document)} --summary --json`],
				['query', `${quote(binaries.cli)} query ${quote(document)} --limit 100 --json`],
				['validate', `${quote(binaries.cli)} validate ${quote(document)} --json`],
				['render', `${quote(binaries.cli)} render ${quote(document)} --output ${quote(renderOutput)} --json`],
				['mutate', mutationCommand, prepareMutation]
			];

			for (const [operation, command, prepare] of commands) {
				const exportPath = path.join(exportRoot, `${profile.id}-${size}-${operation}.json`);
				const result = runHyperfine(command, operation, exportPath, prepare);
				measurements.push({ profile: profile.id, size, operation, ...result });
			}
		}
	}

	const mcpStartup = path.join(root, 'scripts/mcp-startup.mjs');
	const mcpCommand = `${quote(process.execPath)} ${quote(mcpStartup)} ${quote(binaries.mcp)}`;
	const mcpExportPath = path.join(exportRoot, 'mcp-startup.json');
	const mcpResult = runHyperfine(mcpCommand, 'mcp-startup', mcpExportPath);
	measurements.push({ operation: 'mcp-startup', ...mcpResult });

	const output = {
		schemaVersion: 1,
		fixture: {
			path: 'fixtures/native/performance/corpus.json',
			seed: corpus.seed,
			sizes: corpus.sizes,
			profiles: selectedProfiles.map(({ id }) => id)
		},
		methodology: {
			tool: 'hyperfine',
			hyperfineVersion,
			warmups,
			samples,
			clock: 'hyperfine wall-clock process duration',
			mutation: 'each mutation sample starts from a fresh copy of its fixture',
			mcp: 'one JSON-RPC initialize request, then terminate after the first response'
		},
		hardware: {
			platform: `${process.platform} ${process.arch}`,
			cpus: os.cpus().length,
			model: os.cpus()[0]?.model ?? 'unknown',
			node: process.version
		},
		measurements
	};
	await mkdir(path.dirname(options.output), { recursive: true });
	await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`);
	console.log(`Wrote ${path.relative(root, options.output)}`);
} finally {
	if (!options.keepTemp) {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function parseArguments(arguments_) {
	const parsed = { output: defaultOutput, keepTemp: false };
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === '--') {
			continue;
		} else if (argument === '--output') {
			parsed.output = path.resolve(root, arguments_[++index]);
		} else if (argument === '--profile') {
			parsed.profiles ??= [];
			parsed.profiles.push(
				...arguments_[++index]
					.split(',')
					.map((profile) => profile.trim())
					.filter(Boolean)
			);
		} else if (argument === '--all-profiles') {
			parsed.allProfiles = true;
		} else if (argument === '--warmups') {
			parsed.warmups = positiveInteger(arguments_[++index], '--warmups');
		} else if (argument === '--samples') {
			parsed.samples = positiveInteger(arguments_[++index], '--samples');
		} else if (argument === '--keep-temp') {
			parsed.keepTemp = true;
		} else {
			throw new Error(`unknown argument: ${argument}`);
		}
	}
	return parsed;
}

function selectProfiles(profiles, options_) {
	if (options_.allProfiles) {
		return profiles;
	}
	const requested = options_.profiles?.length ? options_.profiles : ['flat'];
	const selected = profiles.filter(({ id }) => requested.includes(id));
	const missing = requested.filter((id) => !profiles.some((profile) => profile.id === id));
	if (missing.length > 0) {
		throw new Error(`unknown performance profile(s): ${missing.join(', ')}`);
	}
	return selected;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1) {
		throw new Error(`${name} must be a positive integer`);
	}
	return number;
}

function requireTool(command, arguments_) {
	const result = spawnSync(command, arguments_, { cwd: root, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${command} is required for process measurements; install it before running this command`);
	}
	if (result.status !== 0) {
		throw new Error(`${command} ${arguments_.join(' ')} failed with exit code ${result.status}`);
	}
	return result.stdout.trim();
}

function run(command, arguments_) {
	const result = spawnSync(command, arguments_, { cwd: root, stdio: 'inherit' });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`${command} exited with code ${result.status}`);
	}
}

function runHyperfine(command, name, exportPath, prepare) {
	const arguments_ = [
		'--warmup',
		String(warmups),
		'--runs',
		String(samples),
		'--style',
		'basic',
		'--export-json',
		exportPath
	];
	if (prepare) {
		arguments_.push('--prepare', prepare);
	}
	arguments_.push('--command-name', name, command);
	run('hyperfine', arguments_);
	return JSON.parse(requireFile(exportPath)).results[0];
}

function requireFile(file) {
	return readFileSync(file, 'utf8');
}

function quote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}
