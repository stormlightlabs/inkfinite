# Inkfinite vNext tickets

These tickets implement [ROADMAP.md](ROADMAP.md).

## Milestone 1: Architecture gate

Exit when the v1 baseline is reproducible and the CRDT decision has measured
evidence.

### V2-01: Freeze compatibility fixtures and baselines

Captured representative v1 web and desktop documents, invalid documents, rendering
examples, and a generated 10,000-shape board before the model changes.

### V2-02: Prove the CRDT boundary

Implemented a disposable Automerge proof through an
Inkfinite-owned interface. Compare Yjs/Yrs only if Automerge misses a gate.

## Milestone 2: Rust document authority

Exit when Rust can import, edit, merge, validate, persist, and expose the v2
document independently of Tauri and Svelte.

### V2-03: Scaffold the vNext project structure

Created the target Cargo and pnpm workspace layout as a compileable shell
before moving behavior or defining the v2 model.

### V2-04: Define the Rust document and protocol contracts

Added typed v2 records, project-owned CRDT traits, and protocol records without UI,
Tauri, transport, or CLI parsing dependencies.

### V2-05: Implement validated CRDT transactions

Applies every durable operation through one engine transaction and
one CRDT change, returning patches, heads, inverse metadata, affected IDs, and
warnings.

### V2-06: Generate schemas and TypeScript bindings

Generates document, transaction, and protocol bindings from Rust and prove the Rust and
TypeScript shape registries agree.

### V2-07: Import v1 and persist v2 safely

Import `.inkfinite.json`, persist canonical `.inkfinite` CRDT
files, export stable JSON snapshots, and recover from interrupted writes.

## Milestone 3: Desktop vertical slice

Exit when a desktop gesture commits through Rust, redraws from a returned patch,
survives reopen, and can be undone. The web and desktop composition roots must
render the same `@inkfinite/ui/editor` module while keeping Dexie and Tauri in
their respective application adapters. Do not create a second editor component
tree or theme.

### V2-08: Make Tauri own document sessions

Replaced frontend-owned desktop documents with a Rust session service and typed Tauri
commands.

### V2-09: Extract the editor runtime and transaction drafts

Split the large Svelte canvas controller into a framework-neutral editor runtime and a
thin Svelte adapter, with ephemeral gesture previews and durable transaction drafts.

## Milestone 4: Editor structure and scale

Exit when input remains correct through viewport changes and the 10,000-shape
budget passes with measured optimizations.

### V2-10: Fix cursor mapping across viewport changes

Implemented current-bound coordinate mapping, reactive viewport invalidation, and
pointer-capture cleanup across resize, scrolling, and device-pixel-ratio changes.

### V2-11: Meet the 10,000-shape rendering budget

Optimized measured rendering and hit testing while retaining a simple Canvas 2D design.

## Milestone 5: Layers, styles, and stencils

Exit when imported and new documents expose predictable layer behavior and
opacity without regressing existing stencils.

### V2-12: Ship layers through model, renderer, interaction, and UI

Shipped ordered layers with visibility, locking, active-layer state, opacity,
and a complete Svelte panel.

Blocked by: V2-07, V2-09, V2-11

Acceptance criteria:

- [x] New and imported pages always have a default layer; migration preserves
      exact shape order and is idempotent.
- [x] Rendering follows page layer order and child order, skips hidden layers,
      and composites layer opacity without leaking canvas state.
- [x] Hit testing, marquee, selection UI, editing, and agent transactions ignore
      hidden shapes and reject locked-layer changes.
- [x] New shapes use the active layer. Moving and reordering layers or shapes is
      one undoable transaction and converges under concurrent edits.
- [x] The panel lists, selects, creates, renames, reorders, hides, locks, deletes,
      and changes opacity with accessible controls.
- [x] Deleting a non-empty layer requires an explicit move destination or an
      explicit content deletion; the last layer cannot disappear.

Verification:

