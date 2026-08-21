# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop app, CLI, and
programmatic interfaces share one native document model and transaction engine.

Active implementation work is in [TODO.md](TODO.md). Completed work is summarized in
[CHANGELOG.md](CHANGELOG.md), with architecture and behavior documented on the
[documentation site](apps/web/src/content/docs/).

## Current direction

### SVG round-trip

Inkfinite has one validated Rust SVG pipeline across desktop, web, and CLI. Native paths,
transforms, compound fills, imported hierarchy, static fallbacks, and deterministic rendering are
implemented. The remaining work proves complete document workflows: save and reopen, edit and
export, undo and redo, CRDT merge, CLI access, and visual stability of fallback content.

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

## Completed foundation

Inkfinite now has an Automerge-backed Rust document engine, generated TypeScript contracts,
deterministic SVG rendering, native desktop files, browser WASM sessions, shared editor/runtime
packages, unrestricted CLI file and live workflows, SVG import/export, and native hierarchical path
editing.
The changelog gives the release-level summary; the docs site owns implementation and usage detail.

## Engineering principles

- Rust owns the document model, validation, transaction engine, native persistence, and headless
  rendering.
- TypeScript owns low-latency interaction, previews, browser input, and Canvas rendering.
- All committed mutations use the validated transaction path.
- Keep document correctness separate from caller authorization.
- Complete save/reopen, undo/redo, merge, inspection, and export workflows before widening a
  feature's surface.
- Prefer shared fixtures and measured optimization over duplicated assertions or speculative
  architecture.

## Later

Potential later work includes advanced vector operations, additional interchange formats, PWA and
offline installation, release packaging, richer agent skills, hosted collaboration, remote MCP,
and hosted identity and sync.
