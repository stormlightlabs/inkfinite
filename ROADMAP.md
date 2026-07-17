# Inkfinite vNext / Version 2

Status: ready for implementation

This is the product and architecture contract for vNext. [TODO.md](TODO.md) is
the implementation queue.

## Objective

Build Inkfinite as a local-first visual document system for infinite-canvas
drawing, wireframing, and diagramming. A Tauri desktop app, a Rust CLI, and
shared Rust crates must open and change the same document through the same
validated transaction engine.

Humans and agents produce the same reversible document transactions. Agents use
the CLI and a bundled `SKILL.md`; MCP and UI automation are not part of vNext.

## Success criteria

- Rust owns the durable model, migrations, validation, CRDT state, file I/O,
  history, and queries. TypeScript owns low-latency interaction and rendering.
- Every completed human or agent edit becomes one validated transaction and one
  Automerge change. Two offline replicas converge after exchanging changes.
- Existing `.inkfinite.json` boards import without data loss. v2 files survive
  interrupted writes and expose stable JSON and SVG projections for inspection.
- The desktop app, file-mode CLI, and live CLI use the same engine. Stale or
  invalid mutations cannot partly modify a document.
- Pages contain ordered layers. Hidden and locked layers affect rendering and
  interaction; new shapes and built-in stencils use the active layer.
- A scripted 10,000-shape document meets the recorded interaction budget on the
  project reference machine. Benchmarks decide whether a spatial index ships.
- Shared fixtures cover Rust/TypeScript schema agreement, migrations, CRDT
  merges, transactions, rendering, CLI output, and IPC.

## Current state

- The pnpm monorepo contains a TypeScript core, Canvas 2D renderer, SvelteKit web
  UI, and Tauri 2 wrapper.
- TypeScript currently owns a flat page/shape model, snapshot undo/redo, tools,
  and persistence. Web documents use Dexie; desktop persistence is called from
  the frontend. The Rust backend only exposes file-management helpers.
- `createCanvasController` combines tools, persistence, overlays, rendering, and
  input. The renderer walks every shape on the page and resizes its backing
  canvas on each draw.
- Built-in stencils, grid snapping, a dirty-frame loop, Markdown shapes, and
  cursor coordinate mapping already exist. vNext must preserve them while adding
  active-layer placement, measured rendering improvements, Markdown layout
  caching, and a resize regression test for cursor mapping.

## Architecture

```text
Svelte UI + DOM editors
        │ Tauri commands, patches, notifications
        ▼
Tauri document service ───── local socket ───── Rust CLI
        │                                           │
        └──────────── shared Rust crates ───────────┘
              model · CRDT · transactions
              validation · queries · files
              migrations · SVG · protocol

TypeScript editor runtime
  camera · tools · selection · gesture previews · Canvas 2D
```

### Technology

| Concern                  | Choice                                                    |
| ------------------------ | --------------------------------------------------------- |
| Desktop                  | Tauri 2                                                   |
| UI                       | SvelteKit and Svelte 5                                    |
| Interactive rendering    | Native Canvas 2D with positioned DOM editors              |
| Durable model and engine | Rust                                                      |
| Local-first state        | Automerge, isolated behind Inkfinite interfaces           |
| CLI                      | Rust and `clap`                                           |
| Schemas and bindings     | Serde, Schemars, and `ts-rs`                              |
| Desktop control          | `interprocess` local sockets and length-prefixed messages |
| Async I/O                | Tokio where needed                                        |
| Agent integration        | CLI and bundled `SKILL.md`                                |

### Ownership boundary

Rust owns document records, Automerge changes and heads, format migrations,
transaction validation and application, undo/redo, persistence and recovery,
permissions and provenance, queries, CLI behavior, and live IPC.

TypeScript owns camera and viewport state, normalized input, tool state machines,
hover and selection, drag/resize previews, active text and Markdown editors,
Canvas rendering, and panels. Pointer movement stays local. Pointer-up or another
gesture boundary emits a transaction draft; successful Rust commits return a
patch for the frontend's read-only document mirror.

