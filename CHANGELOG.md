# Changelog

## [Unreleased]

### Added

- Automerge-backed CRDT transaction engine: validates, commits, and returns
  patches, heads, inverse metadata, affected IDs, and warnings in one atomic
  operation.
- Rust document model with pages, layers, shapes, bindings, semantic metadata,
  and stable IDs.
- Typed schema generation and TypeScript bindings from Rust records.
- Deterministic headless SVG rendering for all built-in shapes, layers,
  bindings, transforms, opacity, text, and Markdown.
- File-mode CLI commands: `new`, `inspect`, `query`, `validate`, `shape`,
  `connect`, `layout`, `apply`, `render`, `schema`, `capabilities`.
- Global `--json` and `--non-interactive` CLI options with `--dry-run` for
  mutations and stable exit codes.
- Authenticated local IPC between the desktop app and CLI using versioned
  Unix-domain sockets or Windows named pipes.
- Live agent proposal workflow with ghost preview, partial acceptance, and
  explicit-apply Direct mode.
- Offline Automerge sync between trusted peers through a transport-neutral
  envelope and per-peer checkpoints.
- Bundled agent skill with worked examples covering file edits, proposal
  review, and stale-head recovery.
- Excalidraw and Obsidian Canvas (JSON Canvas) import and export.
- Ordered layers with visibility, locking, active-layer state, opacity, and a
  curated built-in stencil set.
- Shape fill and stroke opacity controls.
- 10,000-shape rendering and hit-testing budget met on reference hardware.
- Atomic file writes with advisory lock, recovery data, and interrupted-write
  recovery.
- Tauri desktop document sessions owned by Rust: create, open, snapshot,
  commit, undo, redo, save, query, and validate.
- WASM (Rust-owned) editor projection and reconciliation bindings that handle composed
  ancestor transforms, semantic editor patches, and minimal parent-relative native transactions.
- Stateful browser WASM document sessions that open, validate, mutate, undo, redo, and save
  canonical Automerge bytes through one worker.

#### SVG Interop

- Native path shape representation with normalized move, line, quadratic, and
  cubic subpaths, closed-path flags, compound fill rules, and generated bindings.
- Static SVG import parsing with native primitive and path mapping, nested
  transforms, inherited paint and opacity, text flattening, embedded raster
  asset extraction, retained source assets, and typed warnings for unsupported
  content and active SVG features.
- Native path bounds with Bézier extrema, Canvas rendering, fill and stroke hit
  testing, parent-relative transforms, deterministic SVG output, and shared
  valid/invalid geometry fixtures.
- SVG imports committed as one validated transaction from the desktop file menu,
  browser file and drop entry points, and the CLI.
- Browser SVG imports use the Rust importer through a lazy WASM facade and
  reusable worker. The normalized result retains groups, composed transforms,
  styles, fill rules, source assets, embedded assets, warnings, and structured
  failures before one IndexedDB board import.
- Browser SVG exports project the current board into the canonical snapshot,
  render it through the Rust SVG renderer in the shared worker, and preserve
  warnings.

### Changed

- Editor runtime extracted to framework-neutral `@inkfinite/runtime` and
  `@inkfinite/input-dom`; both web and desktop compose the shared
  `@inkfinite/ui/editor` through platform-specific adapters.
- Cursor mapping reimplemented with current-bound coordinate mapping, reactive
  viewport invalidation, and pointer-capture cleanup across resize, scrolling,
  and device-pixel-ratio changes.
- Document model collapsed to a single native model, removing the
  predecessor/current split.
- Desktop ordinary editor updates now use Rust reconciliation instead of
  deleting and recreating the native scene; full mirror replacement remains
  only for structural page and layer changes not yet covered by semantic patches.

### Fixed

- Concurrent merge deterministic repairs: missing parents move to a recovery
  layer, broken bindings are removed, duplicate child references collapse, and
  pages without layers gain a default.
- Invalid documents rejected before any canonical file is changed.
- Recovery data preserved on interrupted writes.
