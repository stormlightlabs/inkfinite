# V2 file format

Inkfinite stores the canonical document as an Automerge file with the
.inkfinite extension. The .inkfinite.json format is used for v1 imports and
stable JSON snapshots; it is not a CRDT round-trip format.

## V1 migration

The file crate validates the v1 envelope, page order, shape ownership, draw
order, bindings, and references before it creates a v2 document.

- board.id becomes the v2 document ID.
- order.pageIds becomes document page order.
- Each page receives one stable default layer named Default.
- A page's shapeOrder is used when present; otherwise its shapeIds are used.
- Shape properties are retained. The v1 w and h properties become v2 width and
  height.
- Contiguous legacy groups become v2 containers with their original group ID.
  Their children retain the legacy draw order.
- Non-contiguous or singleton groups remain flat so the exact draw order is
  preserved, with legacy_group_id retained as compatibility metadata.
- Freehand stroke opacity becomes the v2 stroke opacity value.

Invalid and newer inputs return typed errors before a destination file is
created or replaced.

## Safe writes and recovery

DocumentFile holds an advisory sidecar lock for the canonical path. A save
serializes a compact CRDT snapshot, records a bounded journal of changes since
the last durable snapshot, writes recovery data atomically, and then replaces
the canonical file through a same-directory temporary file after flushing and
syncing it. Recovery data is removed only after the canonical replacement
succeeds.

Recovery combines the saved compact snapshot with its encoded change journal,
validates the resulting document and causal heads, and can then be saved as a
new canonical baseline. The recovery journal is compacted when its configured
entry or byte bound is reached.

## JSON snapshots

The JSON export is deterministic: CRDT heads are sorted and the materialized
model uses ordered maps and lists. It represents one materialized snapshot and
cannot preserve Automerge history, causal heads, or an undo/redo journal.
