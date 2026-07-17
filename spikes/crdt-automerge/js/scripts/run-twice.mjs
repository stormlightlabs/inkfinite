import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const options = { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] };
const fingerprints = [];
const benchmarkHashes = [];
for (let run = 0; run < 2; run += 1) {
  execFileSync("cargo", ["test", "--offline", "--manifest-path", "../Cargo.toml"], options);
  execFileSync(process.execPath, ["--test", "test/proof.test.mjs"], options);
  fingerprints.push(execFileSync(process.execPath, ["scripts/fingerprint.mjs"], options));
  benchmarkHashes.push(
    JSON.parse(execFileSync(process.execPath, ["scripts/benchmark.mjs"], options)).fixture.snapshotSha256,
  );
}
assert.equal(fingerprints[0], fingerprints[1], "fixed-seed snapshots differ between runs");
assert.equal(benchmarkHashes[0], benchmarkHashes[1], "benchmark snapshots differ between runs");
console.log(`two proof runs converged to ${fingerprints[0]}`);
