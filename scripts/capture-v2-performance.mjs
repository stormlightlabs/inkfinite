import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const outputFlagIndex = process.argv.indexOf('--output');
const outputPath = outputFlagIndex >= 0 ? resolve(process.cwd(), process.argv[outputFlagIndex + 1]) : null;
const raw = execFileSync(process.execPath, [resolve(root, 'scripts/capture-v1-performance.mjs')], { encoding: 'utf8' });
const baseline = JSON.parse(raw);
const budgets = { frameTimeMillisecondsMedian: 8, hitTestTimeMillisecondsMedian: 1 };
const measurements = baseline.measurements;
const result = {
	...baseline,
	schemaVersion: 2,
	capturedAt: new Date().toISOString(),
	budgets,
	passed: {
		frame: measurements.frameTimeMillisecondsMedian <= budgets.frameTimeMillisecondsMedian,
		hitTest: measurements.hitTestTimeMillisecondsMedian <= budgets.hitTestTimeMillisecondsMedian
	},
	strategy: {
		renderer: 'Canvas 2D with viewport culling, dirty-frame batching, and bounded layout caches',
		hitTesting: 'Reverse draw-order linear scan; no spatial index',
		overlayLayers: 'Single canvas; the measured frame cost does not justify a second durable-scene bitmap'
	},
	notes: [
		'The renderer culls by transformed world bounds with padding for arrowheads, shadows, and selection handles.',
		'Selected overlays render from the full page list so culling cannot clip handles outside the viewport.',
		'The linear hit-test median remains below the 1 ms gate, so V2-11 does not add a spatial index.'
	]
};

if (!result.passed.frame || !result.passed.hitTest) {
	process.exitCode = 1;
}

const serialized = `${JSON.stringify(result, null, '\t')}\n`;
if (outputPath) {
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, serialized);
} else {
	process.stdout.write(serialized);
}
