---
title: Architecture
description: "How Inkfinite's Rust document engine, TypeScript editor, desktop bridge, renderer, and CLI fit together."
section: Development
group: Development
order: 18
---

Inkfinite has one canonical document model and a separate editor-facing projection. Rust owns the
canonical document, transactions, Automerge state, native files, headless rendering, and desktop
sessions. TypeScript owns interactive editor state, tools, browser input, and Canvas rendering.

The boundary between them is intentional: the editor can keep pointer movement and gesture previews
local, while completed desktop edits still commit through the same Rust transaction engine used by
the CLI.

## Implemented foundation

The current system includes:

- an Automerge-backed Rust document engine with validated atomic transactions, history, undo and
  redo, causal heads, sync, deterministic repair, and native file recovery
- generated TypeScript contracts, semantic metadata, ordered layers, bindings, built-in shapes, and
  stencils shared across interfaces
- deterministic SVG and PNG rendering, static SVG import and export, and native path geometry with
  hierarchy editing
- native desktop files, browser WASM sessions, and shared editor, runtime, input, and renderer
  packages
- CLI workflows for file and live-session inspection, queries, validation, structured mutations,
  dry runs, rendering, schemas, and machine-readable output

The linked pages in this section describe these components in detail. Start with [Documents](/docs/concepts/document-model/)
for the record model, [Transactions and sync](/docs/concepts/transactions-and-sync/) for commits and
merges, [SVG import](/docs/development/svg-import/) for interchange, and [Native path geometry](/docs/development/native-path-geometry/)
for vector editing.

## Architecture

```text
Browser app ───────┐
                   ├── @inkfinite/ui
Desktop frontend ──┘        │
                            └── @inkfinite/editor ── @inkfinite/core
                                      │
                                      ├── DOM input
                                      ├── interaction runtime
                                      └── Canvas 2D renderer

Desktop frontend
      │ generated contracts + Tauri commands
      ▼
Tauri backend ── inkfinite-core ── Automerge / .inkfinite
      │                 │
      │                 ├── transactions + validation
      │                 ├── queries + history
      │                 ├── deterministic SVG rendering
      │                 ├── files + recovery
      │                 └── sync + IPC
      │
      └── authenticated local IPC ── inkfinite CLI
```

The web and desktop applications share the editor UI and interaction packages, but they do not use
the same persistence adapter. The web editor persists its editor document in IndexedDB. The desktop
editor projects the Rust-owned native document into editor state and sends completed document edits
back through Tauri.

See [Web editor](/docs/platforms/web/) and [Desktop editor](/docs/platforms/desktop/) for the
application-specific behavior.

## Dependency direction and model ownership

Rust owns the canonical document and all operations that can change it. `inkfinite-core` defines
`Document`, `ShapeRecord`, `PageRecord`, `LayerRecord`, and `BindingRecord`, validates them, applies
transactions, and owns Automerge state, native files, sessions, and headless rendering.

The binding generator is the only path from those Rust contracts to TypeScript contract types:

```text
inkfinite-core Rust model and services
        │
        └── generate-bindings ──> @inkfinite/bindings
                                      │
                                      └── generated snapshots, projections, patches, and protocols
```

`@inkfinite/core/src/editor-model.ts` owns the interactive model. Its public records are named
`EditorDocument`, `EditorShapeRecord`, `EditorPageRecord`, `EditorLayerRecord`, and
`EditorBindingRecord` so they cannot be mistaken for the generated Rust records. These values use
editor property names, world-space transforms, flat draw order, and the mutable shape union needed
by tools and Canvas rendering. They are not another serialized document contract.

`@inkfinite/core/src/persistence/canonical.ts` is the TypeScript adapter boundary. It converts Rust
snapshots and generated Rust editor projections into the interactive model, and turns completed
editor changes into generated `EditorPatch` requests. Browser and desktop adapters call this module
instead of translating records themselves. The adapter preserves native property names and
hierarchy only at the Rust boundary; it does not write `.inkfinite` bytes.

The package dependency direction is:

```text
@inkfinite/bindings ──> @inkfinite/core/editor-model + canonical adapter
                                  │
                                  └──> @inkfinite/editor ──> @inkfinite/ui ──> web and desktop apps

Rust inkfinite-wasm ──> web app persistence adapter
Rust Tauri commands ──> desktop app persistence adapter
```

`@inkfinite/editor` owns normalized input, interaction state, commands, and Canvas rendering. The
UI package owns Svelte presentation and inspector controls. Applications own browser storage,
filesystem access, Tauri or WASM calls, and composition. No UI, editor runtime, or application code
owns canonical records or applies native transactions directly.

For the record structure, see [Document model](/docs/concepts/document-model/). The [native path
geometry guide](/docs/development/native-path-geometry/) documents the path representation used by
SVG interoperability and vector editing. The [SVG import guide](/docs/development/svg-import/)
documents the parser's native mappings, transform rules, styles, text behavior, and asset handling.
The [testing guide](/docs/development/testing/) documents shared fixtures and focused verification.
[Performance corpus and profiling](/docs/development/performance-corpus/) describes the native,
process, renderer, and browser measurement layers.

