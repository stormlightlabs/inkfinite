# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop
app, CLI, and programmatic interfaces share one native document model and
transaction engine.

## Current direction

### SVG round-trip

Inkfinite has one validated Rust SVG pipeline across desktop, web, and CLI. It
maps supported geometry into native shapes, preserves hierarchy, transforms,
and compound fills, retains source assets, and reports unsupported content.

The remaining work proves complete document workflows: save and reopen, edit
and export, undo and redo, CRDT merge, and CLI access. Interchange work should
favor deterministic native representation where Inkfinite understands the
content and stable visual fallback where it does not.

See [SVG import](apps/web/src/content/docs/internals/svg-import.md) and
[native path geometry](apps/web/src/content/docs/internals/native-path-geometry.md).

### Editor interaction and visual system

Inkfinite has accumulated most of the editor capabilities it needs, but those
capabilities should be presented through a clearer interaction hierarchy. The
next UI work should simplify the editor rather than add more permanent chrome.

The primary drawing surface should separate tool selection, application-level
actions, and selection-specific controls. Drawing tools remain immediately
available; import, export, and file operations belong to application chrome;
layout and styling appear when the current selection makes them relevant.
Stencils should behave as an insert/library workflow rather than another
drawing tool.

The visual system should also converge on one set of tokens and component
behaviors. Light and dark modes should share the same Inkfinite identity,
with theme-specific contrast adjustments rather than unrelated accent colors.
Borders, elevation, radii, focus states, menus, and popovers should follow the
same rules throughout the editor. Hand-made details can remain part of the
product, but they should accent the canvas instead of competing with basic
interface hierarchy.

Color controls should optimize for common choices first: a small useful
palette and recent colors should remain immediately available, while the full
Reasonable Colors range and arbitrary values can live one level deeper.

Agent-driven editing is a distinguishing Inkfinite workflow and should have
its own visual language. Proposed changes, ordinary selections, and committed
content must remain visually distinct. Proposal review should expose the
affected changes and accept/reject actions as one coherent interaction rather
than as unrelated editor controls.

### Permissioned MCP

Add a local stdio MCP server as the policy-aware interface for model-controlled
access. It should call `inkfinite-core` directly for discovery, queries,
transactions, and results rather than shelling out or creating a second
document API.

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
