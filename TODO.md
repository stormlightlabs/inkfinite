# Inkfinite vNext tickets

These tickets implement [ROADMAP.md](ROADMAP.md). Work one ticket per fresh
implementation context. A ticket can start when all of its blockers are done.

## Milestone 1: Architecture gate

Exit when the v1 baseline is reproducible and the CRDT decision has measured
evidence.

### V2-01: Freeze compatibility fixtures and baselines

What to build: Capture representative v1 web and desktop documents, invalid
documents, rendering examples, and a generated 10,000-shape board before the
model changes.

Blocked by: None - can start immediately

Acceptance criteria:

- [x] Fixtures cover every current shape, bindings, groups, pages, Markdown,
      stencils, history-relevant edits, and persisted ordering.
- [x] Import, render, hit-test, open/save, and cursor-after-resize behavior have
      baseline tests; known failures are marked as such rather than normalized.
- [x] The performance harness records hardware, runtime versions, fixture seed,
      visible-shape count, frame time, hit-test time, memory, open, and save time.
- [x] Current package tests, type checks, web checks, lint, and desktop Rust tests
      run from documented commands.

Verification:

```sh
pnpm --filter inkfinite-core test --run
pnpm --filter inkfinite-renderer test --run
pnpm --filter inkfinite-web test
pnpm --filter inkfinite-core typecheck
pnpm --filter inkfinite-renderer typecheck
pnpm --filter inkfinite-web check
pnpm --filter inkfinite-web lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### V2-02: Prove the CRDT boundary

What to build: Implement a disposable Automerge proof through an
Inkfinite-owned interface. Compare Yjs/Yrs only if Automerge misses a gate.

Blocked by: V2-01

Acceptance criteria:

- [x] Rust and JavaScript round-trip the same nested maps, ordered child lists,
      text, and 10,000-shape document without semantic drift.
- [x] Two offline replicas merge concurrent property, list, text, delete, and
      reparent edits and converge byte-independently to the same materialized
      snapshot.
- [x] Incremental patches, change heads, actor IDs, actor-scoped undo, sync,
      save/load, and compaction are demonstrated.
- [x] A merge is applied on a fork and adopted only after deterministic repair
      and validation; duplicate children, missing parents, dangling bindings,
      and zero-layer pages have convergence tests.
- [x] Results compare time, memory, storage growth, API risk, and dependency
      versions with the V2-01 baseline and record the final Automerge or Yjs/Yrs
      decision in `ROADMAP.md`.

Verification:

- Run the proof's Rust, JavaScript, cross-language, convergence, and benchmark
  suites twice with fixed seeds; both runs must materialize identical snapshots.

## Milestone 2: Rust document authority

Exit when Rust can import, edit, merge, validate, persist, and expose the v2
document independently of Tauri and Svelte.

### V2-03: Scaffold the vNext project structure

What to build: Create the target Cargo and pnpm workspace layout as a compileable
shell before moving behavior or defining the v2 model.

Blocked by: V2-02

Acceptance criteria:

- [x] A root Cargo workspace contains the model, CRDT, engine, file, protocol,
      SVG, IPC, and CLI crates named in the roadmap.
- [x] The pnpm workspace contains `editor-runtime`, `renderer-canvas`,
      `input-dom`, and `bindings`; the existing apps and packages keep
      working in place during the scaffold step.
- [x] New crates and packages contain only minimal compileable entry points,
      manifests, and dependency edges. This ticket moves no product behavior.
- [x] Workspace commands can discover, build, test, type-check, and lint the new
      members from the repository root.

Verification:

```sh
cargo metadata --no-deps
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm -r --if-present build
pnpm -r --if-present typecheck
```

### V2-04: Define the Rust document and protocol contracts

What to build: Add typed v2 records, project-owned CRDT traits, and protocol
records without UI, Tauri, transport, or CLI parsing dependencies.

Blocked by: V2-03

Acceptance criteria:

- [x] The model covers pages, layers, scene hierarchy, built-in shape kinds,
      bindings, assets, semantic metadata, provenance, opacity, and format IDs.
- [x] Ordered child lists have one source of truth and public operations use
      sibling anchors rather than numeric indexes.
- [x] CRDT, engine, file, rendering, IPC, and CLI code depend on the contracts in
      one direction; model and protocol crates do not import those consumers.
- [x] `cargo test --workspace` and strict Clippy run from the repository root.

Verification:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

### V2-05: Implement validated CRDT transactions

What to build: Apply every durable operation through one engine transaction and
one CRDT change, returning patches, heads, inverse metadata, affected IDs, and
warnings.

Blocked by: V2-04

Acceptance criteria:

- [x] Operations cover page, layer, shape, hierarchy, binding, asset, and layout
      changes with head and record-version preconditions.
- [x] Schema, precondition, permission, invariant, repair, and final snapshot
      checks run on a fork before an atomic commit.
- [x] Undo and redo emit actor-scoped compensating changes and preserve
      intervening edits from other actors.
- [x] Production `inkfinite-crdt` tests absorb the reusable V2-02 cases for
      nested data, patches, heads, actor IDs, undo, fork repair, convergence,
      transport-independent sync, save/load, compaction, and 10,000 shapes.
      Preserve the measured benchmark result, then remove
      `spikes/crdt-automerge`, its workspace entry, dependency, and root proof
      commands. Keep the V1 compatibility fixtures and baselines.
- [x] Queries support IDs, names, roles, tags, kinds, parents, layers, bounds,
      and affected regions; alignment and distribution use the same engine.
- [x] Property-based tests cover apply/invert, merge order, deterministic repair,
      and convergence.

Verification:

```sh
cargo test -p inkfinite-engine -p inkfinite-crdt
test ! -d spikes/crdt-automerge
```

### V2-06: Generate schemas and TypeScript bindings

What to build: Generate document, transaction, and protocol bindings from Rust
and prove the Rust and TypeScript shape registries agree.

Blocked by: V2-04

Acceptance criteria:

- [x] Schemars emits JSON Schemas and `ts-rs` emits TypeScript bindings from the
      authoritative Rust records.
- [x] Shared fixtures verify kind names, property validation, serialization,
      bounds, transforms, and geometry conventions in Rust and TypeScript.
- [x] A check command fails on stale generated output; generated files carry a
      clear do-not-edit header.
- [x] Schema changes require fixture and migration updates.

Verification:

- `cargo run -p inkfinite-protocol --bin generate-bindings` generates the
  schemas, bindings, and shared fixture. Running it again leaves the generated
  files unchanged.
- `cargo run -p inkfinite-protocol --bin generate-bindings -- --check` fails
  when any generated artifact is stale.
- `cargo test -p inkfinite-model -p inkfinite-protocol` runs the Rust registry
  and shared-fixture conformance tests.
- `pnpm --filter bindings test` typechecks the bindings and runs the
  TypeScript fixture conformance test.

### V2-07: Import v1 and persist v2 safely

What to build: Import `.inkfinite.json`, persist canonical `.inkfinite` CRDT
files, export stable JSON snapshots, and recover from interrupted writes.

Blocked by: V2-04, V2-05

Acceptance criteria:

- [ ] Every V2-01 valid fixture imports with the same page, shape, binding,
      group, style, and draw order; each page gains one default layer.
- [ ] Invalid or newer formats produce typed errors and never overwrite input.
- [ ] Saves use a same-directory temporary file, flush, atomic replacement where
      supported, recovery copies, and advisory locking.
- [ ] Recovery stores a compact snapshot plus bounded change journal and can
      restore after failures at each write step.
- [ ] JSON export is deterministic and documented as a snapshot that cannot
      preserve CRDT history.

Verification:

```sh
cargo test -p inkfinite-file
```

## Milestone 3: Desktop vertical slice

Exit when a desktop gesture commits through Rust, redraws from a returned patch,
survives reopen, and can be undone.

### V2-08: Make Tauri own document sessions

What to build: Replace frontend-owned desktop documents with a Rust session
service and typed Tauri commands.

Blocked by: V2-05, V2-06, V2-07

Acceptance criteria:

- [ ] Sessions track path, CRDT state, materialized snapshot, actor undo/redo,
      dirty state, locks, recovery, and sync state.
- [ ] Create/open/snapshot/commit/undo/redo/save/save-as/query/validate/close
      commands call shared crates and return typed errors and patches.
- [ ] File I/O leaves the frontend and plugin capabilities are reduced to the
      minimum still required.
- [ ] Integration tests cover open, edit, save, reopen, undo, failed validation,
      stale heads, and a simulated write failure.

Verification:

```sh
cargo test -p desktop
pnpm --filter inkfinite-web test
```

### V2-09: Extract the editor runtime and transaction drafts

What to build: Split the large Svelte canvas controller into a framework-neutral
editor runtime and a thin Svelte adapter, with ephemeral gesture previews and
durable transaction drafts.

Blocked by: V2-06, V2-08

Acceptance criteria:

- [ ] Camera, tools, selection, input routing, and gesture previews have no
      Svelte or persistence dependency.
- [ ] Pointer movement stays local; each completed drag, resize, text edit,
      stencil insertion, or shortcut produces one transaction draft.
- [ ] The frontend document mirror changes only through snapshots or commit/sync
      patches from Rust.
- [ ] Existing keyboard, selection, text, Markdown, arrow, pen, grid snap,
      stencil, and history behavior remains covered.
- [ ] One browser integration test performs drag → Rust commit → patch → redraw
      → undo and compares the original document.

Verification:

```sh
pnpm --filter inkfinite-core test --run
pnpm --filter inkfinite-web test
pnpm --filter inkfinite-web check
```

## Milestone 4: Editor structure and scale

Exit when input remains correct through viewport changes and the 10,000-shape
budget passes with measured optimizations.

### V2-10: Fix cursor mapping across viewport changes

What to build: Keep pointer screen/world coordinates and overlays correct after
resize, scrolling, device-pixel-ratio changes, and pointer capture.

Blocked by: V2-09

Acceptance criteria:

- [ ] Coordinate conversion reads current canvas bounds and viewport dimensions
      for each relevant event; no cached rect survives a layout change.
- [ ] Cursor status, hit testing, marquee, handles, text/Markdown overlays, wheel
      zoom, and drag previews agree after resize and scroll.
- [ ] Pointer-up outside the canvas cannot leave a stuck drag or cursor state.
- [ ] Browser tests reproduce the previous offset/stuck failure and pass at two
      DPR values.

Verification:

- Run the focused browser input/canvas tests, then the full web test suite.

### V2-11: Meet the 10,000-shape rendering budget

What to build: Optimize measured rendering and hit testing while retaining a
simple Canvas 2D design.

Blocked by: V2-09, V2-10

Acceptance criteria:

- [ ] Backing dimensions change only when CSS size or DPR changes; rendering is
      scheduled only while dirty and related patches are batched.
- [ ] Shapes outside visible world bounds are culled without clipping selected
      handles, bound arrows, shadows, or rotation extents.
- [ ] Durable scene and ephemeral overlays can redraw independently where the
      benchmark shows a benefit.
- [ ] Text metrics and freehand outlines are cached with bounded invalidation;
      Markdown layout is cached by source, width, and style.
- [ ] The V2-01 10,000-shape harness meets the numeric frame and query budgets
      recorded after V2-02. Add an incrementally maintained spatial index only if
      the linear query path misses its budget, and record the evidence either way.
- [ ] Visual fixtures and hit-test tests show no behavioral regressions.

Verification:

- Run renderer unit/visual tests and the fixed-seed benchmark on the recorded
  reference machine; attach before/after results to the ticket.

## Milestone 5: Layers, styles, and stencils

Exit when imported and new documents expose predictable layer behavior and
opacity without regressing existing stencils.

### V2-12: Ship layers through model, renderer, interaction, and UI

What to build: Add ordered layers with visibility, locking, active-layer state,
opacity, and a complete Svelte panel.

Blocked by: V2-07, V2-09, V2-11

Acceptance criteria:

- [ ] New and imported pages always have a default layer; migration preserves
      exact shape order and is idempotent.
- [ ] Rendering follows page layer order and child order, skips hidden layers,
      and composites layer opacity without leaking canvas state.
- [ ] Hit testing, marquee, selection UI, editing, and agent transactions ignore
      hidden shapes and reject locked-layer changes.
- [ ] New shapes use the active layer. Moving and reordering layers or shapes is
      one undoable transaction and converges under concurrent edits.
- [ ] The panel lists, selects, creates, renames, reorders, hides, locks, deletes,
      and changes opacity with accessible controls.
- [ ] Deleting a non-empty layer requires an explicit move destination or an
      explicit content deletion; the last layer cannot disappear.

Verification:

- Run model/engine, renderer, web component, migration, undo, and two-replica
  layer tests.

### V2-13: Add shape opacity and finish active-layer stencils

What to build: Expose fill/stroke opacity where applicable, complete the curated
built-in stencil set, and make stencil insertion obey active-layer rules.

Blocked by: V2-12

Acceptance criteria:

- [ ] Applicable shapes have validated fill and stroke opacity in `0..=1`, with
      accessible inspector controls and deterministic Canvas output.
- [ ] Existing files default to their current opaque appearance; stroke opacity
      already present on freehand shapes migrates without drift.
- [ ] The built-in library covers the intended flowchart, UI, and developer
      diagram set without adding sharing or community-library infrastructure.
- [ ] Palette click and drag insertion place every stencil shape in the active
      layer, preserve grouping, snap when enabled, select the result, and create
      one undoable transaction.
- [ ] Built-in stencil fixtures pass in visible, hidden, locked, and translucent
      layers.

Verification:

- Run focused model, Canvas renderer, stencil, inspector, migration, and undo
  tests. V2-14 adds the matching headless SVG coverage.

## Milestone 6: CLI and headless rendering

Exit when scripts and agents can inspect, safely change, validate, and render a
closed document without desktop code.

### V2-14: Render deterministic SVG

What to build: Add headless SVG rendering for all built-in shapes, layers,
bindings, transforms, opacity, text, and Markdown.

Blocked by: V2-04, V2-06, V2-13

Acceptance criteria:

- [ ] Output is deterministic for a snapshot and supports page, layer, selection,
      and region filtering.
- [ ] Hidden and locked semantics, ordering, opacity, arrow routing/labels,
      Markdown, text wrapping, and freehand strokes match Canvas fixtures.
- [ ] Missing fonts or assets produce explicit warnings and deterministic
      fallbacks.
- [ ] Snapshot tests cover every built-in shape and a representative full board.

Verification:

```sh
cargo test -p inkfinite-render-svg
```

### V2-15: Ship read-only and schema CLI commands

What to build: Implement `new`, `inspect`, `query`, `validate`, `schema`, and
`capabilities` in file mode with stable human and machine output.

Blocked by: V2-06, V2-07

Acceptance criteria:

- [ ] Commands work while the desktop app is closed and contain no business
      logic outside shared crates.
- [ ] `--json` never prompts, writes only machine data to stdout, sends
      diagnostics to stderr, and returns documented stable exit codes.
- [ ] Inspect/query report document heads and support semantic, hierarchy, layer,
      kind, and bounds filters.
- [ ] Schema and capability output matches generated artifacts and is snapshot
      tested on Unix and Windows path conventions.

Verification:

```sh
cargo test -p inkfinite-cli
```

### V2-16: Ship mutating CLI commands and SVG output

What to build: Add generic apply plus structured shape, connection, layout, and
render commands, all through the transaction engine.

Blocked by: V2-05, V2-14, V2-15

Acceptance criteria:

- [ ] `apply` accepts a transaction from a file or stdin and supports dry-run,
      inspected heads, record preconditions, and deterministic JSON results.
- [ ] `shape create/patch/delete`, `connect`, and `layout` build ordinary
      transactions and honor layers, locks, permissions, and semantic selectors.
- [ ] Failed validation, stale preconditions, file locks, or write errors leave
      the original byte-for-byte unchanged.
- [ ] Results report previous/current heads, transaction ID, created/updated/
      deleted IDs, repairs, and warnings.
- [ ] `render` writes deterministic SVG without opening the desktop app.

Verification:

- Run CLI workflow tests: inspect → dry-run → apply → validate → reopen → render,
  including every failure path.

## Milestone 7: Live control and CRDT sync

Exit when a running desktop app can be inspected and changed safely and two
offline app replicas converge after reconnecting.

### V2-17: Add authenticated local IPC

What to build: Host a versioned local-socket server in Tauri and connect the CLI
for status, inspect, query, and focus.

Blocked by: V2-08, V2-15

Acceptance criteria:

- [ ] Unix-domain sockets and Windows named pipes use per-user names, a protected
      per-install/session token, length-prefix framing, versions, and size limits.
- [ ] The server exposes no TCP/HTTP listener and stops with the Tauri process.
- [ ] Read-only app commands return the same protocol records and query results as
      file mode; focus emits a small frontend notification.
- [ ] Tests reject wrong tokens, oversized/truncated frames, unsupported versions,
      malformed JSON, replayed request IDs, and unavailable app sessions.

Verification:

```sh
cargo test -p inkfinite-ipc -p inkfinite-cli -p desktop
```

### V2-18: Add reviewable agent proposals and explicit apply

What to build: Let the live CLI propose a transaction for ghost-preview review or
apply it only with explicit authorization.

Blocked by: V2-09, V2-16, V2-17

Acceptance criteria:

- [ ] `app propose` validates without committing and previews geometry plus
      created, changed, and deleted IDs in the desktop UI.
- [ ] Reject changes nothing; full accept commits once; partial accept builds a
      new transaction and revalidates it against current heads.
- [ ] Intervening local or remote edits produce a refreshed preview or a clear
      conflict, never a stale silent commit.
- [ ] `app apply` requires explicit authorization conveyed through protocol state,
      not a UI convention, and creates normal history/provenance.
- [ ] Proposal limits, timeout/expiry, permissions, and malformed operations have
      integration and accessibility tests.

Verification:

- Run end-to-end propose/reject/accept/partial/stale/direct-apply flows and compare
  persisted documents after reopen.

### V2-19: Sync two offline replicas

What to build: Wire the selected CRDT sync protocol through a transport-neutral
peer layer and prove desktop-to-desktop convergence.

Blocked by: V2-07, V2-08, V2-17

Acceptance criteria:

- [ ] Two trusted app instances exchange only missing changes, reconnect after
      offline edits, and converge to the same materialized snapshot and heads.
- [ ] Concurrent shape edits, hierarchy moves, layer changes, text edits,
      deletions, and undo trigger the specified merge or deterministic repair.
- [ ] Duplicate, delayed, and retried messages are harmless; corrupt or invalid
      merged state is quarantined without replacing the open valid session.
- [ ] Peer state, actor IDs, compaction, and recovery survive restart without
      resending unbounded history.
- [ ] The transport boundary does not assume hosted accounts, a public relay, or
      durable presence.

Verification:

- Run fixed-seed and property-based two-replica tests with reordered, duplicated,
  delayed, disconnected, restarted, and corrupted message cases.

## Milestone 8: Agent and release readiness

Exit when a clean installation can migrate real v1 documents and complete every
human, CLI, proposal, recovery, and sync acceptance path.

### V2-20: Bundle the Inkfinite agent skill

What to build: Package a concise `SKILL.md` and worked fixtures around the stable
CLI, schemas, and proposal workflow.

Blocked by: V2-16, V2-18

Acceptance criteria:

- [ ] The skill teaches inspect heads → narrow query → minimal transaction →
      dry-run → resolve → apply/propose → validate → render.
- [ ] Rules cover locks, `agent_editable`, semantic selectors, layout operations,
      manual-file-edit prohibition, and explicit authorization for direct apply.
- [ ] CLI help and generated schemas remain the command reference; the skill does
      not duplicate every option.
- [ ] Worked examples create, patch, connect, lay out, propose, partially accept,
      and recover from a head conflict.
- [ ] At least one clean agent run completes each example without UI automation.

Verification:

- Install the packaged skill in a clean test environment and run all examples
  against fixture copies.

### V2-21: Run the vNext release matrix

What to build: Assemble release evidence and close every roadmap success
criterion without adding new architecture.

Blocked by: V2-11, V2-12, V2-13, V2-14, V2-16, V2-18, V2-19, V2-20

Acceptance criteria:

- [ ] All Rust, TypeScript, browser, shared-fixture, generated-artifact, CLI, IPC,
      convergence, migration, recovery, accessibility, and visual tests pass.
- [ ] The recorded 10,000-shape frame, query, memory, open, save, and sync budgets
      pass on reference hardware with results attached.
- [ ] A corpus of real v1 documents imports without data loss; rollback and
      backup restoration are rehearsed.
- [ ] Human review signs off layers, proposal UX, render parity, recovery prompts,
      and permission failures on supported desktop platforms.
- [ ] User-facing migration and file-format documentation is concise and matches
      shipped behavior; deferred work remains listed in `ROADMAP.md`.

Verification:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm --filter inkfinite-core test --run
pnpm --filter inkfinite-renderer test --run
pnpm --filter inkfinite-web test
pnpm --filter inkfinite-core typecheck
pnpm --filter inkfinite-renderer typecheck
pnpm --filter inkfinite-web check
pnpm --filter inkfinite-web lint
```

## Frontier

V2-07 is the current frontier. Work it in a fresh implementation context before
starting tickets that depend on safe v2 import and persistence.
