# Changelog

## [Unreleased]

### Added

- Automerge-backed Rust document engine with validated atomic transactions, history, undo/redo,
  causal heads, sync, deterministic repair, and native file recovery.
- Shared document model, generated TypeScript contracts, semantic metadata, ordered layers,
  bindings, built-in shapes and stencils, and deterministic SVG/PNG rendering.
- CLI support for file and live-session inspection, queries, validation, structured mutations,
  dry runs, rendering, schemas, and machine-readable output.
- Authenticated desktop IPC with reviewed proposals, ghost previews, partial acceptance, and
  session-scoped direct apply.
- Rust-owned desktop sessions and browser WASM sessions covering create, open, mutate, persist,
  reopen, undo/redo, projection, reconciliation, SVG import, and SVG rendering.
- Static SVG import and export with native primitives and paths, nested transforms, inherited
  paint, retained source assets, and opaque fallback content for unsupported visuals.
- Native path geometry, rendering, hit testing, compound fills, and shared Rust/TypeScript fixtures.
- Hierarchical vector editing with nested selection, world-space transforms, reparenting, direct
  anchor and handle editing, and path topology operations.
- Excalidraw and Obsidian Canvas import/export, offline peer sync, and a bundled agent skill with
  file, proposal, and stale-head examples.

### Changed

- Consolidated the editor into shared UI, runtime, DOM input, renderer, and core packages used by
  desktop and web.
- Moved canonical browser document state and committed geometry operations to Rust while retaining
  low-latency interaction previews in TypeScript.
- Unified the document model and SVG pipeline across desktop, web, WASM, and CLI.

### Fixed

- Rejected malformed documents and transactions before canonical state changes.
- Repaired merge damage deterministically, including missing parents, duplicate child references,
  broken bindings, and pages without layers.
- Corrected cursor mapping, nested-transform hit testing, path preview bounds, pointer capture, and
  persistence recovery behavior.
