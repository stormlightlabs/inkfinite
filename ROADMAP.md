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

See [SVG import](apps/web/src/content/docs/internals/svg-import.md) and
[native path geometry](apps/web/src/content/docs/internals/native-path-geometry.md).

### Canvas interaction quality

Inkfinite supports duplicate-and-drag and duplicate-and-connect, selection
cycling for overlapping and nested objects, snapping and guides, keyboard nudging,
fit-to-drawing and fit-to-selection, grouping, nested selection, connector
labels and endpoint reassignment, and text and Markdown editing. A searchable
command palette exposes the selection and viewport actions. Connector routing
now uses deterministic obstacle-aware orthogonal paths in Rust and in TypeScript
previews. Rectangle and ellipse conversion is a native transaction exposed
through selection commands, preserving shared style, metadata, hierarchy,
transform, and identity.

### Stronger content primitives

Inkfinite has native containers and frames, Markdown blocks, image records backed
by separate assets, image paste and drop, non-destructive crop, reusable built-in
card stencils, image captions, and display masks. Image assets are content
addressed and can be reused from the TypeScript selection controls. Captions and
masks survive the native validation and SVG export paths. The editor can sample
an image palette, copy sampled colors, and arrange selections in a deterministic
grid.

URL, file, and page references are native reference shapes with typed targets,
validation, SVG/canvas rendering, reference stencils, and selection controls.
Cards, frames, images, assets, and references use the same document projection,
transaction reconciliation, undo history, merge handling, inspection, and export
workflows.

### Semantic objects and relationships

The native model, CLI, and editor projection carry object names, roles, tags,
descriptions, provenance, user-defined sources, and structured metadata. The
selection controls expose those fields for ordinary objects, show provenance
for a single selection, and keep metadata through conversion, grouping,
duplication, and SVG export where the format has a representation.

Bindings carry an optional relation type for semantic connections. Rust, the
CLI, and the editor projection preserve the type and shape references. Queries
can select typed bindings and filter their incoming or outgoing shape, while
visual routing validation remains separate from relationship-reference
validation.

### Layout operations

Align, distribute, stack, grid, and tidy use the shared transaction engine
across the editor and CLI. Selection layout orders shapes by world-space bounds,
works across layers and nested parents, translates nested shapes in their local
coordinate systems, and treats locked objects as fixed anchors. Grid and tidy
use deterministic row-major placement with spacing derived from the selection.

Layout changes move ordinary shape records only. Connector endpoints and
semantic relationship bindings retain their shape references and attachment
metadata, and all layout operations use the normal transaction, undo, merge,
inspection, and stale-head workflows.

#### Graph layout

Use an Inkfinite-owned deterministic adapter rather than adding a Graphviz
runtime to native and browser builds. This keeps the layout behavior in the
shared document model and avoids separate native and WebAssembly engine
integrations. The document model, transaction engine, CLI, MCP, and editor
must depend only on the Inkfinite graph layout contract.

Build a small internal layout graph from selected shapes, their measured
world-space bounds, and explicit structured connections. Nodes and edges must be
ordered deterministically before layout. Graph layout must not infer semantic
relationships from visual proximity or connector geometry.

Support these layouts initially:

- `flow`: layered placement with top-to-bottom and left-to-right directions.
- `tree`: layered placement with stable relationship ordering and tree-oriented
  rank handling.
- `radial`: concentric placement after flow and tree behavior is stable.

Use the layout adapter only to determine node placement. Connector routing,
rendering, graph storage, and SVG output remain Inkfinite concerns. After node
positions change, Inkfinite's obstacle-aware connector router continues to
produce native editable connector paths.

The Inkfinite graph layout contract contains stable shape IDs, node dimensions,
structured edges, layout options, and returned positions. Normalize returned
coordinates into Inkfinite world coordinates and preserve a predictable
selection origin so applying layout does not unnecessarily move the selection
across the canvas.

Native and browser adapters must use the same graph contract and produce
equivalent normalized layouts for the same fixtures. Do not add unsafe FFI or a
separate browser engine for the initial implementation.

Graph layout results must become ordinary Inkfinite transactions. Applying a
layout must preserve object identity, hierarchy, semantic metadata, bindings,
connector attachment, undo/redo behavior, CRDT merge behavior, and stale-head
validation.

Add deterministic fixtures covering chains, branching trees, multiple roots,
diamonds, cycles, disconnected components, different node dimensions, nested
shapes, and connection-heavy selections. Define behavior for locked shapes,
cycles in tree mode, relationships crossing the selected subgraph, and
unsupported graph structures.

Treat force-directed, stress, circular, packing, and constraint-based layouts
as later extensions. They should reuse the Inkfinite graph layout contract and
transaction boundary rather than introducing engine-specific document concepts.

### Agent proposal review

Inkfinite stores proposals against known heads, summarizes operations, and
supports partial acceptance or rejection while clearing stale proposals. The
review surface now receives Rust-owned before/after records for every affected
object, including shapes, bindings, layers, pages, and assets. The canvas uses
those records and world bounds to preview additions, modifications, moves, and
removals; relationships are shown as labeled proposal connectors.

The review panel lists object-level changes and changed metadata or relationship
fields alongside the operation summary. Additions, modifications, moves, and
removals use separate visual tokens and remain separate from ordinary
selection. MCP may create proposals when local policy allows it, while the
desktop app remains the place for visual review.

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

### Board management

The board browser already creates, searches, opens, renames, inspects, and
deletes boards, and desktop builds expose workspaces and recent files. The next
pass should make the active board, storage location, save state, ordering, and
failures apparent, add duplication, and protect switches when pending changes
cannot be flushed.

The interface must also work well with large collections, keyboards, narrow
viewports, and coarse pointers. User-facing board details should remain easy to
scan while file, schema, and document diagnostics stay available when needed.

### Editor polish

The editor already separates drawing tools, application actions, contextual
selection controls, and library insertion. After the workflows above settle,
finish the consistency pass across control states, menus, popovers, pointer
targets, viewport edges, and Storybook examples. Light and dark themes should
continue to use the shared Inkfinite tokens with theme-specific contrast.

### Permissioned MCP

Add a local stdio MCP server as the policy-aware interface for model-controlled
access. It should call `inkfinite-core` directly for discovery, queries,
transactions, semantic relationships, layout, proposals, and results rather
than shelling out or creating a second document API.

MCP owns read and write scopes, per-document or per-session policy,
`agent_editable`, hidden-layer visibility, and any optional review workflow.
Authorization failures remain separate from document validation. Remote
authentication and network transports are later work.

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
