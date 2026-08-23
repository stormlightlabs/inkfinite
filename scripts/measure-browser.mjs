import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { corpus, createEditorState, getProfile } from './performance-corpus.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const defaultOutput = resolve(root, 'fixtures/native/performance/browser-budget.json');
const defaultTraceDirectory = resolve(root, 'fixtures/native/performance/browser-traces');
const defaultWorkloads = [
	'load',
	'pan',
	'zoom',
	'box-selection',
	'single-drag',
	'multi-drag',
	'vector-edit',
	'connected-drag',
	'nested-selection'
];
const traceCategories = [
	'devtools.timeline',
	'blink.user_timing',
	'disabled-by-default-devtools.timeline.frame',
	'disabled-by-default-devtools.timeline.layers',
	'disabled-by-default-v8.gc',
	'disabled-by-default-cc.debug',
	'disabled-by-default-skia',
	'disabled-by-default-viz.debug'
].join(',');

function argumentValue(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function argumentValues(name) {
	return process.argv.flatMap((argument, index) =>
		argument === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
	);
}

function hasArgument(name) {
	return process.argv.includes(name);
}

function parseInteger(value, name, minimum = 0) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum) {
		throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
	}
	return parsed;
}

function parseOptions() {
	if (hasArgument('--help')) {
		console.log(`Usage: node scripts/measure-browser.mjs [options]

Options:
  --profile ID             Measure one corpus profile (repeatable)
  --all-profiles           Measure all corpus profiles
  --size COUNT             Measure one corpus size (repeatable)
  --all-sizes              Measure all corpus sizes (the default)
  --workload NAME          Measure one workload (repeatable)
  --samples COUNT          Measured samples per workload (default: 5)
  --warmups COUNT          Unrecorded samples per workload (default: 2)
  --output PATH            Browser summary JSON path
  --trace-dir PATH         Gzipped Chrome trace directory
  --no-traces              Do not save diagnostic Chrome traces
  --port PORT              Vite port (default: 4176)
`);
		process.exit(0);
	}

	const requestedProfiles = argumentValues('--profile');
	const profiles = hasArgument('--all-profiles')
		? corpus.profiles.map((profile) => profile.id)
		: requestedProfiles.length > 0
			? requestedProfiles
			: ['flat'];
	const requestedSizes = argumentValues('--size').map((value) => parseInteger(value, '--size', 1));
	const sizes = hasArgument('--all-sizes') || requestedSizes.length === 0 ? corpus.sizes : requestedSizes;
	const requestedWorkloads = argumentValues('--workload').flatMap((value) => value.split(','));
	const workloads = requestedWorkloads.length > 0 ? requestedWorkloads : defaultWorkloads;

	for (const profile of profiles) getProfile(profile);
	for (const size of sizes) {
		if (!corpus.sizes.includes(size)) {
			throw new Error(`Size must be one of ${corpus.sizes.join(', ')}.`);
		}
	}
	for (const workload of workloads) {
		if (!defaultWorkloads.includes(workload)) {
			throw new Error(`Workload must be one of ${defaultWorkloads.join(', ')}.`);
		}
	}

	return {
		profiles,
		sizes,
		workloads,
		samples: parseInteger(argumentValue('--samples') ?? 5, '--samples', 1),
		warmups: parseInteger(argumentValue('--warmups') ?? 2, '--warmups', 0),
		output: resolve(process.cwd(), argumentValue('--output') ?? defaultOutput),
		traceDirectory: resolve(process.cwd(), argumentValue('--trace-dir') ?? defaultTraceDirectory),
		traces: !hasArgument('--no-traces'),
		port: parseInteger(argumentValue('--port') ?? 4176, '--port', 1)
	};
}

function commandVersion(command, args = ['--version']) {
	try {
		return execFileSync(command, args, { encoding: 'utf8' }).trim();
	} catch {
		return 'unavailable';
	}
}

function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, percentileValue) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
	return sorted[Math.max(0, index)];
}