### Crate and package boundaries

| Unit                   | Responsibility                                                           |
| ---------------------- | ------------------------------------------------------------------------ |
| `inkfinite-model`      | IDs, records, semantic metadata, versions, schema/binding generation     |
| `inkfinite-crdt`       | Automerge mapping, heads, merge, sync, compaction, materialization       |
| `inkfinite-engine`     | Transactions, inverse operations, validation, queries, layout, revisions |
| `inkfinite-file`       | Import, migration, atomic saves, locking, recovery, export               |
| `inkfinite-protocol`   | Serializable Tauri, CLI, and IPC requests and responses                  |
| `inkfinite-render-svg` | Deterministic headless rendering of built-in shapes                      |
| `inkfinite-ipc`        | Authenticated local-socket server and client                             |
| `inkfinite-cli`        | `clap`, formatting, exit codes, and calls into shared crates             |
| `editor-runtime`       | Framework-neutral tools, camera, selection, and previews                 |
| `renderer-canvas`      | Svelte-independent Canvas 2D renderer                                    |
| `input-dom`            | Browser input normalization                                              |
| `generated-bindings`   | Generated TypeScript records; never hand-edited                          |

Business logic must not depend on Tauri, Svelte, CLI parsing, or a transport.

## CRDT decision

Automerge is part of vNext, rather than a later collaboration retrofit. Its core
is Rust and the JavaScript package exposes that core through WebAssembly. It also
provides a compact storage format and a transport-independent sync protocol.
These properties fit the Rust-owned document service better than making a
JavaScript CRDT authoritative. See the [Automerge repository][am-repo],
[Rust API][am-rust], and [sync concepts][am-sync].

Yjs with Yrs remains the fallback if the first architecture gate finds a release
blocking problem. Yrs supports Yjs-compatible update formats, while Yjs offers a
large provider ecosystem; see the [Yrs documentation][yrs] and [Yjs update
API][yjs]. The rest of Inkfinite must depend on project-owned document, patch,
and sync interfaces so this fallback does not change product contracts.

The gate must prove Rust/JavaScript round trips, nested maps and ordered lists,
collaborative text, incremental patches, actor-scoped undo, compaction, sync,
merge-time invariant handling, and acceptable time and memory use with 10,000
shapes. Record the benchmark hardware and dependency versions before locking the
v2 format.

V2-02 completed this gate on July 17, 2026. The proof exchanged compact files
between Rust and JavaScript, converged offline edits independent of merge order,
and validated deterministic hierarchy repair before adoption. Automerge passed,
so Yjs/Yrs was not evaluated. V2-05 moved the reusable Rust coverage into
`inkfinite-crdt` and `inkfinite-engine`, then removed the disposable proof. The
measurements below preserve the architecture-gate evidence.

On the V2-01 Apple M1 reference machine, the 3.98 MB, 10,000-shape JSON fixture
produced a 211 KB compact Rust document. Rust import, load, and save took 1.76 s,
1.82 s, and 495 ms, with a 98 MB resident-memory increase. The JavaScript proof
used 651 KB of storage and added 422 MB of resident memory. These costs confirm
the planned ownership boundary: Rust holds the CRDT, while TypeScript holds a
materialized mirror. The V1 baseline's 9.69 ms open and 12.09 ms save parse plain
JSON and are not equivalent to first-time CRDT import.

V2-03 upgraded the workspace to Rust 1.89 and reran the fixed-seed proof twice
with Automerge Rust 0.10.0 and `@automerge/automerge` 3.2.6. Both runs converged
to identical snapshots, and the original semantic, repair, sync, and
cross-language tests passed without changing the Inkfinite proof boundary.
Production code depends on the Inkfinite-owned CRDT contracts rather than
Automerge types, so changes to Automerge's low-level API remain isolated.

The V2-11 reference budgets are an 8 ms median Canvas frame and a 1 ms median
hit test for the frozen 10,000-shape board. The V1 medians are 0.61 ms and
0.22 ms. V2-11 may add a spatial index only if its linear query path misses the
1 ms budget.

