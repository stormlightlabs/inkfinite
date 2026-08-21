# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop app, CLI, and
programmatic interfaces share one native document model and transaction engine.

## Current direction

### SVG round-trip

Inkfinite has one validated Rust SVG pipeline across desktop, web, and CLI. It maps supported
geometry into native shapes, preserves hierarchy, transforms, and compound fills, retains source
assets, and reports unsupported content. The remaining work proves complete document workflows:
save and reopen, edit and export, undo and redo, CRDT merge, and CLI access.

See [SVG import](apps/web/src/content/docs/internals/svg-import.md) and
[native path geometry](apps/web/src/content/docs/internals/native-path-geometry.md).

### Editor refinement

Bring the editor interface up to the capabilities of the document model. Improve selection,
snapping, keyboard and camera behavior, expose layout operations, and add clipboard and image
workflows that behave like a native drawing application. Frames and bound arrows follow once these
core interactions are consistent across web and desktop.

Selection and movement now support object and grid snapping with alignment and gap guides, angle
constraints, modifier-aware resize and drawing gestures, Alt-drag duplication, hover feedback,
transformed handles, edge scrolling, zoom-to-selection, and stored grid preferences. Layout commands,
selection and canvas context menus, keyboard shortcuts, the searchable `?` panel, clipboard
commands, accessibility states, and editor error reporting are now in place. Remaining editor
refinement work is clipboard content formats, images, frames, and arrow routing.

### Permissioned MCP

Add a local stdio MCP server as the policy-aware interface for model-controlled access. It should
call `inkfinite-core` directly for discovery, queries, transactions, and results rather than
shelling out or creating a second document API.

MCP owns read and write scopes, per-document or per-session policy, `agent_editable`, hidden-layer
visibility, and any optional review workflow. Authorization failures remain separate from document
validation. Remote authentication and network transports are later work.

### Performance profiling

Build a repeatable fixture corpus and measure document, CRDT, renderer, vector-editing, SVG, CLI,
IPC, and MCP workloads on recorded reference hardware. Set regression budgets from those results.
Add indexes, caches, incremental materialization, or alternate rendering only when a representative
benchmark identifies the cost they address.

## Later

Potential later work includes advanced vector operations, additional interchange formats, PWA and
offline installation, release packaging, richer agent skills, hosted collaboration, remote MCP,
and hosted identity and sync.
