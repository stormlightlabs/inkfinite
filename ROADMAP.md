# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop
app, CLI, MCP server, and web application share one native document model and
transaction engine.

The product centers on meaningful objects arranged in two-dimensional space.
A small set of composable geometry, content, structure, and relationship
primitives should support diagramming, sketching, spatial thinking, visual
collection, and agent-assisted editing without separate internal systems for
each workflow.

The roadmap prioritizes interoperability, editor usability, architectural
clarity, distribution, and performance before large libraries of templates or
format-specific content.

## Current: richer interoperability

JSON Canvas support maps external data onto ordinary Inkfinite objects,
relationships, frames, cards, references, and assets. The TypeScript converter
follows JSON Canvas 1.0: file and link nodes remain editable references, group
labels and background paths become frame fields, and native image assets export
as file nodes with a warning because the format stores paths rather than bytes.
Mixed-document fixtures cover frames, cards, imported raster assets, external
links, and bound relationships.

Mermaid and D2 flowchart imports map their supported nodes, edges, labels,
groups, and styles to ordinary Markdown cards, frames, and bound arrows. Each
import runs through the shared flow-layout pipeline. Unsupported shapes become
rectangular cards; unsupported directives and assets are omitted with a warning.
The supported syntax and fallback rules are documented in
[Interoperability](/docs/reference/interoperability/) and covered by fixtures.

## Current: web installation and export workflows

### Clipboard interoperability

Selections and current-page documents can be copied as canonical SVG markup.
Inkfinite writes vector and plain-text clipboard representations when the
browser supports them and shows the markup when it cannot access the clipboard.
Selections and current-page documents can also be rasterized as PNG, with an
explicit transparent-background option. When platform image clipboard APIs are
unavailable, Inkfinite downloads the PNG instead.

### PWA and offline operation

The web editor is installable and keeps using Inkfinite's normal local document
repository. Its service worker caches the application shell, WebAssembly
runtime, and required static assets. Creating, editing, reopening, and exporting
local documents works without a network connection.

The app requests persistent browser storage when the platform supports it. A
waiting service worker shows an update prompt and activates only when the user
chooses to reload, so cached application code does not become an invisible
second deployment state.

## Current: architecture consolidation

Recent interoperability, vector-editing, rendering, and WASM work has expanded
the editor without requiring a new architecture. Before growing the public API
and release surface further, consolidate the existing boundaries so each layer
has one clear responsibility.

Rust remains the owner of the canonical document model, validation,
transactions, geometry, projection, and reconciliation. TypeScript provides the
ergonomic interactive editor model and pure editor operations. The editor
package owns input, interaction state, and Canvas rendering. The UI package
owns presentation, while applications own browser, desktop, filesystem, and
other platform effects.

### Document and editor model boundaries

Make the distinction between the canonical Rust document, the generated Rust
editor projection, and the ergonomic TypeScript editor model explicit in names,
modules, and documentation.

Keep conversion between canonical and interactive representations behind a
small projection/reconciliation boundary. Generated bindings remain generated
contracts rather than a second hand-maintained model.

### Core package boundaries

Keep `@inkfinite/core` headless and platform-independent. Move browser-specific
canvas rasterization, clipboard, filesystem, and UI contracts to the editor,
UI, or application packages that own those concerns.

Expose intentional package entry points for major capabilities rather than
using one broad root barrel as the primary internal dependency surface.

### Editor decomposition

Keep the existing editor architecture while splitting large implementation
modules by responsibility.

Separate renderer lifecycle and scene traversal from shape drawing, text and
asset rendering, effects, and editor overlays. Keep shape dispatch exhaustive
and centralized rather than introducing a renderer class hierarchy.

Reduce the editor runtime to interaction state, command routing, and transaction
boundaries. Keyboard shortcuts, host requests, and reusable document commands
should be independently testable and shared by keyboard, menu, command-palette,
and context-menu entry points.

Break large inspector components into capability-focused sections without
moving domain behavior into Svelte components.

### Rust module organization

Keep `inkfinite-core` as one cohesive crate rather than introducing additional
crates solely for organization.

Move canonical contract definitions out of `lib.rs` into focused model modules
while preserving stable public re-exports. Split editor projection and
reconciliation internally while retaining their existing public boundary.

This work should remain behavior-preserving. Refactoring is complete when the
dependency direction is easier to explain, package imports communicate intent,
and adding a new shape, command, renderer behavior, or platform feature has an
obvious home.

## Distribution

Inkfinite should be releasable before its release process is heavily
automated.

Define the public Rust package surface, crates.io publication order, desktop
platform matrix, and CLI/MCP binary distribution. Keep a documented manual
release checklist and small reproducible build scripts.

GitHub Releases should eventually contain desktop, CLI, and MCP artifacts with
checksums. Publish the intended Rust packages to crates.io. Add automation where
manual repetition becomes expensive rather than making it a prerequisite for
the first useful release candidate.

## Later: reusable content

### User libraries

Built-in stencils already demonstrate reusable ordinary Inkfinite objects.
Later library work should let users save, find, insert, update, and remove their
own selections while retaining nested content, assets, relationships, and
semantics.

Libraries remain ordinary document fragments validated by the shared native
document APIs.

### Starter boards

Starter boards can eventually demonstrate workflows such as system design,
brainstorming, project planning, moodboards, research maps, and wireframes.

They should be ordinary inspectable documents assembled from the same
primitives available to users and agents. Templates should demonstrate a
capable editor rather than compensate for missing primitives or editing
behavior.

## Later: agent and hosted capabilities

Revisit skill organization once CLI and permissioned MCP workflows have
stabilized. Skills should compose stable Inkfinite capabilities rather than
becoming another command or document layer.

Hosted collaboration, remote MCP, identity, and hosted sync remain separate
future concerns. They should not complicate the local document model or local
editor architecture prematurely.