function safeName(value) {
	return value
		.replace(/[^a-z0-9]+/gi, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();
}

function startWebServer(port) {
	const server = spawn(
		'pnpm',
		['--filter', '@inkfinite/web', 'dev:plain', '--host', '127.0.0.1', '--port', String(port)],
		{ cwd: root, stdio: 'ignore', env: { ...process.env, BROWSER: 'none' } }
	);
	return server;
}

async function waitForServer(port, server) {
	const origin = `http://127.0.0.1:${port}`;
	const url = `${origin}/app`;
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (server.exitCode !== null) throw new Error(`The web server exited with code ${server.exitCode}.`);
		try {
			const response = await fetch(url);
			if (response.ok) return origin;
		} catch {
			// Vite is still starting.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
	}
	throw new Error(`Timed out waiting for the web server at ${url}.`);
}

function stopWebServer(server) {
	if (server.exitCode !== null) return;
	server.kill('SIGTERM');
	setTimeout(() => {
		if (server.exitCode === null) server.kill('SIGKILL');
	}, 2_000).unref();
}

function createFixtureDocuments(profileId, shapeCount, copies = 1) {
	const base = createEditorState(profileId, shapeCount).doc;
	return Array.from({ length: copies }, (_, index) => ({
		boardId: `board:browser-performance:${profileId}:${shapeCount}:${index}`,
		name: `Browser ${profileId} ${shapeCount} ${index + 1}`,
		doc: base,
		updatedAt: 1_000_000 - index
	}));
}

async function seedDatabase(page, documents) {
	await page.evaluate(async (records) => {
		const database = await new Promise((resolvePromise, reject) => {
			const request = indexedDB.open('inkfinite');
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains('boards'))
					database.createObjectStore('boards', { keyPath: 'id' });
				if (!database.objectStoreNames.contains('pages')) {
					const store = database.createObjectStore('pages', { keyPath: ['boardId', 'id'] });
					store.createIndex('boardId', 'boardId');
				}
				if (!database.objectStoreNames.contains('shapes')) {
					const store = database.createObjectStore('shapes', { keyPath: ['boardId', 'id'] });
					store.createIndex('boardId', 'boardId');
					store.createIndex('type', 'type');
				}
				if (!database.objectStoreNames.contains('bindings')) {
					const store = database.createObjectStore('bindings', { keyPath: ['boardId', 'id'] });
					store.createIndex('boardId', 'boardId');
					store.createIndex('type', 'type');
				}
				if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
				if (!database.objectStoreNames.contains('canonical')) {
					const store = database.createObjectStore('canonical', { keyPath: 'boardId' });
					store.createIndex('updatedAt', 'updatedAt');
				}
			};
			request.onsuccess = () => resolvePromise(request.result);
			request.onerror = () => reject(request.error);
		});

		await new Promise((resolvePromise, reject) => {
			const transaction = database.transaction(
				['boards', 'pages', 'shapes', 'bindings', 'meta', 'canonical'],
				'readwrite'
			);
			for (const name of ['boards', 'pages', 'shapes', 'bindings', 'meta', 'canonical'])
				transaction.objectStore(name).clear();

			for (const record of records) {
				const { boardId, name, doc, updatedAt } = record;
				transaction
					.objectStore('boards')
					.put({
						id: boardId,
						name,
						createdAt: updatedAt,
						updatedAt,
						storage: { kind: 'browser', label: 'This browser', location: 'IndexedDB' }
					});
				for (const page of Object.values(doc.pages))
					transaction.objectStore('pages').put({ ...page, boardId, updatedAt });
				for (const shape of Object.values(doc.shapes))
					transaction.objectStore('shapes').put({ ...shape, boardId, updatedAt });
				for (const binding of Object.values(doc.bindings))
					transaction.objectStore('bindings').put({ ...binding, boardId, updatedAt });

				const pageIds = Object.keys(doc.pages);
				transaction.objectStore('meta').put({ key: `page-order:${boardId}`, value: pageIds });
				transaction
					.objectStore('meta')
					.put({
						key: `shape-order:${boardId}`,
						value: Object.fromEntries(Object.values(doc.pages).map((page) => [page.id, [...page.shapeIds]]))
					});
				transaction.objectStore('meta').put({ key: `layers:${boardId}`, value: doc.layers });
			}

			transaction.oncomplete = () => resolvePromise();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB seed aborted.'));
		});
		database.close();
	}, documents);
}

