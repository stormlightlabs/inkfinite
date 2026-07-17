import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { ProofDocument } from "../src/proof-document.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../shared/nested-document.json", import.meta.url), "utf8"));
const base = ProofDocument.fromSnapshot(fixture, "fingerprint-base");
const left = base.fork("fingerprint-left");
const right = base.fork("fingerprint-right");
left.setScalar(["shapes", "shape:root", "x"], 123, "left");
right.setScalar(["shapes", "shape:root", "y"], 456, "right");
left.textSplice(["shapes", "shape:child", "content"], 0, 0, "A", "left text");
right.textSplice(
  ["shapes", "shape:child", "content"],
  fixture.shapes["shape:child"].content.length,
  0,
  "B",
  "right text",
);
left.merge(right);

process.stdout.write(createHash("sha256").update(JSON.stringify(left.snapshot())).digest("hex"));
