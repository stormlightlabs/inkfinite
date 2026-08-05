# Inkfinite native document roadmap

Status: V2-01 through V2-20 and V2-22 are complete; V2-23 and V2-21 remain

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

- Rust owns the durable model, schema-version validation, CRDT state, file I/O,
  history, and queries. TypeScript owns low-latency interaction and rendering.
- Every completed human or agent edit becomes one validated transaction and one
  Automerge change. Two offline replicas converge after exchanging changes.
- Native `.inkfinite` files survive interrupted writes and expose stable JSON and SVG projections
  for inspection.
- Native fixtures and release evidence cover successful, invalid, rendering,
  performance, persistence, recovery, and export cases.
- The desktop app, file-mode CLI, and live CLI use the same engine. Stale or
  invalid mutations cannot partly modify a document.
- A user and a fresh Codex session can co-design a wireframe in the offline
  desktop app through inspect, query, proposal review, revision, partial
  acceptance, save, reopen, validation, and deterministic rendering.
- Pages contain ordered layers. Hidden and locked layers affect rendering and
  interaction; new shapes and built-in stencils use the active layer.
- A scripted 10,000-shape document meets the recorded interaction budget on the
  project reference machine. Benchmarks decide whether a spatial index ships.
- Shared fixtures cover Rust/TypeScript schema agreement, CRDT merges,
  transactions, rendering, CLI output, and IPC.

## Current state

- The Cargo and pnpm workspaces contain the Rust core, generated TypeScript
  bindings, Canvas 2D renderer, shared Svelte editor, web app, and Tauri desktop
  app.
- Rust owns the native model, Automerge-backed transaction engine, schemas, desktop
  sessions, file persistence, recovery, and typed Tauri commands. The desktop
  frontend keeps a read-only mirror; the web app retains its Dexie adapter.
- `@inkfinite/runtime` and `@inkfinite/input-dom` own framework-neutral editor
  state and normalized browser input. Both application roots compose the same
  `@inkfinite/ui/editor` module through platform-specific adapters.
- The renderer uses dirty frames, viewport culling, bounded layout caches, and
  current-bound pointer mapping. Layers, fill and stroke opacity, the curated
  stencil library, and active-layer insertion work across model, rendering,
  interaction, web, and desktop boundaries.
- Rust produces deterministic headless SVG for built-in shapes, layers,
  bindings, nested transforms, text, Markdown, and filtered views. Missing
  fonts and assets use stable fallbacks with explicit warnings.
- The file-mode CLI creates, inspects, queries, edits, validates, and renders
  closed documents. Generic and structured mutations pass through the
  transaction engine, support dry runs and semantic selectors, and save through
  the locked atomic file boundary. The CLI also exposes generated schemas,
  global `--json` and `--non-interactive` options, task-oriented help, and a
  machine-readable capability contract.
- The desktop owns an authenticated, versioned local IPC server. The CLI can
  inspect open sessions, query the same materialized records as file mode, and
  request frontend focus without a TCP listener or background daemon.
- [TODO.md](TODO.md) starts the remaining work at V2-23: collaborative desktop
  QA and final release verification. V2-20's bundled agent skill, V2-22's native
  cleanup, and the clean fixture run are complete.

## Architecture

The target architecture is:

```text
Static web root ── Dexie adapter ──┐
                                   ├── @inkfinite/ui/editor
Desktop root ── Tauri adapter ─────┘            │
        │ Tauri commands, patches, notifications
        ▼
Tauri document service ───── local socket ───── Rust CLI
        │                                           │
        └──────────── shared Rust crates ───────────┘
              model · CRDT · transactions
              validation · queries · files
              schema validation · SVG · protocol

TypeScript editor runtime
  camera · tools · selection · gesture previews · Canvas 2D
```

### Technology