One Inkfinite transaction maps to one Automerge change. Causal heads, rather
than a scalar revision, are the concurrency token. A local sequence number may
be displayed, but callers use inspected heads and operation preconditions.
Remote changes are merged into a fork, materialized, repaired by deterministic
rules where specified, and validated before the session adopts them.

The canonical v2 file is Automerge's compact binary form with the `.inkfinite`
extension. `.inkfinite.json` remains a lossless v1 import and a stable snapshot
export, not a CRDT round-trip format. The CLI supplies JSON inspection and SVG
rendering for repositories and CI.

## Document contract

A materialized snapshot exposes:

```rust
pub struct DocumentSnapshot {
    pub format: String,
    pub format_version: u32,
    pub document_id: DocumentId,
    pub heads: Vec<ChangeHash>,
    pub document: Document,
}
```

The document contains normalized pages, layers, shapes, bindings, and assets.
IDs remain stable across paths and replicas.

### Scene and layers

```text
Page
├── Layer
│   ├── Shape
│   └── Container shape
│       └── Child shape
└── Layer
```

- A page stores an ordered list of layer IDs. A layer stores an ordered list of
  root shape IDs plus `name`, `visible`, `locked`, and `opacity` in `0..=1`.
- A shape has one parent, either a layer or a container shape, and a transform
  relative to that parent. Ordered child-ID lists are the sole draw-order source;
  transactions use sibling anchors instead of fragile numeric indexes.
- Free layout is the default. Containers may opt into stack or grid layout with
  direction/columns, gap, padding, and alignment.
- Hidden and locked state is inherited from the containing layer. Hidden shapes
  are neither rendered nor hit-tested. Locked shapes cannot be selected or
  changed. New pages always have one default layer.
- Deleting a non-empty layer requires an explicit destination layer or explicit
  deletion of its contents. Imports backfill one default layer without changing
  visual order.

Concurrent merge repairs must be deterministic. Missing parents move to a
stable recovery layer, bindings to missing shapes are removed, duplicate child
references collapse, and a page with no layer gains its stable default layer.
The engine records repair warnings in the commit or sync result.

### Shapes

A shape record contains a string kind, parent ID, transform, kind-specific
properties, semantic metadata, and a per-record version. Metadata includes name,
role, description, tags, locked state, `agent_editable`, and provenance. Common
style supports shape opacity; applicable shapes expose separate fill and stroke
opacity controls.

Semantic roles such as `wireframe.button`, `diagram.process`,
`architecture.service`, and `note.sticky` let agents query by meaning instead of
screen coordinates.

Shape kinds use registries rather than a closed serialized enum. Rust definitions
validate properties, calculate bounds, participate in layout, and render SVG.
TypeScript definitions validate, calculate bounds, hit-test, and render Canvas
2D. Shared fixtures enforce kind names, property schemas, geometry conventions,
and serialization across both registries. vNext supports built-in shapes only;
the registry is an internal extension seam, not a third-party plugin API.

## Transaction contract

A transaction carries an ID, actor, origin, inspected base heads, description,
operations, and timestamp. Operations cover pages, layers, shapes, hierarchy,
bindings, assets, and layout. Patch and delete operations may include an expected
record version.

The engine performs this flow atomically:

```text
draft → schema check → head/precondition check → invariant check
      → apply on CRDT fork → materialize and validate → commit change
      → persist → return patch, inverse, heads, affected IDs, warnings
```

Human desktop edits, file-mode CLI edits, live CLI edits, undo/redo, and synced
peer changes all pass through this boundary. Undo emits a compensating,
actor-scoped change and must preserve concurrent work from other actors.

## Desktop and renderer

The Tauri backend maintains open document sessions with path, Automerge state,
materialized snapshot, undo/redo metadata, sync peers, and dirty/recovery state.
Commands cover create/open/snapshot/commit/undo/redo/save/save-as/query/validate/
close and proposal accept/reject.

Use commands for request/response, events for small notifications, and channels
only for ordered streams. The frontend applies returned patches to its mirror;
it never persists arbitrary document mutations.