async function prepareFixture(page, baseUrl, documents) {
	await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
	await seedDatabase(page, documents);
}

async function waitForEditor(page) {
	await page.locator('canvas[aria-label="Infinite canvas"]').waitFor({ state: 'visible', timeout: 60_000 });
	await page.getByRole('button', { name: 'Shapes', exact: true }).waitFor({ state: 'visible' });
	await page.waitForFunction(() =>
		performance
			.getEntriesByType('measure')
			.some((entry) => /^inkfinite:wasm:(create_document|open_document):/.test(entry.name))
	);
	await page.evaluate(() => document.fonts.ready);
	await settleFrames(page, 4);
}

async function openFixture(page, baseUrl, documents) {
	await prepareFixture(page, baseUrl, documents);
	await page.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
	await waitForEditor(page);
}

async function settleFrames(page, count = 2) {
	await page.evaluate(
		(frameCount) =>
			new Promise((resolvePromise) => {
				let remaining = frameCount;
				const next = () => {
					remaining -= 1;
					if (remaining <= 0) resolvePromise();
					else requestAnimationFrame(next);
				};
				requestAnimationFrame(next);
			}),
		count
	);
}

async function beginTrace(cdp) {
	const tracingComplete = new Promise((resolvePromise) => {
		cdp.once('Tracing.tracingComplete', resolvePromise);
	});
	await cdp.send('Tracing.start', {
		categories: traceCategories,
		options: 'record-as-much-as-possible',
		transferMode: 'ReturnAsStream'
	});
	return async () => {
		await cdp.send('Tracing.end');
		const { stream } = await tracingComplete;
		let contents = '';
		while (true) {
			const chunk = await cdp.send('IO.read', { handle: stream });
			contents += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
			if (chunk.eof) break;
		}
		await cdp.send('IO.close', { handle: stream });
		return JSON.parse(contents);
	};
}

function traceDuration(event) {
	return typeof event.dur === 'number' ? event.dur / 1_000 : 0;
}

function asyncTraceDurations(events, names) {
	const starts = new Map();
	const durations = [];
	for (const event of events) {
		if (!names.includes(event.name) || (event.ph !== 'b' && event.ph !== 'e')) continue;
		const key = `${event.name}:${event.pid ?? ''}:${event.tid ?? ''}:${event.id ?? ''}`;
		if (event.ph === 'b') {
			const stack = starts.get(key) ?? [];
			stack.push(event.ts);
			starts.set(key, stack);
			continue;
		}
		const stack = starts.get(key);
		const start = stack?.pop();
		if (typeof start === 'number' && typeof event.ts === 'number') {
			durations.push((event.ts - start) / 1_000);
		}
	}
	return durations.filter((duration) => duration > 0);
}