| Concern                  | Choice                                                     |
| ------------------------ | ---------------------------------------------------------- |
| Desktop                  | Tauri 2                                                    |
| UI                       | SvelteKit, Svelte 5, and shared `@inkfinite/ui` components |
| Interactive rendering    | Native Canvas 2D with positioned DOM editors               |
| Durable model and engine | Rust                                                       |
| Local-first state        | Automerge, isolated behind Inkfinite interfaces            |
| CLI                      | Rust and `clap`                                            |
| Schemas and bindings     | Serde, Schemars, and `ts-rs`                               |
| Desktop control          | Authenticated local sockets and length-prefixed messages   |
| Async I/O                | Tokio where needed                                         |
| Agent integration        | CLI and bundled `SKILL.md`                                 |

### Ownership boundary

Rust owns document records, Automerge changes and heads, format-version checks,
transaction validation and application, undo/redo, persistence and recovery,
permissions and provenance, queries, CLI behavior, and live IPC.

TypeScript owns camera and viewport state, normalized input, tool state machines,
hover and selection, drag/resize previews, active text and Markdown editors,
Canvas rendering, and panels. Pointer movement stays local. Pointer-up or another
gesture boundary emits a transaction draft; successful Rust commits return a
patch for the frontend's read-only document mirror.

### Crate and package boundaries

| Unit                   | Responsibility                                                          |
| ---------------------- | ----------------------------------------------------------------------- |
| `inkfinite-core`       | Document model and engine plus CRDT, file, protocol, rendering, and IPC |
| `inkfinite-cli`        | `clap`, formatting, exit codes, and calls into shared Rust code         |
| `@inkfinite/runtime`   | Framework-neutral tools, camera, selection, and previews                |
| `@inkfinite/renderer`  | Svelte-independent Canvas 2D renderer                                   |
| `@inkfinite/input-dom` | Browser input normalization                                             |
| `@inkfinite/bindings`  | Generated TypeScript records; never hand-edited                         |
| `@inkfinite/ui`        | Shared Svelte components, themes, fonts, icons, stories, and UI tests   |
| `@inkfinite/ui/editor` | Shared product editor, document-aware panels, and platform contract     |

Business logic must not depend on Tauri, Svelte, CLI parsing, or a transport.

## CRDT and file decisions

Automerge is the document CRDT. The V2-02 architecture gate proved cross-language
round trips, offline convergence, deterministic hierarchy repair, sync, undo,
compaction, and the 10,000-shape workload. Production code depends on
Inkfinite-owned document, patch, and sync interfaces rather than Automerge
types, keeping its low-level API isolated. See the [Automerge repository][am-repo],
[Rust API][am-rust], and [sync concepts][am-sync].

The recorded dependency baseline is Rust 1.89, Automerge Rust 0.10.0, and
`@automerge/automerge` 3.2.6. On the Apple M1 reference machine, V2-11 measured a
0.61 ms median Canvas frame and a 0.34 ms median linear hit test against budgets
of 8 ms and 1 ms. The linear path remains; a spatial index and second durable
scene bitmap did not justify their complexity. The complete performance record
is in [`fixtures/native/performance/rendering-budget.json`](fixtures/native/performance/rendering-budget.json).

One Inkfinite transaction maps to one Automerge change. Causal heads, rather
than a scalar revision, are the concurrency token. A local sequence number may
be displayed, but callers use inspected heads and operation preconditions.
Remote changes are merged into a fork, materialized, repaired by deterministic
rules where specified, and validated before the session adopts them.

The canonical file is Automerge's compact binary form with the `.inkfinite`
extension. JSON is a deterministic inspection projection, not a second file
format or CRDT round-trip. The
[file format reference](apps/web/src/routes/docs/reference/file-format/+page.svx)
defines the current file behavior. The CLI supplies JSON inspection for repositories and
CI and produces deterministic SVG.

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
  deletion of its contents. A page repaired without a layer gains one default
  layer without changing visual order.

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
materialized snapshot, undo/redo metadata, trusted sync peers, and
dirty/recovery state. Commands cover create/open/snapshot/commit/undo/redo/save/
save-as/query/validate, peer connect/disconnect/send/receive, close, and
proposal accept/reject.

