import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, freemem, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { hitTestPoint, Store } from "../packages/core/dist/index.mjs";
import { createRenderer } from "../packages/renderer/dist/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "fixtures/v1/performance/board-10000.inkfinite.json");
const outputFlagIndex = process.argv.indexOf("--output");
const outputPath = outputFlagIndex >= 0 ? resolve(process.cwd(), process.argv[outputFlagIndex + 1]) : null;

function commandVersion(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
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
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
  };
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 }),
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = noop;
  return { canvas, frames };
}

function countVisibleShapes(document, pageId, camera, viewport) {
  const halfWidth = viewport.width / (2 * camera.zoom);
  const halfHeight = viewport.height / (2 * camera.zoom);
  const bounds = {
    left: camera.x - halfWidth,
    right: camera.x + halfWidth,
    top: camera.y - halfHeight,
    bottom: camera.y + halfHeight,
  };
  return document.pages[pageId].shapeIds.filter((id) => {
    const shape = document.shapes[id];
    return shape.x + shape.props.w >= bounds.left
      && shape.x <= bounds.right
      && shape.y + shape.props.h >= bounds.top
      && shape.y <= bounds.bottom;
  }).length;
}

const rssBeforeOpen = process.memoryUsage().rss;
const openSamples = [];
let fixture;
for (let index = 0; index < 5; index++) {
  const opened = duration(() => JSON.parse(readFileSync(fixturePath, "utf8")));
  fixture = opened.value;
  openSamples.push(opened.milliseconds);
}
const rssAfterOpen = process.memoryUsage().rss;
const pageId = fixture.order.pageIds[0];
const camera = { x: 3200, y: 3200, zoom: 1 };
const viewport = { width: 1280, height: 720 };
const state = {
  doc: fixture.doc,
  ui: { currentPageId: pageId, selectionIds: [], toolId: "select" },
  camera,
};

const hitPoints = Array.from({ length: 1_000 }, (_, index) => ({
  x: (index * 97) % 6400,
  y: (index * 193) % 6400,
}));
const hitTestSamples = [];
for (let index = 0; index < 7; index++) {
  hitTestSamples.push(duration(() => {
    for (const point of hitPoints) hitTestPoint(state, point);
  }).milliseconds / hitPoints.length);
}

const { canvas, frames } = createCanvasHarness();
const renderer = createRenderer(canvas, new Store(state), {
  snapProvider: { get: () => ({ snapEnabled: false, gridEnabled: false, gridSize: 25 }) },
});
const frameSamples = [];
for (let index = 0; index < 6; index++) {
  while (frames.length > 0) frames.shift()(performance.now());
  renderer.markDirty();
  const frame = frames.shift();
  frameSamples.push(duration(() => frame(performance.now())).milliseconds);
}
renderer.dispose();

const saveDirectory = mkdtempSync(join(tmpdir(), "inkfinite-v1-baseline-"));
const savePath = join(saveDirectory, "board.inkfinite.json");
const saveSamples = [];
for (let index = 0; index < 5; index++) {
  saveSamples.push(duration(() => writeFileSync(savePath, `${JSON.stringify(fixture, null, 2)}\n`)).milliseconds);
}
rmSync(saveDirectory, { recursive: true });

const cpu = cpus()[0];
const result = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  fixture: {
    path: "fixtures/v1/performance/board-10000.inkfinite.json",
    seed: fixture.fixture.seed,
    documentShapeCount: fixture.doc.pages[pageId].shapeIds.length,
    visibleShapeCount: countVisibleShapes(fixture.doc, pageId, camera, viewport),
    viewport,
    camera,
  },
  hardware: {
    platform: platform(),
    osRelease: release(),
    cpu: cpu?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    cpuSpeedMHz: cpu?.speed ?? null,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtCapture: freemem(),
  },
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    pnpm: commandVersion("pnpm"),
    rustc: commandVersion("rustc"),
    cargo: commandVersion("cargo"),
    typescript: commandVersion(resolve(root, "node_modules/.bin/tsc")),
    vitest: commandVersion(resolve(root, "packages/core/node_modules/.bin/vitest")),
    tauri: commandVersion(resolve(root, "apps/desktop/node_modules/.bin/tauri")),
  },
  measurements: {
    frameTimeMillisecondsMedian: median(frameSamples.slice(1)),
    hitTestTimeMillisecondsMedian: median(hitTestSamples),
    hitTestSampleCount: hitPoints.length,
    memoryRssBeforeOpenBytes: rssBeforeOpen,
    memoryRssAfterOpenBytes: rssAfterOpen,
    memoryRssDeltaBytes: rssAfterOpen - rssBeforeOpen,
    openTimeMillisecondsMedian: median(openSamples),
    saveTimeMillisecondsMedian: median(saveSamples),
  },
  notes: [
    "The v1 renderer traverses every shape on the current page; visibleShapeCount is recorded separately.",
    "Frame timing uses the production Canvas 2D renderer with a no-op context to isolate JavaScript traversal cost.",
    "No performance budget is enforced by V2-01; this file is the comparison point for later architecture gates.",
  ],
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, serialized);
else process.stdout.write(serialized);