function summarizeTrace(trace) {
	const events = trace?.traceEvents ?? [];
	const durationGroups = {
		frames: [
			'BeginFrame',
			'DrawFrame',
			'BeginMainFrame',
			'BeginMainThreadFrame',
			'PipelineReporter',
			'ThreadControllerImpl::BeginMainFrame'
		],
		paint: ['Paint', 'PaintImage', 'PrePaint'],
		raster: ['RasterTask', 'TileManager::RasterTask', 'RasterBufferImpl::Playback'],
		compositor: [
			'CompositeLayers',
			'LayerTreeHostImpl::DrawLayers',
			'Commit',
			'Activation',
			'DrawFrame',
			'SubmitCompositorFrameToPresentationCompositorFrame'
		],
		layout: ['Layout', 'UpdateLayoutTree', 'UpdateLayerTree']
	};
	const durations = Object.fromEntries(
		Object.entries(durationGroups).map(([group, names]) => {
			const matching = events.filter((event) => names.includes(event.name));
			const values = [
				...matching
					.filter((event) => event.ph === 'X')
					.map(traceDuration)
					.filter((value) => value > 0),
				...asyncTraceDurations(
					events,
					names.filter(
						(name) =>
							name !== 'PipelineReporter' && name !== 'SubmitCompositorFrameToPresentationCompositorFrame'
					)
				)
			];
			return [
				group,
				{
					count: matching.length,
					eventCount: matching.length,
					timedEventCount: values.length,
					instantEventCount: matching.filter((event) => event.ph === 'I').length,
					medianMs: median(values),
					p95Ms: percentile(values, 95),
					maximumMs: values.length > 0 ? Math.max(...values) : null,
					totalMs: values.reduce((total, value) => total + value, 0)
				}
			];
		})
	);
	const longTasks = events
		.filter((event) => event.ph === 'X' && (event.name === 'RunTask' || event.name === 'Task'))
		.map(traceDuration)
		.filter((value) => value >= 50);
	const knownEvents = new Set([
		...Object.values(durationGroups).flat(),
		'RunTask',
		'V8.GCScavenger',
		'V8.GCCompactor',
		'MajorGC',
		'MinorGC'
	]);
	const gcEvents = events
		.filter((event) => event.ph === 'X' && /gc/i.test(event.name))
		.map((event) => ({ name: event.name, durationMs: traceDuration(event) }));
	return {
		eventCount: events.length,
		frameAndPaint: durations,
		longTaskCount: longTasks.length,
		longTaskTotalMs: longTasks.reduce((total, value) => total + value, 0),
		gcCount: gcEvents.length,
		gcTotalMs: gcEvents.reduce((total, event) => total + event.durationMs, 0),
		unclassifiedEventCount: events.filter((event) => event.ph === 'X' && !knownEvents.has(event.name)).length
	};
}

async function readMetrics(cdp) {
	const response = await cdp.send('Performance.getMetrics');
	return Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
}

function metricDelta(before, after) {
	const names = new Set([...Object.keys(before), ...Object.keys(after)]);
	return Object.fromEntries(
		[...names]
			.filter((name) => typeof after[name] === 'number' && typeof before[name] === 'number')
			.map((name) => [name, after[name] - before[name]])
	);
}

async function readMemory(cdp) {
	try {
		await cdp.send('HeapProfiler.collectGarbage');
	} catch {
		// Garbage collection is not available in every Chrome channel.
	}
	const heap = await cdp.send('Runtime.getHeapUsage');
	const metrics = await readMetrics(cdp);
	let rendererResidentSetSize = null;
	try {
		const processInfo = await cdp.send('SystemInfo.getProcessInfo');
		const renderers = processInfo.processInfo.filter((processInfoEntry) => processInfoEntry.type === 'renderer');
		if (renderers.length > 0) {
			rendererResidentSetSize = Math.max(
				...renderers.map((processInfoEntry) => processInfoEntry.residentSetSize ?? 0)
			);
		}
	} catch {
		// SystemInfo is not exposed by every Chrome channel.
	}
	return {
		jsHeapUsedBytes: heap.usedSize,
		jsHeapTotalBytes: heap.totalSize,
		performanceJsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
		rendererResidentSetSizeBytes: rendererResidentSetSize
	};
}

async function readPerformanceEntries(page, startTime, benchmarkName) {
	return page.evaluate(
		({ start, name }) => {
			const measures = performance
				.getEntriesByType('measure')
				.filter((entry) => entry.name.startsWith('inkfinite:'))
				.map((entry) => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration }));
			const observerEntries = globalThis.__inkfiniteBrowserPerformance ?? { longTasks: [], gc: [] };
			return {
				benchmark: measures.find((entry) => entry.name === name) ?? null,
				wasm: measures.filter((entry) => entry.name.startsWith('inkfinite:wasm:') && entry.startTime >= start),
				projection: measures.filter(
					(entry) => entry.name.startsWith('inkfinite:editor:') && entry.startTime >= start
				),
				longTasks: observerEntries.longTasks.filter((entry) => entry.startTime >= start),
				gc: observerEntries.gc.filter((entry) => entry.startTime >= start)
			};
		},
		{ start: startTime, name: benchmarkName }
	);
}