Use commands for request/response, events for small notifications, and channels
only for ordered streams. The frontend applies returned patches to its mirror;
it never persists arbitrary document mutations.

Keep Canvas 2D. The renderer receives a snapshot, camera, session state, and an
optional transaction preview. DOM overlays remain limited to active text and
Markdown editing, menus, tooltips, accessibility controls, and proposal review.

`apps/web` and `apps/desktop` are separate SvelteKit composition roots. Each
builds and deploys independently, while both render `@inkfinite/ui/editor`.
The web root supplies the Dexie adapter; the desktop root supplies typed Tauri
commands and desktop-only file capabilities. Neither root owns a second editor
component tree or theme.

The renderer resizes its backing canvas only when CSS dimensions or device-pixel
ratio change, draws only while dirty, culls against visible world bounds, and
caches text, Markdown layout, and freehand outlines. Pointer mapping uses current
canvas and viewport bounds through resize, scrolling, device-pixel-ratio changes,
and pointer capture. The measured linear hit-test path stays simpler than a
spatial index; WebGL and OffscreenCanvas remain deferred pending evidence.

## CLI and agent workflow

The CLI binary is `inkfinite`; the desktop application is `Inkfinite`. File mode
works without the app. It can create, inspect, query, validate, mutate, and render
closed files. Structured shape, connection, and layout commands build ordinary
transactions and never bypass the engine. Schema commands and
`capabilities --json` expose the machine-readable contracts.

`--json` and `--non-interactive` are global and may appear before or after a
subcommand. Every command supports deterministic JSON where applicable, reads
standard input where useful, writes machine output to stdout and diagnostics to
stderr, never prompts under either global option, and uses stable exit codes.
Mutations support `--dry-run`, report heads and affected IDs, write atomically,
and refuse failed preconditions or invalid documents.

