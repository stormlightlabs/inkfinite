// @ts-nocheck
import { execFileSync } from 'node:child_process';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Store } from '../../core/dist/index.mjs';
import { createRenderer } from '../../editor/dist/renderer.js';
import { corpus, createEditorState, getProfile } from './performance-corpus.js';

const root = resolve(import.meta.dirname, '../../..');
const outputFlagIndex = process.argv.indexOf('--output');
const outputPath = outputFlagIndex >= 0 ? resolve(process.cwd(), process.argv[outputFlagIndex + 1]) : null;
const profileFlagIndex = process.argv.indexOf('--profile');
const requestedProfile = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : null;
const sizeFlagIndex = process.argv.indexOf('--size');
const requestedSize = sizeFlagIndex >= 0 ? Number(process.argv[sizeFlagIndex + 1]) : null;

function commandVersion(command, args = ['--version']) {
	try {
		return execFileSync(command, args, { encoding: 'utf8' }).trim();
	} catch {
		return 'unavailable';
	}
}

function duration(operation) {
	const start = performance.now();
	operation();
	return performance.now() - start;
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

function createCanvasHarness() {
	const frames = [];
	const noop = () => {};
	const context = {
		canvas: null,
		save: noop,
		restore: noop,
		transform: noop,
		setTransform: noop,
		scale: noop,
		translate: noop,
		rotate: noop,
		clearRect: noop,
		fillRect: noop,
		strokeRect: noop,
		fillText: noop,
		measureText: (text) => ({ width: text.length * 8 }),
		beginPath: noop,
		moveTo: noop,
		lineTo: noop,
		quadraticCurveTo: noop,
		bezierCurveTo: noop,
		arc: noop,
		arcTo: noop,
		ellipse: noop,
		roundRect: noop,
		rect: noop,
		closePath: noop,
		clip: noop,
		fill: noop,
		stroke: noop,
		drawImage: noop,
		setLineDash: noop,
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		font: '',
		textAlign: 'start',
		textBaseline: 'alphabetic',
		globalAlpha: 1
	};
	const canvas = {
		width: corpus.viewport.width,
		height: corpus.viewport.height,
		getContext: () => context,
		getBoundingClientRect: () => ({
			width: corpus.viewport.width,
			height: corpus.viewport.height,
			top: 0,
			left: 0,
			right: corpus.viewport.width,
			bottom: corpus.viewport.height
		})
	};
	context.canvas = canvas;
	globalThis.window = { devicePixelRatio: 1 };
	globalThis.requestAnimationFrame = (callback) => {
		frames.push(callback);
		return frames.length;
	};
	globalThis.cancelAnimationFrame = noop;
	return { canvas, frames };
}

function renderOnce(renderer, frames) {
	renderer.markDirty();
	const frame = frames.shift();
	if (!frame) throw new Error('renderer did not schedule a frame');
	return duration(() => frame(performance.now()));
}

function benchmarkFixture(profileId, shapeCount) {
	const state = createEditorState(profileId, shapeCount);
	const { canvas, frames } = createCanvasHarness();
	const renderer = createRenderer(canvas, new Store(state), {
		snapProvider: { get: () => ({ snapEnabled: false, gridEnabled: false, gridSize: 25 }) }
	});

	// Drain the initial dirty frame before collecting samples.
	if (frames.length > 0) frames.shift()(performance.now());
	for (let index = 0; index < corpus.warmups; index += 1) renderOnce(renderer, frames);
	const samples = [];
	for (let index = 0; index < corpus.samples; index += 1) samples.push(renderOnce(renderer, frames));
	renderer.dispose();

	return {
		profile: profileId,
		shapeCount,
		shapeRecords: Object.keys(state.doc.shapes).length,
		bindingRecords: Object.keys(state.doc.bindings).length,
		warmups: corpus.warmups,
		samples: corpus.samples,
		regressionBudget: { statistic: 'median milliseconds', maximum: median(samples) * 1.2, tolerancePercent: 20 },
		milliseconds: {
			median: median(samples),
			minimum: Math.min(...samples),
			maximum: Math.max(...samples),
			all: samples
		}
	};
}

const profileIds = requestedProfile ? [getProfile(requestedProfile).id] : corpus.profiles.map((profile) => profile.id);
const sizes = requestedSize ? [requestedSize] : corpus.sizes;
for (const size of sizes) {
	if (!Number.isInteger(size) || size <= 0 || !corpus.sizes.includes(size)) {
		throw new Error(`Size must be one of ${corpus.sizes.join(', ')}`);
	}
}

const cpu = cpus()[0];
const startedAt = new Date().toISOString();
const measurements = [];
for (const profileId of profileIds) {
	for (const shapeCount of sizes) measurements.push(benchmarkFixture(profileId, shapeCount));
}

const result = {
	schemaVersion: 2,
	capturedAt: startedAt,
	fixture: {
		path: 'fixtures/native/performance/corpus.json',
		seed: corpus.seed,
		profiles: profileIds,
		sizes,
		viewport: corpus.viewport,
		camera: corpus.camera
	},
	hardware: {
		platform: platform(),
		osRelease: release(),
		cpu: cpu?.model ?? 'unknown',
		logicalCpuCount: cpus().length,
		cpuSpeedMHz: cpu?.speed ?? null,
		totalMemoryBytes: totalmem(),
		freeMemoryBytesAtCapture: freemem()
	},
	runtime: {
		node: process.version,
		v8: process.versions.v8,
		rustc: commandVersion('rustc'),
		cargo: commandVersion('cargo'),
		typescript: commandVersion(resolve(root, 'node_modules/.bin/tsc')),
		playwright: commandVersion(resolve(root, 'node_modules/.bin/playwright'))
	},
	sampling: {
		warmups: corpus.warmups,
		samples: corpus.samples,
		statistic: 'median of post-warmup samples',
		clock: 'node:perf_hooks performance.now()',
		method: 'one scheduled production editor renderer frame per sample'
	},
	scope: {
		renderer: 'packages/editor/src/renderer.ts createRenderer',
		canvas: 'no-op CanvasRenderingContext2D harness',
		measured: ['scene traversal', 'viewport culling', 'geometry dispatch', 'renderer cache work'],
		excluded: [
			'browser rasterization',
			'paint',
			'text shaping',
			'compositing',
			'GPU work',
			'browser GC',
			'real frame timing'
		]
	},
	measurements
};

const serialized = `${JSON.stringify(result, null, '\t')}\n`;
if (outputPath) writeFileSync(outputPath, serialized);
else process.stdout.write(serialized);
