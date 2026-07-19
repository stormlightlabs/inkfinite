import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { hitTestPoint, Store } from '../packages/core/dist/index.mjs';
import { createRenderer } from '../packages/renderer/dist/index.mjs';

const root = resolve(import.meta.dirname, '..');
const outputFlagIndex = process.argv.indexOf('--output');
const outputPath = outputFlagIndex >= 0 ? resolve(process.cwd(), process.argv[outputFlagIndex + 1]) : null;
const pageId = 'page:performance';
const layerId = 'layer:performance:default';
const shapeCount = 10_000;
const seed = 0x1a2b3c4d;

function commandVersion(command, args = ['--version']) {
	try {
		return execFileSync(command, args, { encoding: 'utf8' }).trim();
	} catch {
		return 'unavailable';
	}
}

function duration(operation) {
	const start = performance.now();
	const value = operation();
	return { value, milliseconds: performance.now() - start };
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

function createNativeFixture() {
	const shapes = {};
	const shapeIds = [];
	for (let index = 0; index < shapeCount; index += 1) {
		const id = `shape:performance:${index.toString().padStart(5, '0')}`;
		shapeIds.push(id);
		const column = index % 100;
		const row = Math.floor(index / 100);
		shapes[id] = {
			id,
			type: 'rect',
			pageId,
			layerId,
			x: column * 64,
			y: row * 64,
			rot: 0,
			opacity: 1,
			props: {
				w: 48 + ((index * 17 + seed) % 17),
				h: 40 + ((index * 29 + seed) % 25),
				fill: index % 2 === 0 ? '#dbeafe' : '#fef3c7',
				stroke: '#334155',
				radius: index % 5
			}
		};
	}

	return {
		fixture: { seed, generator: 'scripts/capture-performance.mjs' },
		doc: {
			pages: { [pageId]: { id: pageId, name: 'Performance board', shapeIds, layerIds: [layerId] } },
			layers: {
				[layerId]: { id: layerId, pageId, name: 'Default', shapeIds, visible: true, locked: false, opacity: 1 }
			},
			shapes,
			bindings: {}
		}
	};
}

function createCanvasHarness() {
	const frames = [];
	const noop = () => {};
	const context = {
		save: noop,
		restore: noop,
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
		arc: noop,
		arcTo: noop,
		ellipse: noop,
		rect: noop,
		closePath: noop,
		fill: noop,
		stroke: noop,
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
		width: 1280,
		height: 720,
		getContext: () => context,
		getBoundingClientRect: () => ({ width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 })
	};
	globalThis.window = { devicePixelRatio: 1 };
	globalThis.requestAnimationFrame = (callback) => {
		frames.push(callback);
		return frames.length;
	};
	globalThis.cancelAnimationFrame = noop;
	return { canvas, frames };
}

function countVisibleShapes(document, currentPageId, camera, viewport) {
	const halfWidth = viewport.width / (2 * camera.zoom);
	const halfHeight = viewport.height / (2 * camera.zoom);
	const bounds = {
		left: camera.x - halfWidth,
		right: camera.x + halfWidth,
		top: camera.y - halfHeight,
		bottom: camera.y + halfHeight
	};
	return document.pages[currentPageId].shapeIds.filter((id) => {
		const shape = document.shapes[id];
		return (
			shape.x + shape.props.w >= bounds.left &&
			shape.x <= bounds.right &&
			shape.y + shape.props.h >= bounds.top &&
			shape.y <= bounds.bottom
		);
	}).length;
}

const nativeFixture = createNativeFixture();
const viewport = { width: 1280, height: 720 };
const camera = { x: 3200, y: 3200, zoom: 1 };
const state = { doc: nativeFixture.doc, ui: { currentPageId: pageId, selectionIds: [], toolId: 'select' }, camera };

const rssBeforeOpen = process.memoryUsage().rss;
const openSamples = [];
for (let index = 0; index < 3; index += 1) {
	const opened = duration(() => structuredClone(nativeFixture));
	openSamples.push(opened.milliseconds);
}
const rssAfterOpen = process.memoryUsage().rss;

const hitPoints = Array.from({ length: 256 }, (_, index) => ({ x: (index * 97) % 6400, y: (index * 193) % 6400 }));
const hitTestSamples = [];
for (let index = 0; index < 3; index += 1) {
	hitTestSamples.push(
		duration(() => {
			for (const point of hitPoints) hitTestPoint(state, point);
		}).milliseconds / hitPoints.length
	);
}

const { canvas, frames } = createCanvasHarness();
const renderer = createRenderer(canvas, new Store(state), {
	snapProvider: { get: () => ({ snapEnabled: false, gridEnabled: false, gridSize: 25 }) }
});
const frameSamples = [];
for (let index = 0; index < 4; index += 1) {
	while (frames.length > 0) frames.shift()(performance.now());
	renderer.markDirty();
	const frame = frames.shift();
	frameSamples.push(duration(() => frame(performance.now())).milliseconds);
}
renderer.dispose();

const saveDirectory = mkdtempSync(join(tmpdir(), 'inkfinite-performance-'));
const savePath = join(saveDirectory, 'board.snapshot.json');
const saveSamples = [];
for (let index = 0; index < 5; index += 1) {
	saveSamples.push(duration(() => writeFileSync(savePath, `${JSON.stringify(nativeFixture)}\n`)).milliseconds);
}
rmSync(saveDirectory, { recursive: true, force: true });

const cpu = cpus()[0];
const result = {
	schemaVersion: 1,
	capturedAt: new Date().toISOString(),
	fixture: {
		path: 'fixtures/native/performance/large-board.json',
		seed,
		documentShapeCount: shapeCount,
		visibleShapeCount: countVisibleShapes(nativeFixture.doc, pageId, camera, viewport),
		viewport,
		camera
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
		vitest: commandVersion(resolve(root, 'packages/core/node_modules/.bin/vitest')),
		tauri: commandVersion(resolve(root, 'apps/desktop/node_modules/.bin/tauri'))
	},
	budgets: { frameTimeMillisecondsMedian: 8, hitTestTimeMillisecondsMedian: 1 },
	passed: { frame: median(frameSamples.slice(1)) <= 8, hitTest: median(hitTestSamples) <= 1 },
	strategy: {
		renderer: 'Canvas 2D with viewport culling, dirty-frame batching, and bounded layout caches',
		hitTesting: 'Reverse draw-order linear scan; no spatial index',
		overlayLayers: 'Single canvas; the measured frame cost does not justify a second durable-scene bitmap'
	},
	measurements: {
		frameTimeMillisecondsMedian: median(frameSamples.slice(1)),
		hitTestTimeMillisecondsMedian: median(hitTestSamples),
		hitTestSampleCount: hitPoints.length,
		memoryRssBeforeOpenBytes: rssBeforeOpen,
		memoryRssAfterOpenBytes: rssAfterOpen,
		memoryRssDeltaBytes: rssAfterOpen - rssBeforeOpen,
		openTimeMillisecondsMedian: median(openSamples),
		saveTimeMillisecondsMedian: median(saveSamples)
	},
	notes: [
		'The native performance fixture is generated deterministically from the native document model.',
		'Timing uses the production Canvas 2D renderer with a no-op context to isolate JavaScript traversal cost.',
		'The budget remains explicit so release verification can fail when either interaction measure regresses.'
	]
};

if (!result.passed.frame || !result.passed.hitTest) process.exitCode = 1;

const serialized = `${JSON.stringify(result, null, '\t')}\n`;
if (outputPath) writeFileSync(outputPath, serialized);
else process.stdout.write(serialized);
