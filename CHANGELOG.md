# Changelog

## [Unreleased]

### Added

- Automerge-backed documents with validated atomic transactions, history, undo and redo, causal
  heads, peer sync, deterministic repair, file locking, and recovery.
- Shared Rust document sessions for desktop, browser WebAssembly, CLI, and MCP, with generated
  TypeScript contracts and a common editor projection.
- Native shapes, paths, groups, frames, cards, images, layers, assets, semantic metadata,
  relationships, built-in stencils, and deterministic layout operations.
- Canvas editing with snapping, constraints, nested selection, path anchors and handles,
  duplicate-and-connect, typography controls, and a searchable command palette.
- Shared path metrics and straight, curved, and orthogonal connectors with tangent-aware
  arrowheads, path-relative labels, hit testing, and deterministic export.
- Boolean paths, gradient paints, clips, masks, filters, variable-width strokes, and text on path,
  with editor controls and SVG round-trip coverage.
- SVG import and export with editable native geometry, hierarchy, transforms, compound fills,
  gradients, effects, text paths, embedded images, sanitized fallbacks, and deterministic workflows.
- Excalidraw and Obsidian Canvas import and export, plus deterministic SVG and PNG rendering.
- CLI workflows for inspection, queries, validation, structured mutations, dry runs, rendering,
  schemas, live desktop sessions, and machine-readable output.
- Permissioned local MCP access with scoped reads and mutations, SVG import, layout, causal heads,
  and visual proposal review with partial acceptance.
- A responsive board browser with local persistence, workspace switching, sorting, duplication,
  guarded board changes, storage details, and actionable errors.
- Shared performance fixtures and native, process, renderer-traversal, browser-interaction, and heap
  measurements with recorded methodology, diagnostic traces, and regression ceilings.

### Changed

- Consolidated the web and desktop editors into shared UI, runtime, DOM input, renderer, and core
  packages.
- Unified creation styles across editor, CLI, MCP, stencils, and starter documents, with neutral
  defaults resolved against light and dark canvases.
- Moved canonical browser state and committed geometry operations to Rust while keeping interaction
  previews in TypeScript.
- Unified SVG parsing, transactions, and rendering across desktop, web, CLI, and MCP.
- Made transaction origin provenance-only. Validation, causal checks, record versions, and shape and
  layer locks continue to govern mutations.
- Made general CLI live mutations commit directly after validation; reviewed and permissioned model
  access remains in MCP.
- Cached validated Automerge projections until a local or remote change invalidates them, reducing
  the reference flat 10,000-shape load from about 6.75 seconds to about 3.77 seconds on Apple M1.

### Fixed

- Rejected malformed documents and transactions before canonical state changes.
- Repaired merge damage involving parents, child references, bindings, and missing page layers.
- Corrected cursor mapping, nested-transform hit testing, path preview bounds, pointer capture,
  persistence recovery, menu placement, and browser heap-workload synchronization.
