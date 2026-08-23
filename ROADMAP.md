# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop
app, CLI, and programmatic interfaces share one native document model and
transaction engine.

The product centers on objects with meaning arranged in two-dimensional space.
A small set of composable geometry, content, structure, and relationship
primitives should support diagramming, sketching, spatial thinking, visual
collection, and agent-assisted editing without separate internal systems for
each workflow.

## Current direction

### SVG round-trip

Inkfinite has one validated Rust SVG pipeline across desktop, web, and CLI. It
maps supported geometry into native shapes, preserves hierarchy, transforms,
and compound fills, retains source assets, and reports unsupported content.

The native transaction already creates a root container and separate records
for supported SVG descendants. The remaining editor work must expose those
children through normal nested selection and ungrouping. Web SVG files and
pasted markup should add content to the active document by default, matching
desktop and CLI behavior. Creating a document from SVG should become a separate
explicit action.

The remaining work proves complete document workflows: save and reopen, edit
and export, undo and redo, CRDT merge, and CLI access. Interchange work should
favor deterministic native representation where Inkfinite understands the
content and stable visual fallback where it does not.

See [SVG import](apps/web/src/content/docs/development/svg-import.md) and
[native path geometry](apps/web/src/content/docs/development/native-path-geometry.md).

### Richer interoperability and embeds

Inkfinite already imports and exports JSON Canvas nodes, groups, labeled edges,
files, links, and supported images. Extend that mapping only when new card,
relationship, frame, or asset fields have a meaningful representation. Mixed
documents still need fixtures that combine native geometry, imported SVG,
raster assets, and external links.

Mermaid or D2 import is useful only when it produces ordinary Inkfinite objects
and structured relationships. Evaluate those mappings before introducing a
format-specific rendering system.

### Stencil and library workflows

Inkfinite already has a searchable, keyboard-accessible palette of built-in
stencils made from ordinary shapes and groups. The next library work lets users
save, find, insert, update, and remove local entries while preserving nested
content, assets, relationships, and semantics. Strong built-ins and composable
primitives take priority over large format-specific stencil packs.

### Templates and starter boards

Once the core workflows are reliable, starter boards can demonstrate system
design, brainstorming, project planning, moodboards, research maps, and
wireframes. They should be standard documents that users can inspect, edit,
export, and repurpose, not substitutes for missing editor behavior.

### Performance profiling

Build a repeatable fixture corpus and measure document, CRDT, renderer,
vector-editing, SVG, CLI, IPC, and MCP workloads on recorded reference
hardware. Set regression budgets from those results.

Add indexes, caches, incremental materialization, or alternate rendering only
when a representative benchmark identifies the cost they address.

## Later

Potential later work includes advanced vector operations, additional
interchange formats, PWA and offline installation, release packaging, richer
agent skills, hosted collaboration, remote MCP, and hosted identity and sync.