## Edit flow

`@inkfinite/editor/runtime` is a framework-neutral interaction state machine. It routes normalized
actions through camera and tool state, applies gesture previews to the editor store, and emits a
transaction draft when an interaction reaches a commit point such as pointer-up or an editor commit.

A desktop document edit follows this path:

```text
DOM input
   ↓
@inkfinite/editor/input-dom
   ↓
@inkfinite/editor/runtime
   ↓
editor-state preview
   ↓ completed gesture
runtime transaction draft
   ↓
desktop persistence adapter
   ↓
Rust TransactionDraft
   ↓
Tauri command
   ↓
inkfinite-core transaction engine
   ↓
Automerge change + validated snapshot
   ↓
updated editor projection
```

The Rust transaction engine checks schema and preconditions, validates document policy and
invariants, applies the operations to Automerge state, materializes and validates the result, and
returns the new heads plus the affected records and regions. A rejected transaction does not partly
modify the native document.

Causal heads and record versions are used for optimistic concurrency. See
[Transactions and sync](/docs/concepts/transactions-and-sync/) for the public transaction model.

## Codebase map

| Unit                     | Responsibility                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `crates/inkfinite-core`  | Data model, transaction engine, Automerge integration, files, queries, sessions, sync, IPC, and headless rendering        |
| `crates/inkfinite-cli`   | `inkfinite` command parsing, human/JSON output, file-mode operations, live desktop control, and binding/schema generation |
| `apps/desktop/src-tauri` | Tauri command surface and native application integration around `inkfinite-core`                                          |
| `packages/bindings`      | Generated TypeScript contracts derived from Rust. Do not edit these by hand                                               |
| `packages/core`          | Editor-facing model, geometry, actions, tools, stencils, interchange, and browser-side utilities                          |
| `packages/editor`        | DOM input normalization, interaction state, transaction drafts, and Canvas 2D rendering                                   |
| `packages/ui`            | Shared Svelte editor, panels, controls, themes, and UI components                                                         |
| `apps/web`               | Browser composition root, documentation site, and IndexedDB-backed editor persistence                                     |
| `apps/desktop`           | Desktop composition root and TypeScript adapter for Tauri-owned native document sessions                                  |

The Rust workspace contains `inkfinite-core`, `inkfinite-cli`, `inkfinite-mcp`,
`inkfinite-wasm`, the Tauri crate, and `xtask`. The pnpm workspace contains the shared packages
plus the web and desktop application roots.

## Rendering

Interactive rendering is Canvas 2D. `@inkfinite/editor/renderer` subscribes to the editor store,
marks the canvas dirty when state changes, and draws on the next animation frame. It maps the camera
into world coordinates, culls shapes outside an expanded viewport, and keeps fixed-size caches for
text and Markdown layout. Selection handles, binding previews, and snapping guides are rendered from
editor-only state and are not native document records.

Headless rendering is separate. `inkfinite-core` renders the canonical document directly to
deterministic SVG for CLI output, fixtures, and inspection. This keeps headless output independent
of the browser renderer.

## Desktop sessions, CLI, and MCP

The Tauri backend owns native desktop document sessions. A session contains the Rust-owned document
state and exposes typed commands for snapshots, commits, undo/redo, saves, queries, validation,
proposal handling, and peer sync. The TypeScript desktop adapter invokes those commands and updates
its editor projection from returned session state.

The CLI calls the same Rust core for closed-file operations. For open desktop documents it uses the
authenticated local IPC protocol exposed by the Tauri process rather than racing the desktop file
writer.

The local `inkfinite-mcp` stdio server also uses the core transaction and query APIs. It discovers
open sessions through authenticated desktop IPC and opens only the standalone files supplied to the
process. MCP applies source-specific permissions before core validation and can submit proposals to
an open desktop session for review.

The Rust protocol supports direct live commits and optional proposals. See
[Command-line interface](/docs/automation/cli/) and [Agent workflows](/docs/automation/agents/) for
the supported commands, MCP policy, and review flow.

## Files and generated contracts

Canonical desktop files are Automerge-backed `.inkfinite` documents. Rust owns native reads,
validation, file locking, recovery state, and atomic replacement. JSON is an inspection projection.
SVG, PNG, Excalidraw, and Obsidian Canvas are interchange or presentation formats rather than
alternate native documents. See [File format](/docs/reference/file-format/) for the user-facing
format contract.

Rust types are serialized with Serde, described with Schemars, and exported to TypeScript with
`ts-rs`. `pnpm bindings:generate` regenerates `@inkfinite/bindings`, while `pnpm bindings:check`
verifies that checked-in generated contracts still match Rust.

This generated boundary is used for document, transaction, protocol, and browser WASM payloads. The
hand-written `@inkfinite/core` `Editor*` types remain a separate interaction-oriented
representation; `persistence/canonical.ts` is the only adapter between the two.
