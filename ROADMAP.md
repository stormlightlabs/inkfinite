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

Bindings still need an optional relation type so people and agents can query
typed incoming and outgoing relationships without inferring meaning from
coordinates or visual style.

### Layout operations

Align and distribute already use the shared transaction engine across the
editor and CLI, and the native model can represent stack and grid container
layouts. The next operations are stack, grid, and tidy for ordinary selections.
Add tree and flow layouts once typed connections can guide them, followed by
radial layout where it serves real documents.

New operations need deterministic ordering and spacing rules, must respect
nesting and locks, and must preserve connector attachment and semantic
relationships. They should participate in the normal transaction, undo, merge,
inspection, and stale-head workflows.

### Agent proposal review

Inkfinite already stores proposals against known heads, summarizes operations,
shows created-shape ghosts and affected regions, supports partial acceptance or
rejection, and clears stale proposals. The next review work should replace
generic region outlines with object-specific previews for modifications,
removals, moves, relationships, and metadata.

Additions, modifications, and removals need distinct visual treatment while
remaining separate from ordinary selection. MCP may create proposals when
local policy allows it, while the desktop app remains the place for visual
review.

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
