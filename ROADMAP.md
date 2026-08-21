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
