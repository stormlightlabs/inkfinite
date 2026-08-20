---
title: Internals
description: "How Inkfinite's Rust document engine, TypeScript editor, desktop bridge, renderer, and CLI fit together."
section: Concepts
group: Concepts
order: 10
---

Inkfinite has one durable document model and a separate editor-facing projection. Rust owns the
canonical document, transactions, Automerge state, native files, headless rendering, and desktop
sessions. TypeScript owns interactive editor state, tools, browser input, and Canvas rendering.

The boundary between them is intentional: the editor can keep pointer movement and gesture previews
local, while completed desktop edits still commit through the same Rust transaction engine used by
the CLI.

## Architecture

```text
Browser app ───────┐
                   ├── @inkfinite/ui
Desktop frontend ──┘        │
                            ├── @inkfinite/runtime ── @inkfinite/core
                            ├── @inkfinite/input-dom
                            └── @inkfinite/renderer ── Canvas 2D

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

See [Web editor](/docs/applications/web/) and [Desktop editor](/docs/applications/desktop/) for the
application-specific behavior.

## Durable model and editor projection

The most important internal distinction is between the Rust document contract and the TypeScript
editor model.

`inkfinite-core` is the durable authority. Its shapes have a registry `kind`, a parent relation, a
parent-relative transform, ordered container children, kind-specific properties, semantic metadata,
common style, and a record version. Pages own ordered layers; layers own ordered root shapes.
Containers can own nested shapes and optionally apply free, stack, or grid layout.

`@inkfinite/core` is the interactive projection used by tools and Canvas rendering. It keeps the
shape data in the form the current editor expects: page and layer draw-order arrays, shape `x`/`y`
coordinates, rotation, optional grouping and layer IDs, and shape-specific properties. It also owns
editor geometry, actions, tools, stencils, interchange helpers, and browser-side persistence
utilities.

These are not two canonical file formats. The desktop and browser persistence adapters translate
between the generated Rust contracts in `@inkfinite/bindings` and the editor projection returned by
Rust sessions. The frontend keeps the projected state for low-latency interaction; Rust remains
authoritative for the native session and `.inkfinite` file.

For the durable record structure, see [Documents](/docs/concepts/documents/). The [native path
geometry guide](/docs/internals/native-path-geometry/) documents the path representation used by
SVG interoperability and future vector editing. The [SVG import guide](/docs/internals/svg-import/)
documents the parser's native mappings, transform rules, styles, text behavior, and asset handling.
The [testing guide](/docs/internals/testing/) documents shared fixtures and focused verification.

## Edit flow

`@inkfinite/runtime` is a framework-neutral interaction state machine. It routes normalized actions
through camera and tool state, applies gesture previews to the editor store, and emits a transaction
draft when an interaction reaches a commit boundary such as pointer-up or an explicit editor commit.

A desktop document edit follows this path:

```text
DOM input
   ↓
@inkfinite/input-dom
   ↓
@inkfinite/runtime
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
| `packages/bindings`      | Generated TypeScript contracts derived from Rust; do not edit these by hand                                               |
| `packages/core`          | Editor-facing model, geometry, actions, tools, stencils, interchange, and browser-side utilities                          |
| `packages/runtime`       | Framework-neutral interaction state machine and transaction-draft boundaries                                              |
| `packages/input-dom`     | Normalizes browser pointer, keyboard, wheel, and viewport input for the runtime                                           |
| `packages/renderer`      | Canvas 2D scene rendering, selection overlays, viewport culling, and layout caches                                        |
| `packages/ui`            | Shared Svelte editor, panels, controls, themes, and UI components                                                         |
| `apps/web`               | Browser composition root, documentation site, and IndexedDB-backed editor persistence                                     |
| `apps/desktop`           | Desktop composition root and TypeScript adapter for Tauri-owned native document sessions                                  |

The Rust workspace contains `inkfinite-core`, `inkfinite-cli`, and the Tauri crate. The pnpm
workspace contains the shared packages plus the web and desktop application roots.

## Rendering

Interactive rendering is Canvas 2D. `@inkfinite/renderer` subscribes to the editor store, marks the
canvas dirty when state changes, and draws on the next animation frame. It maps the camera into world
coordinates, culls shapes outside an expanded viewport, and keeps bounded caches for text and
Markdown layout. Selection handles, binding previews, and snapping guides are rendered from
editor-only state and are not durable document records.

Headless rendering is separate. `inkfinite-core` renders the durable document directly to
deterministic SVG for CLI output, fixtures, and inspection. This keeps headless output independent
of the browser renderer.

## Desktop sessions and CLI

The Tauri backend owns native desktop document sessions. A session contains the Rust-owned document
state and exposes typed commands for snapshots, commits, undo/redo, saves, queries, validation,
proposal handling, and peer sync. The TypeScript desktop adapter invokes those commands and updates
its editor projection from returned session state.

The CLI calls the same Rust core for closed-file operations. For open desktop documents it uses the
authenticated local IPC protocol exposed by the Tauri process rather than racing the desktop file
writer.

The current implementation also carries agent access and proposal policy through the Rust protocol
and transaction policy. See [Command-line interface](/docs/reference/cli/) and
[Agent workflows](/docs/reference/agents/) for the supported commands and review flow.

## Files and generated contracts

Canonical desktop files are Automerge-backed `.inkfinite` documents. Rust owns native reads,
validation, file locking, recovery state, and atomic replacement. JSON is an inspection projection;
SVG, PNG, Excalidraw, and Obsidian Canvas are interchange or presentation formats rather than
alternate native documents. See [File format](/docs/reference/file-format/) for the user-facing
format contract.

Rust types are serialized with Serde, described with Schemars, and exported to TypeScript with
`ts-rs`. `pnpm bindings:generate` regenerates `@inkfinite/bindings`, while `pnpm bindings:check`
verifies that checked-in generated contracts still match Rust.

This generated boundary is used for document, transaction, protocol, and browser WASM payloads. The
hand-written `@inkfinite/core` editor types remain a separate interaction-oriented representation.