Keep Canvas 2D. The renderer receives a snapshot, camera, session state, and an
optional transaction preview. DOM overlays remain limited to active text and
Markdown editing, menus, tooltips, accessibility controls, and proposal review.

Performance work is evidence-driven:

- Resize the backing canvas only when CSS dimensions or device-pixel ratio
  change, draw only while dirty, and batch related mirror updates.
- Cull against visible world bounds and separate durable scene rendering from
  ephemeral overlays.
- Cache text metrics, freehand outlines, and Markdown layout by Markdown source,
  width, and style.
- Benchmark hit testing and rendering with a generated 10,000-shape fixture.
  Add an incrementally maintained spatial index if the recorded query budget is
  missed; keep the linear path if it meets the budget.
- Recompute pointer mappings from current canvas bounds and viewport state. Tests
  must cover resize, device-pixel-ratio changes, scrolling, and pointer capture.

WebGL and OffscreenCanvas require benchmark evidence and are deferred.

## CLI and agent workflow

The CLI binary is `inkfinite`; the desktop application is `Inkfinite`. File mode
works without the app:

```sh
inkfinite new architecture.inkfinite
inkfinite inspect architecture.inkfinite --json
inkfinite query architecture.inkfinite --role architecture.service --json
inkfinite apply architecture.inkfinite --transaction transaction.json --dry-run
inkfinite validate architecture.inkfinite
inkfinite render architecture.inkfinite --output architecture.svg
```

Structured `shape create/patch/delete`, `connect`, and `layout` commands build
ordinary transactions. They never bypass the engine. `schema document`, `schema
transaction`, `schema protocol`, and `capabilities --json` expose the contracts.

Every command supports deterministic JSON where applicable, reads standard input
where useful, writes machine output to stdout and diagnostics to stderr, never
prompts under `--json` or `--non-interactive`, and uses stable exit codes.
Mutations support `--dry-run`, report heads and affected IDs, write atomically,
and refuse failed preconditions or invalid documents.

The bundled skill teaches agents to inspect heads, query narrowly, create the
smallest transaction, dry-run, resolve conflicts, apply or propose, validate,
and render affected content. Agents must respect locked shapes and
`agent_editable: false`, prefer semantic selectors and layout operations, and
never edit document bytes manually.

## Live control and collaboration

The CLI may connect to the running desktop app for `app status`, `inspect`,
`query`, `propose`, `apply`, and `focus`.

`app propose` is the default agent path. Rust validates it and the UI shows a
ghost preview plus created, changed, and deleted IDs. Rejection changes nothing.
Partial acceptance creates a new transaction from the selected operations and
revalidates it against current heads. `app apply` requires explicit user
authorization.

Use a per-user Unix-domain socket or Windows named pipe, a per-install or
per-session token, protocol versions, length-prefixed messages, and strict size
limits. Do not expose public TCP or local HTTP. The Tauri process hosts the
server; vNext has no background daemon.

Automerge sync between trusted peers is a vNext deliverable. The sync layer must
be transport-independent and prove offline concurrent edits between two app
instances. A hosted relay, accounts, sharing policy, and presence service are
later milestones; CRDT storage and merge semantics are not deferred with them.

## Persistence and generated contracts

All desktop file access passes through Rust. Saves validate current heads, write
to a same-directory temporary file, flush, atomically replace where supported,
and retain a recovery copy on failure. Advisory locking must prevent unaware
file-mode and desktop writers from racing.

Recovery data lives under app data by document ID and contains a compact
Automerge snapshot plus incremental changes. Clean saves compact the journal and
retain a bounded recovery window; normal files do not grow without compaction.

Rust records generate JSON Schema and TypeScript bindings for documents,
transactions, and protocols. CI fails when generated artifacts are stale.

## Verification

The stable boundary is a document opened or created through a public desktop or
CLI entry point, changed through the transaction engine, persisted, reopened,
and compared by materialized snapshot and Automerge heads.

