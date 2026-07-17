import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProofDocument, synchronize } from "../src/proof-document.mjs";

const nestedPath = new URL("../../shared/nested-document.json", import.meta.url);
const boardPath = new URL("../../../../fixtures/v1/performance/board-10000.inkfinite.json", import.meta.url);
const rustBinary = new URL("../../target/debug/inkfinite-crdt-proof", import.meta.url).pathname;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("nested maps, ordered lists, and text round-trip in JavaScript", () => {
  const expected = readJson(nestedPath);
  const document = ProofDocument.fromSnapshot(expected, "js-roundtrip");
  const loaded = ProofDocument.load(document.save(), "js-loaded");
  assert.deepEqual(loaded.snapshot(), expected);
});

test("the 10,000-shape v1 document round-trips in JavaScript", () => {
  const expected = readJson(boardPath);
  const document = ProofDocument.fromSnapshot(expected, "js-performance");
  const loaded = ProofDocument.load(document.save(), "js-performance-load");
  assert.deepEqual(loaded.snapshot(), expected);
});

test("offline property, list, text, delete, and reparent changes converge", () => {
  const base = ProofDocument.fromSnapshot(readJson(nestedPath), "js-base");
  const left = base.fork("js-left");
  const right = base.fork("js-right");

  left.setScalar(["shapes", "shape:root", "x"], 100, "left property");
  left.listInsert(["layers", "layer:1", "children"], 1, "shape:left", "left list");
  left.textSplice(["shapes", "shape:child", "content"], 0, 0, "Left ", "left text");
  left.deleteRecord(["bindings", "binding:1"], "left delete");

  right.setScalar(["shapes", "shape:root", "y"], 200, "right property");
  right.listDelete(["shapes", "shape:root", "children"], 0, "right list");
  right.textSplice(
    ["shapes", "shape:child", "content"],
    readJson(nestedPath).shapes["shape:child"].content.length,
    0,
    " Right",
    "right text",
  );
  right.setScalar(["shapes", "shape:child", "parentId"], "layer:1", "right reparent");

  const leftBytes = left.save();
  const rightBytes = right.save();
  const leftFirst = ProofDocument.load(leftBytes, "js-left-first");
  leftFirst.merge(ProofDocument.load(rightBytes, "js-right-copy"));
  const rightFirst = ProofDocument.load(rightBytes, "js-right-first");
  rightFirst.merge(ProofDocument.load(leftBytes, "js-left-copy"));

  assert.notDeepEqual(leftFirst.save(), rightFirst.save());
  assert.deepEqual(leftFirst.snapshot(), rightFirst.snapshot());
});

test("patches, heads, actor-scoped undo, sync, save/load, and compaction are exposed", () => {
  const document = ProofDocument.fromSnapshot(readJson(nestedPath), "js-local");
  const initialHeads = document.heads();
  const { summary, undo } = document.setScalarWithUndo(["shapes", "shape:root", "x"], 55, "move shape");
  assert.ok(summary.patchCount > 0);
  assert.notDeepEqual(summary.heads, initialHeads);
  assert.equal(document.actorId().length, 32);

  const remote = document.fork("js-remote");
  remote.setScalar(["shapes", "shape:root", "y"], 77, "remote move");
  document.merge(remote);
  assert.ok(document.undo(undo));
  assert.equal(document.snapshot().shapes["shape:root"].x, 8);
  assert.equal(document.snapshot().shapes["shape:root"].y, 77);

  const supersededUndo = document.setScalarWithUndo(["shapes", "shape:root", "x"], 55, "second local move").undo;
  const interveningRemote = document.fork("js-intervening-remote");
  interveningRemote.setScalar(["shapes", "shape:root", "x"], 88, "intervening remote move");
  document.merge(interveningRemote);
  assert.equal(document.undo(supersededUndo), null);
  assert.equal(document.snapshot().shapes["shape:root"].x, 88);

  const loaded = ProofDocument.load(document.save(), "js-load");
  assert.deepEqual(loaded.snapshot(), document.snapshot());
  const peer = document.fork("js-peer");
  document.setScalar(["shapes", "shape:root", "y"], 78, "change sent through sync");
  synchronize(document, peer);
  assert.deepEqual(peer.snapshot(), document.snapshot());

  let journalBytes = 0;
  loaded.saveIncremental();
  for (let index = 0; index < 40; index += 1) {
    loaded.setScalar(["shapes", "shape:root", "x"], index, "storage growth");
    journalBytes += loaded.saveIncremental().byteLength;
  }
  assert.ok(loaded.save().byteLength < journalBytes);
});

test("Rust and JavaScript exchange the same compact document", () => {
  const directory = mkdtempSync(join(tmpdir(), "inkfinite-crdt-proof-"));
  try {
    const rustBinaryPath = join(directory, "rust.am");
    const rustJsonPath = join(directory, "rust.json");
    execFileSync(rustBinary, ["import", nestedPath.pathname, rustBinaryPath]);
    const rustInJavaScript = ProofDocument.load(readFileSync(rustBinaryPath), "js-load-rust");
    assert.deepEqual(rustInJavaScript.snapshot(), readJson(nestedPath));

    const javascriptBinaryPath = join(directory, "javascript.am");
    writeFileSync(javascriptBinaryPath, ProofDocument.fromSnapshot(readJson(nestedPath), "js-save-rust").save());
    execFileSync(rustBinary, ["materialize", javascriptBinaryPath, rustJsonPath]);
    assert.deepEqual(readJson(rustJsonPath), readJson(nestedPath));

    const board = readJson(boardPath);
    const rustBoardBinaryPath = join(directory, "rust-board.am");
    execFileSync(rustBinary, ["import", boardPath.pathname, rustBoardBinaryPath]);
    assert.deepEqual(ProofDocument.load(readFileSync(rustBoardBinaryPath), "js-load-rust-board").snapshot(), board);

    const javascriptBoardBinaryPath = join(directory, "javascript-board.am");
    const rustBoardJsonPath = join(directory, "rust-board.json");
    writeFileSync(javascriptBoardBinaryPath, ProofDocument.fromSnapshot(board, "js-save-rust-board").save());
    execFileSync(rustBinary, ["materialize", javascriptBoardBinaryPath, rustBoardJsonPath]);
    assert.deepEqual(readJson(rustBoardJsonPath), board);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