async function markStart(page, name) {
	return page.evaluate((markName) => {
		performance.mark(`${markName}:start`);
		return performance.now();
	}, name);
}

async function markEnd(page, name) {
	return page.evaluate((markName) => {
		const startMark = `${markName}:start`;
		const endMark = `${markName}:end`;
		performance.mark(endMark);
		performance.measure(markName, { start: startMark, end: endMark });
		return performance.now();
	}, name);
}

async function measureAction(page, cdp, label, action, options) {
	const benchmarkName = `inkfinite:benchmark:${safeName(label)}:${options.sequence}`;
	const wasmMeasureCount = options.expectedWasmOperations
		? await page.evaluate(
				() =>
					performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('inkfinite:wasm:'))
						.length
			)
		: 0;
	const stopTrace = options.trace ? await beginTrace(cdp) : null;
	const before = await readMetrics(cdp);
	const startTime = await markStart(page, benchmarkName);
	let trace = null;
	try {
		await action();
		await settleFrames(page, 4);
		if (options.expectedWasmOperations) {
			await page.waitForFunction(
				({ count, expected }) =>
					performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('inkfinite:wasm:'))
						.length >=
					count + expected,
				{ count: wasmMeasureCount, expected: options.expectedWasmOperations },
				{ timeout: 60_000 }
			);
		}
	} finally {
		await markEnd(page, benchmarkName);
		if (stopTrace) trace = await stopTrace();
	}
	const after = await readMetrics(cdp);
	const performanceEntries = await readPerformanceEntries(page, startTime, benchmarkName);
	return {
		wallClockMs: performanceEntries.benchmark?.duration ?? null,
		metrics: metricDelta(before, after),
		performance: performanceEntries,
		trace: trace ? summarizeTrace(trace) : null,
		rawTrace: trace
	};
}

async function measureNavigation(page, cdp, baseUrl, options) {
	const benchmarkName = `inkfinite:benchmark:load:${options.sequence}`;
	const before = await readMetrics(cdp);
	const stopTrace = options.trace ? await beginTrace(cdp) : null;
	let trace = null;
	const wallStart = Date.now();
	try {
		await page.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
		await waitForEditor(page);
		await page.evaluate((name) => {
			performance.mark(`${name}:end`);
			performance.measure(name, { start: 'inkfinite:browser:navigation-start', end: `${name}:end` });
		}, benchmarkName);
	} finally {
		if (stopTrace) trace = await stopTrace();
	}
	const after = await readMetrics(cdp);
	const performanceEntries = await readPerformanceEntries(page, 0, benchmarkName);
	return {
		wallClockMs: Date.now() - wallStart,
		metrics: metricDelta(before, after),
		performance: performanceEntries,
		trace: trace ? summarizeTrace(trace) : null,
		rawTrace: trace
	};
}

async function canvasPoints(page) {
	const box = await page.locator('canvas[aria-label="Infinite canvas"]').boundingBox();
	if (!box) throw new Error('The editor canvas has no layout box.');
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	return {
		center,
		shape: { x: center.x + 18, y: center.y + 14 },
		secondShape: { x: center.x + 98, y: center.y + 14 },
		pathAnchor: center,
		canvas: box
	};
}

async function drag(page, from, to, steps = 16) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps });
	await page.mouse.up();
}

