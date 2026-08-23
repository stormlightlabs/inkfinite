# Changelog

## [Unreleased]

### Added

- Automerge-backed Rust document engine with validated atomic transactions, history, undo/redo,
  causal heads, sync, deterministic repair, and native file recovery.
- Shared document model, generated TypeScript contracts, semantic metadata, ordered layers,
  bindings, built-in shapes and stencils, and deterministic SVG/PNG rendering.
- CLI support for file and live-session inspection, queries, validation, structured mutations,
  dry runs, rendering, schemas, and machine-readable output.
- Authenticated desktop IPC with direct live mutation and editor control.
- Rust-owned desktop sessions and browser WASM sessions covering create, open, mutate, persist,
  reopen, undo/redo, projection, reconciliation, SVG import, and SVG rendering.
- Static SVG import and export with native primitives and paths, nested transforms, inherited
  paint, retained source assets, and opaque fallback content for unsupported visuals.
- Native path geometry, rendering, hit testing, compound fills, and shared Rust/TypeScript fixtures.
- Hierarchical vector editing with nested selection, world-space transforms, reparenting, direct
  anchor and handle editing, path topology operations, selection cycling, duplicate-and-connect,
  shape conversion, and a searchable command palette.
- Selection refinement with object, equal-gap, handle, and grid snapping guides, modifier-aware
  movement and drawing constraints, Alt-drag duplication, hover feedback, transformed handles,
  edge scrolling, zoom-to-selection, and persisted grid preferences.
- Deterministic align, distribute, stack, grid, tidy, tree, flow, and radial layout operations,
  with locked anchors and preserved connector and relationship references.
- Editable cards, ordered presentation frames, reusable image assets with captions, masks, color
  sampling, and native URL, file, and page references.
- Semantic names, roles, tags, descriptions, sources, structured metadata, and typed relationships
  across the model, editor, CLI, conversion, layout, inspection, merge, and export paths.
- Titled frames with child containment, move-with-contents behavior, nested selection, frame export,
  binding-aware arrows, curved, elbow, and obstacle-aware routing, bend controls, labels, automatic
  endpoint updates, and binding-preserving copy and persistence.
- Visual agent proposal review with object and relationship previews, partial acceptance, rejection,
  stale-head handling, and distinct added, changed, moved, and removed states.
- Permissioned local MCP access to files and desktop sessions, with scoped reads and mutations,
  dry runs, SVG import, layout, causal heads, and reviewed proposals.
- A responsive, keyboard-accessible board browser with sorting, storage and save details, workspace
  switching, duplication, guarded board changes, actionable errors, and user-focused inspection.
- Excalidraw and Obsidian Canvas import/export, offline peer sync, and a bundled CLI and MCP agent
  skill with file, proposal, and stale-head examples.

### Changed

- Consolidated the editor into shared UI, runtime, DOM input, renderer, and core packages used by
  desktop and web.
- Moved canonical browser document state and committed geometry operations to Rust while retaining
  low-latency interaction previews in TypeScript.
- Unified the document model and SVG pipeline across desktop, web, WASM, CLI, and MCP.
- Standardized editor control states, sizing, pointer targets, and viewport-aware menu and popover
  behavior, with Storybook and end-to-end coverage.
- Made transaction origin provenance-only in the document engine. CLI queries and mutations can
  access invisible-layer and `agent_editable: false` records while causal checks, validation,
  atomic commit, and ordinary shape and layer locks continue to apply.
- Removed Review/Direct session authorization and proposal commands from the general CLI.
  Structured live mutations and `app apply` now commit after validation.

### Fixed

- Rejected malformed documents and transactions before canonical state changes.
- Repaired merge damage deterministically, including missing parents, duplicate child references,
  broken bindings, and pages without layers.
- Corrected cursor mapping, nested-transform hit testing, path preview bounds, pointer capture, and
  persistence recovery behavior.