- Run model/engine, renderer, web component, migration, undo, and two-replica
  layer tests.

### V2-13: Add shape opacity and finish active-layer stencils

Exposed fill and stroke opacity, completed the curated built-in stencil set, and
made stencil insertion obey active-layer rules.

Blocked by: V2-12

Acceptance criteria:

- [x] Applicable shapes have validated fill and stroke opacity in `0..=1`, with
      accessible inspector controls and deterministic Canvas output.
- [x] Existing files default to their current opaque appearance; stroke opacity
      already present on freehand shapes migrates without drift.
- [x] The built-in library covers the intended flowchart, UI, and developer
      diagram set without adding sharing or community-library infrastructure.
- [x] Palette click and drag insertion place every stencil shape in the active
      layer, preserve grouping, snap when enabled, select the result, and create
      one undoable transaction.
- [x] Built-in stencil fixtures pass in visible, hidden, locked, and translucent
      layers.

Verification:

- Run focused model, Canvas renderer, stencil, inspector, migration, and undo
  tests. V2-14 adds the matching headless SVG coverage.

## Milestone 6: CLI and headless rendering

Exit when scripts and agents can inspect, safely change, validate, and render a
closed document without desktop code.

### V2-14: Render deterministic SVG

Added headless SVG rendering for all built-in shapes, layers,
bindings, transforms, opacity, text, and Markdown.

Blocked by: V2-04, V2-06, V2-13

Acceptance criteria:

- [x] Output is deterministic for a snapshot and supports page, layer, selection,
      and region filtering.
- [x] Hidden and locked semantics, ordering, opacity, arrow routing/labels,
      Markdown, text wrapping, and freehand strokes match Canvas fixtures.
- [x] Missing fonts or assets produce explicit warnings and deterministic
      fallbacks.
- [x] Snapshot tests cover every built-in shape and a representative full board.

Verification:

```sh
cargo test -p inkfinite-core render::
```

### V2-15: Ship read-only and schema CLI commands

Implemented `new`, `inspect`, `query`, `validate`, `schema`, and `capabilities`
in file mode with stable human and machine output, global output controls, and
task-oriented help.

Blocked by: V2-06, V2-07

Acceptance criteria:

- [x] Commands work while the desktop app is closed and contain no business
      logic outside shared crates.
- [x] `--json` never prompts, writes only machine data to stdout, sends
      diagnostics to stderr, and returns documented stable exit codes. It works
      before or after a subcommand.
- [x] Inspect/query report document heads and support semantic, hierarchy, layer,
      kind, and bounds filters.
- [x] Schema and capability output matches generated artifacts and is snapshot
      tested on Unix and Windows path conventions.
- [x] Top-level help includes common examples, version discovery, documentation
      and issue links, and typo suggestions. Each subcommand has realistic
      examples and clear value names. Running without a subcommand prints
      concise help and returns the usage exit code.
- [x] `capabilities --json` reports the global `--json` and
      `--non-interactive` options alongside commands, schemas, filters, format,
      protocol, and exit codes.

Verification:

```sh
cargo test -p inkfinite-cli
```

### V2-16: Ship mutating CLI commands and SVG output

What to build: Add generic apply plus structured shape, connection, layout, and
render commands, all through the transaction engine.

Blocked by: V2-05, V2-14, V2-15

Acceptance criteria:

- [x] `apply` accepts a transaction from a file or stdin and supports dry-run,
      inspected heads, record preconditions, and deterministic JSON results.
- [x] `shape create/patch/delete`, `connect`, and `layout` build ordinary
      transactions and honor layers, locks, permissions, and semantic selectors.
- [x] Failed validation, stale preconditions, file locks, or write errors leave
      the original byte-for-byte unchanged.
- [x] Results report previous/current heads, transaction ID, created/updated/
      deleted IDs, repairs, and warnings.