async function runWorkload(page, profileId, workload) {
	const points = await canvasPoints(page);
	switch (workload) {
		case 'pan':
			await page.keyboard.down('Space');
			await drag(
				page,
				{ x: points.center.x + 260, y: points.center.y + 160 },
				{ x: points.center.x + 120, y: points.center.y + 80 }
			);
			await page.keyboard.up('Space');
			return;
		case 'zoom':
			await page.mouse.move(points.center.x, points.center.y);
			for (let index = 0; index < 8; index += 1) await page.mouse.wheel(0, -80);
			return;
		case 'box-selection':
			await page.getByRole('button', { name: 'Select', exact: true }).click();
			await drag(
				page,
				{ x: points.center.x - 360, y: points.center.y - 220 },
				{ x: points.center.x + 360, y: points.center.y + 220 }
			);
			return;
		case 'single-drag':
			await page.getByRole('button', { name: 'Select', exact: true }).click();
			await page.mouse.click(points.shape.x, points.shape.y);
			await drag(page, points.shape, { x: points.shape.x + 80, y: points.shape.y + 40 });
			return;
		case 'multi-drag':
			await page.getByRole('button', { name: 'Select', exact: true }).click();
			await page.mouse.click(points.shape.x, points.shape.y);
			await page.keyboard.down('Shift');
			await page.mouse.click(points.secondShape.x, points.secondShape.y);
			await page.keyboard.up('Shift');
			await drag(page, points.shape, { x: points.shape.x + 80, y: points.shape.y + 40 });
			return;
		case 'vector-edit':
			if (!['vector-heavy', 'imported-svg'].includes(profileId)) return;
			await page.getByRole('button', { name: 'Direct Select', exact: true }).click();
			await drag(page, points.pathAnchor, { x: points.pathAnchor.x + 24, y: points.pathAnchor.y + 16 });
			return;
		case 'connected-drag':
			if (profileId !== 'connection-heavy') return;
			await page.getByRole('button', { name: 'Select', exact: true }).click();
			await page.mouse.click(points.shape.x, points.shape.y);
			await drag(page, points.shape, { x: points.shape.x + 80, y: points.shape.y + 40 });
			return;
		case 'nested-selection':
			if (profileId !== 'deeply-nested') return;
			await page.getByRole('button', { name: 'Select', exact: true }).click();
			await page.mouse.dblclick(points.center.x + 36, points.center.y + 28, { delay: 20 });
			await page.mouse.click(points.center.x + 112, points.center.y + 28);
			return;
		case 'load':
			throw new Error('The load workload is measured by navigation.');
	}
}

function workloadRequirement(profileId, workload) {
	if (workload === 'vector-edit' && !['vector-heavy', 'imported-svg'].includes(profileId))
		return 'native path profile';
	if (workload === 'connected-drag' && profileId !== 'connection-heavy') return 'connection-heavy profile';
	if (workload === 'nested-selection' && profileId !== 'deeply-nested') return 'deeply-nested profile';
	return null;
}

function summarizeSamples(samples) {
	const durations = samples.map((sample) => sample.wallClockMs).filter((value) => typeof value === 'number');
	return {
		count: samples.length,
		medianMs: median(durations),
		p95Ms: percentile(durations, 95),
		minimumMs: durations.length > 0 ? Math.min(...durations) : null,
		maximumMs: durations.length > 0 ? Math.max(...durations) : null,
		metrics: {
			median: Object.fromEntries(
				Object.keys(samples[0]?.metrics ?? {}).map((name) => [
					name,
					median(samples.map((sample) => sample.metrics[name]).filter((value) => typeof value === 'number'))
				])
			)
		}
	};
}

function removeRawTrace(sample) {
	const { rawTrace: _rawTrace, ...compact } = sample;
	return compact;
}

async function saveTrace(traceDirectory, fixture, workload, sampleIndex, trace) {
	if (!trace) return null;
	mkdirSync(traceDirectory, { recursive: true });
	const filename = `${safeName(fixture.profile)}-${fixture.size}-${safeName(workload)}-${sampleIndex + 1}.json.gz`;
	const path = resolve(traceDirectory, filename);
	writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(trace))));
	return path;
}

