# Inkfinite TODO

Active implementation work for [ROADMAP.md](ROADMAP.md). Completed work is summarized in
[CHANGELOG.md](CHANGELOG.md); design details belong in the [documentation site](apps/web/src/content/docs/).

## SVG round-trip

Run representative native and fallback SVG fixtures through each complete document workflow. Compare
normalized structure where representation matters and rendered output where visual fidelity matters.

- [ ] Test import through save/reopen, edit/export, undo/redo, and CRDT merge
- [ ] Test imported shapes through CLI inspect, query, and mutation
- [ ] Verify native vectors export without rasterization
- [ ] Verify nested transforms export deterministically
- [ ] Verify compound fill rules survive import and export
- [ ] Verify opaque fallback content remains visually stable
- [ ] Add deterministic round-trip fixtures for these workflows

## Permissioned MCP

### Server and discovery

- [ ] Add `inkfinite-mcp` crate with `rmcp` & its macros
- [ ] Start with stdio transport and expose Inkfinite capability metadata
- [ ] Reuse core query and transaction APIs rather than shelling out to the CLI
- [ ] Discover open sessions and accessible files
- [ ] Inspect document metadata and causal heads
- [ ] Query records by role, kind, parent, and bounds

### Mutations

- [ ] Create, patch, move, reparent, and delete shapes
- [ ] Create and patch layers and containers
- [ ] Apply layout operations and manage connections
- [ ] Import SVG where appropriate
- [ ] Return affected IDs and heads from every mutation
- [ ] Expose dry-run or preview behavior where useful

### Permissions

- [ ] Define read, create, modify, delete, and layout permissions
- [ ] Define per-document and per-session policy
- [ ] Apply `agent_editable` at the MCP boundary
- [ ] Decide hidden-layer visibility policy
- [ ] Decide how ordinary locks interact with MCP permissions
- [ ] Decide whether proposal/review belongs in MCP
- [ ] Return authorization errors separately from validation errors

### Verification and guidance

- [ ] Test read-only and restricted-write sessions
- [ ] Test denied mutations, `agent_editable`, and locks
- [ ] Test stale heads and invalid transactions
- [ ] Update or split the Inkfinite skills for CLI and MCP usage

## Performance profiling

### Corpus and method

- [ ] Build executable small, medium, large, and 10,000-shape fixtures
- [ ] Add vector-heavy, deeply nested, imported-SVG, and connection-heavy fixtures
- [ ] Record reference hardware and benchmark methodology

### Measure

- [ ] Profile open, save, Automerge load, and materialization
- [ ] Profile validation, commit, undo/redo, merge, queries, and memory
- [ ] Profile Canvas frames, culling, hit testing, nested transforms, and path rendering
- [ ] Profile selection overlays and vector-edit previews
- [ ] Profile SVG parse/import/export and common CLI operations
- [ ] Profile local IPC and MCP startup, queries, and mutations

### Optimize from evidence

- [ ] Record baselines, dominant costs, and regression budgets
- [ ] Evaluate spatial indexes, path/render caches, incremental materialization, or alternate
      renderers only when a measured bottleneck supports the change

## Backlog

- [ ] Add boolean paths, gradient editing, clip/mask/filter editing, variable-width strokes, and
      text on path
- [ ] Add a web manifest, service worker, PWA installation, and stronger offline behavior
- [ ] Decide crates.io and desktop release packaging; automate release artifacts
- [ ] Revisit skill organization after SVG and MCP workflows stabilize

### Polish

- [ ] Export SVG as copyable code
- [ ] Export PNG to clipboard
- [ ] Move handle on the layer pane

---

- [ ] Direct Select could be clearer