Required coverage includes serialization, migrations, merge convergence,
deterministic repairs, referential integrity, transaction inversion, actor-scoped
undo, precondition conflicts, locked/hidden layers, active-layer insertion,
atomic-write failures, IPC framing/authentication, CLI JSON, tool state machines,
pointer normalization, patch reconciliation, Canvas hit testing, and SVG output.

Current commands, before the Cargo workspace exists:

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

The vNext workspace must add `cargo test --workspace`, `cargo clippy --workspace
--all-targets -- -D warnings`, generated-artifact checks, shared-fixture tests,
CLI integration tests, the two-replica sync test, and the performance harness.
Human review remains required for proposal UX, layers, visual render fixtures,
recovery prompts, and release migrations.

## Milestones

1. **Architecture gate:** freeze v1 fixtures and prove Automerge, performance,
   merge repair, and the project-owned abstraction. Exit with a recorded decision.
2. **Rust authority:** establish the workspace, v2 model, CRDT adapter,
   transactions, validation, migrations, schemas, and generated bindings. Exit
   with convergent Rust tests and lossless v1 imports.
3. **Desktop vertical slice:** make Rust own open, edit, undo, save, recovery, and
   the frontend mirror. Exit with an end-to-end drag, reopen, and undo test.
4. **Editor structure and scale:** extract the editor runtime, fix resize cursor
   mapping, add culling/caches/benchmarks, and add a spatial index only if needed.
   Exit with the recorded 10,000-shape budget passing.
5. **Layers and styles:** ship layer migration, rendering, interaction, panel,
   opacity controls, and active-layer stencil insertion. Exit with old and new
   documents behaving consistently.
6. **CLI and SVG:** ship inspect/query/validate/apply/schema/render followed by
   structured editing, connections, and layout. Exit with stable JSON and
   snapshot-tested SVG.
7. **Live control and sync:** add authenticated local IPC, reviewable proposals,
   explicit direct apply, and two-replica offline sync. Exit with adversarial IPC
   and convergence tests.
8. **Agent and release readiness:** bundle the skill, capabilities, examples, and
   full migration/recovery/performance matrix. Exit only when every vNext success
   criterion has evidence.

## Deferred milestones

- Adapt the web app to the v2 Rust/CRDT authority after the desktop contracts and
  file format stabilize. Its Dexie migration must backfill every existing board
  with a default layer and preserve shape order. Keep the current web build green
  during vNext work.
- Add hosted sync relay, identity, invitations, permissions, and ephemeral
  presence after local peer sync is correct and threat-modeled.
- Consider WebGL, OffscreenCanvas, third-party shape plugins, Figma import,
  responsive design constraints, image generation, community stencil libraries,
  and a full design-system editor only with separate product and performance
  evidence.

## Boundaries

- Follow existing patterns, preserve v1 fixtures, run affected tests, and keep
  Git read-only unless repository instructions change.
- Ask before adding production dependencies, changing a published format or
  protocol, broadening authentication or network exposure, or deleting user data.
- Never expose a public control server, accept invalid partial writes, hand-edit
  generated bindings, bypass permissions, silently discard merge conflicts, add
  MCP as a second control plane, or mutate production data during tests.

## Risks and open questions

- Automerge's Rust API is lower-level than its JavaScript API. The architecture
  gate must contain it inside `inkfinite-crdt`; Yjs/Yrs is the defined fallback.
- Concurrent hierarchy edits can violate referential invariants. Repair rules
  need property-based convergence tests before the v2 schema is frozen.
- CRDT history, freehand strokes, assets, and large boards may raise memory and
  save costs. Benchmarks must set compaction and asset-storage limits.
- Actor-scoped undo and partially accepted proposals must be tested against
  intervening local and remote changes, not only linear histories.
- The release checklist must settle reference hardware and numeric frame, query,
  open, save, and sync budgets from the architecture-gate baseline.

[am-repo]: https://github.com/automerge/automerge
[am-rust]: https://docs.rs/automerge/latest/automerge/
[am-sync]: https://automerge.org/docs/reference/concepts/
[yrs]: https://docs.rs/yrs/latest/yrs/
[yjs]: https://docs.yjs.dev/api/document-updates