async function measureFixture(page, cdp, baseUrl, fixture, options, sequenceState) {
	const documents = createFixtureDocuments(fixture.profile, fixture.size);
	const measurements = [];
	for (const workload of options.workloads) {
		const requirement = workloadRequirement(fixture.profile, workload);
		if (requirement) {
			measurements.push({ ...fixture, workload, status: 'skipped', reason: `Requires the ${requirement}.` });
			continue;
		}

		const samples = [];
		for (let warmup = 0; warmup < options.warmups; warmup += 1) {
			if (workload === 'load') {
				await prepareFixture(page, baseUrl, documents);
				await measureNavigation(page, cdp, baseUrl, { trace: false, sequence: sequenceState.value++ });
			} else {
				await openFixture(page, baseUrl, documents);
				await runWorkload(page, fixture.profile, workload);
				await settleFrames(page, 2);
			}
		}
		for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
			let sample;
			if (workload === 'load') {
				await prepareFixture(page, baseUrl, documents);
				sample = await measureNavigation(page, cdp, baseUrl, {
					trace: options.traces,
					sequence: sequenceState.value++
				});
			} else {
				await openFixture(page, baseUrl, documents);
				sample = await measureAction(
					page,
					cdp,
					`${fixture.profile}-${fixture.size}-${workload}`,
					() => runWorkload(page, fixture.profile, workload),
					{
						trace: options.traces,
						sequence: sequenceState.value++,
						expectedWasmOperations: ['single-drag', 'multi-drag', 'vector-edit', 'connected-drag'].includes(
							workload
						)
							? 2
							: 0
					}
				);
			}
			const tracePath = await saveTrace(options.traceDirectory, fixture, workload, sampleIndex, sample.rawTrace);
			samples.push({ ...removeRawTrace(sample), tracePath });
		}
		measurements.push({
			...fixture,
			workload,
			status: 'measured',
			sampling: { warmups: options.warmups, samples: options.samples },
			summary: summarizeSamples(samples),
			samples
		});
	}
	return measurements;
}

function addMemoryDelta(memory, baseline) {
	return {
		...memory,
		deltaFromBaseline: Object.fromEntries(
			Object.entries(memory)
				.filter(
					([name, value]) =>
						name.endsWith('Bytes') && typeof value === 'number' && typeof baseline[name] === 'number'
				)
				.map(([name, value]) => [name, value - baseline[name]])
		)
	};
}

async function measureMemory(page, cdp, baseUrl, fixture, options, sequenceState) {
	const documents = createFixtureDocuments(fixture.profile, fixture.size, 2);
	await prepareFixture(page, baseUrl, documents);
	const baseline = await readMemory(cdp);
	await measureNavigation(page, cdp, baseUrl, { trace: false, sequence: sequenceState.value++ });
	const afterLoad = await readMemory(cdp);
	const sustainedEditing = await measureAction(
		page,
		cdp,
		`${fixture.profile}-${fixture.size}-sustained-editing`,
		async () => {
			const points = await canvasPoints(page);
			for (let index = 0; index < 20; index += 1) {
				const offset = index % 2 === 0 ? 0 : 80;
				const start = { x: points.shape.x + offset, y: points.shape.y };
				await page.getByRole('button', { name: 'Select', exact: true }).click();
				await page.mouse.click(start.x, start.y);
				await drag(page, start, { x: start.x + (offset === 0 ? 80 : -80), y: start.y + 40 });
			}
		},
		{ trace: false, sequence: sequenceState.value++, expectedWasmOperations: 40 }
	);
	const afterSustainedEditing = await readMemory(cdp);

	const browser = page.getByRole('dialog', { name: 'Boards' });
	await page.getByRole('button', { name: 'Browse boards' }).click();
	await browser.waitFor({ state: 'visible' });
	const rows = browser.locator('[data-board-row]');
	const wasmMeasureCount = await page.evaluate(
		() => performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('inkfinite:wasm:')).length
	);
	await rows
		.nth(1)
		.getByRole('button', { name: /^Open / })
		.click();
	await browser.waitFor({ state: 'hidden' });
	await page.waitForFunction(
		(count) =>
			performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('inkfinite:wasm:')).length >
			count,
		wasmMeasureCount,
		{ timeout: 60_000 }
	);
	await settleFrames(page, 5);
	const afterReplacement = await readMemory(cdp);

	return {
		...fixture,
		baseline,
		afterLoad: addMemoryDelta(afterLoad, baseline),
		afterSustainedEditing: addMemoryDelta(afterSustainedEditing, baseline),
		afterReplacement: addMemoryDelta(afterReplacement, baseline),
		sustainedEditingMs: sustainedEditing.wallClockMs
	};
}

