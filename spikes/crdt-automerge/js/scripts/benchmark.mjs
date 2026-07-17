import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, freemem, platform, release, totalmem } from "node:os";
import { isDeepStrictEqual } from "node:util";

import { ProofDocument } from "../src/proof-document.mjs";

const fixtureUrl = new URL("../../../../fixtures/v1/performance/board-10000.inkfinite.json", import.meta.url);
const baselineUrl = new URL("../../../../fixtures/v1/performance/baseline.json", import.meta.url);
const outputUrl = new URL("../../results/benchmark.json", import.meta.url);
const rustBinary = new URL("../../target/debug/inkfinite-crdt-proof", import.meta.url).pathname;
const source = readFileSync(fixtureUrl);
const snapshot = JSON.parse(source);
const baseline = JSON.parse(readFileSync(baselineUrl, "utf8"));

const rssBefore = process.memoryUsage().rss;
const importStarted = performance.now();
const document = ProofDocument.fromSnapshot(snapshot, "js-benchmark");
const importMilliseconds = performance.now() - importStarted;
const rssAfterImport = process.memoryUsage().rss;
const saveStarted = performance.now();
const saved = document.save();
const saveMilliseconds = performance.now() - saveStarted;
const loadStarted = performance.now();
const loaded = ProofDocument.load(saved, "js-benchmark-load");
const loadMilliseconds = performance.now() - loadStarted;
if (!isDeepStrictEqual(loaded.snapshot(), snapshot)) {
  throw new Error("JavaScript benchmark round-trip changed the materialized snapshot");
}

loaded.saveIncremental();
let incrementalJournalBytes = 0;
for (let index = 0; index < 100; index += 1) {
  loaded.setScalar(["doc", "shapes", "shape:perf:00000", "x"], index + 1, "storage growth");
  incrementalJournalBytes += loaded.saveIncremental().byteLength;
}
const compactedAfterChangesBytes = loaded.save().byteLength;

const rust = JSON.parse(execFileSync(rustBinary, ["benchmark", fixtureUrl.pathname], { encoding: "utf8" }));
const fingerprint = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  fixture: {
    path: "fixtures/v1/performance/board-10000.inkfinite.json",
    seed: snapshot.fixture.seed,
    shapeCount: Object.keys(snapshot.doc.shapes).length,
    snapshotSha256: fingerprint,
  },
  hardware: {
    architecture: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    freeMemoryBytesAtCapture: freemem(),
    platform: platform(),
    release: release(),
    totalMemoryBytes: totalmem(),
  },
  dependencies: {
    automergeJavaScript: "3.2.6",
    automergeRust: "0.6.1",
    node: process.version,
    pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
    rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
  },
  javascript: {
    compactedAfter100ChangesBytes: compactedAfterChangesBytes,
    importMilliseconds,
    incrementalJournal100ChangesBytes: incrementalJournalBytes,
    loadMilliseconds,
    memoryRssAfterImportBytes: rssAfterImport,
    memoryRssBeforeBytes: rssBefore,
    memoryRssDeltaBytes: Math.max(0, rssAfterImport - rssBefore),
    saveMilliseconds,
    sourceJsonBytes: source.byteLength,
    storageBytes: saved.byteLength,
  },
  rust,
  v1Comparison: {
    v1OpenMilliseconds: baseline.measurements.openTimeMillisecondsMedian,
    v1SaveMilliseconds: baseline.measurements.saveTimeMillisecondsMedian,
    v1MemoryRssDeltaBytes: baseline.measurements.memoryRssDeltaBytes,
    note: "V1 open/save parse JSON; CRDT import constructs history and is not an equivalent hot-path operation.",
  },
};

const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes("--write")) {
  mkdirSync(new URL("../../results/", import.meta.url), { recursive: true });
  writeFileSync(outputUrl, rendered);
}
process.stdout.write(rendered);