- [x] `render` writes deterministic SVG without opening the desktop app.
- [x] New subcommands preserve the global `--json` and `--non-interactive`
      options, stdout/stderr separation, stable exit codes, unambiguous names,
      descriptive long flags, built-in examples, and project support links.
- [x] Help, `capabilities --json`, README.md, TODO.md, ROADMAP.md, and CLI
      integration tests describe the same shipped interface.

Verification:

- Run CLI workflow tests for inspect → dry-run → apply → validate → reopen →
  render, including every failure path. Cover top-level and subcommand help,
  both placements of global options, version output, and the capability
  contract.

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
cargo test -p inkfinite-core ipc::
cargo test -p inkfinite-cli -p desktop
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

Exit when a clean installation completes every human, CLI, proposal, recovery,
and sync acceptance path, useful predecessor coverage has native replacements,
and no unreleased predecessor model remains in the product or codebase.

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
- [ ] File-format documentation accurately describes the behavior under
      evaluation; V2-22 collapses the temporary predecessor/current split before
      release.

Verification:

```sh
cargo fmt --all -- --check
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
pnpm format:check
pnpm bindings:check
pnpm bindings:test
pnpm --filter @inkfinite/core test --run
pnpm --filter @inkfinite/renderer test --run
pnpm --filter @inkfinite/runtime typecheck
pnpm --filter @inkfinite/input-dom typecheck
pnpm --filter @inkfinite/ui test
pnpm --filter @inkfinite/web test
pnpm --filter @inkfinite/desktop test
pnpm --filter @inkfinite/bindings typecheck
pnpm --filter @inkfinite/core typecheck
pnpm --filter @inkfinite/renderer typecheck
pnpm --filter @inkfinite/ui check
pnpm --filter @inkfinite/web check
pnpm --filter @inkfinite/web lint
pnpm --filter @inkfinite/desktop check
```

### V2-22: Collapse to one native Inkfinite model

What to build: Treat the current document model and file flow as Inkfinite's
only model. The earlier implementation never shipped, so remove the temporary
predecessor/current split in full: its files, import and migration paths,
adapters, names, branches, scripts, package commands, tests, fixtures, and
documentation. Keep explicit file, schema, and protocol version fields where
they validate persisted or exchanged data or allow future evolution; they must
not preserve an implementation of the unreleased predecessor.

Blocked by: V2-21

Acceptance criteria:

- [ ] Remove the predecessor fixtures, generators, baseline tooling, imports,
      migrations, adapters, compatibility-only tests, scripts, package commands,
      and documentation.
- [ ] Web, desktop, CLI, Rust, and shared TypeScript code expose one native model
      and one supported file flow. There are no user-facing format choices or
      internal branches for the unreleased implementation.
- [ ] Remove predecessor-only types, fields, metadata, aliases, and terminology.
      Rename retained code and fixtures by their current purpose instead of
      preserving `v1`, `v2`, `legacy`, `compatibility`, `migration`, or similar
      transition-oriented names.
- [ ] Replace useful rendering, performance, invalid-input, persistence,
      recovery, and import/export coverage with native fixtures before deleting
      its predecessor source. The replacement tests must exercise the same
      observable failure and recovery cases.
- [ ] Update ROADMAP.md and current documentation to describe the native model
      and supported file flow directly, without presenting the codebase as a
      compatibility bridge between product generations.
- [ ] Repository searches find no remaining code or first-party artifact tied to
      the predecessor/current split. Third-party dependency metadata, historical
      release notes, and intentional version fields are allowed only when they
      do not retain predecessor behavior or terminology in Inkfinite-owned APIs.
- [ ] The native release verification matrix passes after the cleanup.

Verification:

- Run the native release verification matrix after cleanup. Search tracked
  source, tests, fixtures, scripts, package manifests, generated artifacts, and
  current documentation for predecessor types and transition-oriented terms;
  review every match rather than relying on a fixed list of file removals.

## Frontier

V2-17 is the current frontier. Add authenticated local IPC for read-only live
status, inspection, queries, and focus.