async function main() {
	const options = parseOptions();
	const server = startWebServer(options.port);
	let browser;
	try {
		const baseUrl = await waitForServer(options.port, server);
		browser = await chromium.launch({ channel: 'chrome', headless: true });
		const context = await browser.newContext({
			viewport: corpus.viewport,
			deviceScaleFactor: 1,
			colorScheme: 'light'
		});
		await context.addInitScript(() => {
			globalThis.__inkfiniteBrowserPerformance = { longTasks: [], gc: [] };
			for (const type of ['longtask', 'gc']) {
				try {
					new PerformanceObserver((list) => {
						const target =
							type === 'gc'
								? globalThis.__inkfiniteBrowserPerformance.gc
								: globalThis.__inkfiniteBrowserPerformance.longTasks;
						for (const entry of list.getEntries())
							target.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration });
					}).observe({ type, buffered: true });
				} catch {
					// The entry type is optional in Chrome.
				}
			}
			performance.mark('inkfinite:browser:navigation-start');
		});
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Performance.enable');
		await cdp.send('Runtime.enable');
		await cdp.send('HeapProfiler.enable');
		const sequenceState = { value: 0 };
		const measurements = [];
		const memory = [];

		for (const profile of options.profiles) {
			for (const size of options.sizes) {
				const fixture = { profile, size };
				console.error(`browser ${profile}/${size}`);
				measurements.push(...(await measureFixture(page, cdp, baseUrl, fixture, options, sequenceState)));
				memory.push(await measureMemory(page, cdp, baseUrl, fixture, options, sequenceState));
			}
		}

		const cpu = cpus()[0];
		const result = {
			schemaVersion: 1,
			capturedAt: new Date().toISOString(),
			fixture: {
				path: 'fixtures/native/performance/corpus.json',
				seed: corpus.seed,
				profiles: options.profiles,
				sizes: options.sizes,
				viewport: corpus.viewport,
				camera: corpus.camera
			},
			hardware: {
				platform: platform(),
				osRelease: release(),
				cpu: cpu?.model ?? 'unknown',
				logicalCpuCount: cpus().length,
				totalMemoryBytes: totalmem(),
				freeMemoryBytesAtCapture: freemem()
			},
			runtime: {
				node: process.version,
				chrome: commandVersion('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
				playwright: commandVersion(resolve(root, 'apps/web/node_modules/.bin/playwright'))
			},
			sampling: {
				warmups: options.warmups,
				samples: options.samples,
				statistic: 'median of post-warmup browser samples',
				clock: 'browser performance.now() marks',
				traces: options.traces ? 'Chrome DevTools Protocol tracing for measured samples' : 'disabled'
			},
			scope: {
				browser: 'Chrome channel with deviceScaleFactor 1',
				workloads: options.workloads,
				measured: [
					'load',
					'pan',
					'zoom',
					'box selection',
					'single-object drag',
					'multi-object drag',
					'vector editing',
					'connected-shape movement',
					'nested selection',
					'Chrome frames, paint, raster, compositor, long tasks, GC, and memory',
					'JS-to-WASM requests and editor projection/store marks'
				],
				excluded: ['full Playwright tracing', 'network timing after the editor is ready']
			},
			measurements,
			memory
		};
		mkdirSync(resolve(options.output, '..'), { recursive: true });
		writeFileSync(options.output, `${JSON.stringify(result, null, '\t')}\n`);
		await cdp.detach();
		await context.close();
	} finally {
		await browser?.close();
		stopWebServer(server);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
});