CLI design follows the [Command Line Interface Guidelines](https://clig.dev/).
`inkfinite --help`, `inkfinite capabilities --json`, README.md, and integration
tests are the command and exit-code references and must stay synchronized.

The bundled skill in `skills/inkfinite` teaches agents to inspect heads, query
narrowly, create the smallest transaction, dry-run, resolve conflicts, apply or
propose, validate, and render affected content. Its fixture runner checks the
CLI help, capabilities, generated schemas, file-mode edits, live proposal
framing, partial acceptance, and stale-head recovery. Agents must respect
locked shapes and `agent_editable: false`, prefer semantic selectors and layout
operations, and never edit document bytes manually.

The release-candidate QA pairs a user with a fresh Codex session to wireframe a
desktop application while disconnected from the network. Codex works through
the live proposal path; the user reviews, rejects, revises, and partially accepts
changes while continuing to edit in the canvas. Save, reopen, undo/redo,
validation, and SVG rendering must preserve the reviewed result. This is a human
visual review boundary, not desktop UI automation.

## Live control and collaboration

The CLI connects to the running desktop app for `app status`, `app inspect`,
`app query`, and `app focus`. It can also propose a transaction for review with
`app propose` or submit a structured live edit that follows the document's
desktop-controlled Agent access mode. Review mode creates a proposal; Direct
mode applies validated edits immediately.

`app propose` is the default agent path. Rust validates it and the UI shows a
ghost preview plus created, changed, and deleted IDs. Rejection changes nothing.
Partial acceptance creates a new transaction from the selected operations and
revalidates it against current heads. Direct access is session-scoped, defaults
to Review, and can only be enabled from the desktop UI.

V2-17 and V2-18 use a per-user Unix-domain socket or Windows named pipe, a
protected per-session token, protocol versions, length-prefixed messages, and
strict size limits. Proposals are bounded and expire; partial acceptance creates
and revalidates a new transaction, while direct apply requires the session's
desktop-controlled Direct mode. The server does not expose public TCP or local
HTTP. The Tauri process owns the server and removes its discovery record when it
exits; vNext has no background daemon.

Automerge sync between trusted peers is implemented through a transport-neutral
envelope and bounded per-peer checkpoints. The session validates and repairs a
fork before adopting it, quarantines malformed payloads, and persists document
state before advancing a durable checkpoint. A hosted relay, accounts, sharing
policy, and presence service remain later milestones; CRDT storage and merge
semantics are local and complete.

## Persistence and generated bindings

All desktop file access passes through Rust. Saves validate current heads, write
to a same-directory temporary file, flush, atomically replace where supported,
and retain a recovery copy on failure. Advisory locking must prevent unaware
file-mode and desktop writers from racing.

Recovery data lives under app data by document ID and contains a compact
Automerge snapshot plus incremental changes. Clean saves compact the journal and
retain a bounded recovery window; normal files do not grow without compaction.

Rust records generate JSON Schema and TypeScript bindings for documents,
transactions, and protocols. The `generate-bindings --check` command fails when
generated artifacts are stale, and the shared Rust/TypeScript fixture covers the
registry and geometry boundary.

## Verification

The stable boundary is a document opened or created through a public desktop or
CLI entry point, changed through the transaction engine, persisted, reopened,
and compared by materialized snapshot and Automerge heads.

Required coverage includes serialization, schema validation, merge convergence,
deterministic repairs, referential integrity, transaction inversion, actor-scoped
undo, precondition conflicts, locked/hidden layers, active-layer insertion,
atomic-write failures, IPC framing/authentication, CLI JSON, tool state machines,
pointer normalization, patch reconciliation, Canvas hit testing, and SVG output.

Current verification commands:

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
pnpm --filter @inkfinite/desktop check
pnpm --filter @inkfinite/web lint
```

V2-21 extends this with generated-artifact, CLI, IPC, convergence, recovery,
performance, accessibility, and visual checks after native-model cleanup and the
collaborative desktop QA pass. Human review remains required for stencils,
render parity, proposal UX, recovery prompts, and permission failures.

## Remaining sequence

Milestones 1 through 7 are complete. [TODO.md](TODO.md) owns ticket-level status,
acceptance criteria, and dependency order. The remaining path is:

1. Run the human-and-Codex desktop wireframing sequence (V2-23).
2. Run the final release matrix against the native candidate (V2-21).

## Deferred milestones

- Add a browser-side native-file bridge only if a future product decision needs
  standalone web documents to leave IndexedDB. The current web adapter stores
  the same shared editor records locally and does not define another document
  contract.
- Add hosted sync relay, identity, invitations, permissions, and ephemeral
  presence after local peer sync is correct and threat-modeled.
- Consider WebGL, OffscreenCanvas, third-party shape plugins, Figma import,
  responsive design constraints, image generation, community stencil libraries,
  and a full design-system editor only with separate product and performance
  evidence.

## Boundaries

- Follow existing patterns, keep native fixtures close to the behavior they
  exercise, run affected tests, and keep Git read-only unless repository
  instructions change.
- Ask before adding production dependencies, changing a published format or
  protocol, broadening authentication or network exposure, or deleting user data.
- Never expose a public control server, accept invalid partial writes, hand-edit
  generated bindings, bypass permissions, silently discard merge conflicts, add
  MCP as a second control plane, or mutate production data during tests.

## Risks and open questions

- CRDT history, freehand strokes, assets, and large boards may raise memory and
  save costs. The release matrix must enforce compaction and asset-storage
  limits.
- Actor-scoped undo and partially accepted proposals must be tested against
  intervening local and remote changes, not only linear histories.
- Local IPC authentication and framing must remain safe under malformed,
  oversized, replayed, and cross-user requests.
- Native-model cleanup must not discard useful rendering, invalid-input,
  persistence, recovery, or performance coverage; V2-22 preserves that coverage
  in native fixtures and focused tests.

[am-repo]: https://github.com/automerge/automerge
[am-rust]: https://docs.rs/automerge/latest/automerge/
[am-sync]: https://automerge.org/docs/reference/concepts/
