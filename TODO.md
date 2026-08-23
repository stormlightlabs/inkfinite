# Inkfinite TODO

## SVG round-trip

Run representative native and fallback SVG fixtures through each complete
document workflow. Compare normalized structure where representation matters
and rendered output where visual fidelity matters.

- [ ] Make the TypeScript browser adapter import SVG files and pasted markup
      through the active Rust document session, page, and layer by default
- [ ] Offer creation of a new document from SVG as a separate editor action
- [ ] Verify and fix TypeScript editor traversal of imported root containers so
      existing child records can be selected, edited, reparented, and deleted independently
- [ ] Test import through save/reopen, edit/export, undo/redo, and CRDT merge
- [ ] Test active-document import and explicit new-document creation end to end
- [ ] Test imported child shapes through editor selection and targeted CLI
      query and mutation
- [ ] Verify native vectors export without rasterization
- [ ] Verify nested transforms export deterministically
- [ ] Verify compound fill rules survive import and export
- [ ] Verify opaque fallback content remains visually stable
- [ ] Add deterministic round-trip fixtures for these workflows

## Richer interoperability and embeds

- [ ] Extend the existing TypeScript JSON Canvas round-trip for new card,
      relationship, frame, and asset fields where the format supports them
- [ ] Add integration fixtures that combine native objects, imported SVG,
      raster assets, and external links
- [ ] Evaluate Mermaid and D2 import against the shared object and relationship
      model before adding a format-specific rendering path
- [ ] Add end-to-end import, edit, and export comparisons for representative
      mixed-format documents

## Stencil and library workflows

- [ ] Serialize and validate reusable selections through Rust document APIs,
      then manage local library storage and UI in TypeScript
- [ ] Add discovery, update, and removal behavior alongside the existing
      built-in stencil palette
- [ ] Preserve nested content, relationships, assets, and metadata when
      inserting user-authored entries
- [ ] Add end-to-end coverage for saving, finding, inserting, and updating a
      local library entry

## Templates and starter boards

- [ ] Add starter documents for blank canvas, system design, brainstorming,
      project planning, moodboards, research maps, and wireframes
- [ ] Build starters as Rust-validated canonical documents from standard
      primitives, roles, relationships, and libraries
- [ ] Add the starter picker and new-board workflow in TypeScript
- [ ] Verify every starter through open, edit, save, reopen, inspect, and export
- [ ] Add end-to-end tests for opening and editing each starter

## Editor polish

- [ ] Standardize hover, pressed, selected, disabled, busy, and focus-visible
      states
- [ ] Standardize menu and popover placement, dismissal, and focus restoration
- [ ] Standardize control heights, icon sizes, spacing, and minimum pointer
      targets
- [ ] Remove controls whose hover state is visually indistinguishable from
      idle
- [ ] Verify menus and popovers remain inside the viewport at editor edges
- [ ] Verify tool changes, selection changes, and viewport actions do not cause
      unintended layout jumps
- [ ] Add Storybook coverage for important component states and combinations
- [ ] Add end-to-end coverage for menus, popovers, focus restoration, and
      viewport-edge placement

## Permissioned MCP

### Server and discovery

- [x] Add `inkfinite-mcp` crate with `rmcp` and its macros
- [x] Start with stdio transport and expose Inkfinite capability metadata
- [x] Reuse core query and transaction APIs rather than shelling out to the CLI
- [x] Discover open sessions and accessible files
- [x] Inspect document metadata and causal heads
- [x] Query records by role, kind, parent, and bounds

### Mutations

- [ ] Create, patch, move, reparent, and delete shapes through Rust MCP tools
- [ ] Create and patch layers, containers, cards, frames, and assets
- [ ] Read and write semantic metadata and typed relationships
- [ ] Apply shared layout operations and manage connections
- [ ] Import SVG and supported interchange formats where appropriate
- [ ] Return affected IDs and heads from every mutation
- [ ] Expose dry-run or preview behavior where useful

### Permissions

- [ ] Define read, create, modify, delete, and layout permissions
- [ ] Define per-document and per-session policy
- [ ] Apply `agent_editable` at the MCP boundary
- [ ] Decide hidden-layer visibility policy
- [ ] Decide how ordinary locks interact with MCP permissions
- [ ] Expose proposal creation and review through MCP when the local session
      permits it
- [ ] Return authorization errors separately from validation errors

### Verification and guidance

- [ ] Test read-only and restricted-write sessions
- [ ] Test denied mutations, `agent_editable`, and locks
- [ ] Test stale heads, invalid transactions, semantic fields, and proposal
      permissions
- [ ] Add end-to-end coverage from MCP proposal creation through desktop review
- [ ] Update or split the Inkfinite skills for CLI and MCP usage

## Performance profiling

### Corpus and method

- [ ] Build executable small, medium, large, and 10,000-shape fixtures
- [ ] Add vector-heavy, deeply nested, imported-SVG, and connection-heavy
      fixtures
- [ ] Record reference hardware and benchmark methodology

### Measure

- [ ] Profile open, save, Automerge load, and materialization
- [ ] Profile validation, commit, undo/redo, merge, queries, and memory
- [ ] Profile Canvas frames, culling, hit testing, nested transforms, and path
      rendering
- [ ] Profile selection overlays and vector-edit previews
- [ ] Profile SVG parse/import/export and common CLI operations
- [ ] Profile local IPC and MCP startup, queries, and mutations

### Optimize from evidence

- [ ] Record baselines, dominant costs, and regression budgets
- [ ] Evaluate spatial indexes, path/render caches, incremental materialization,
      or alternate renderers only when a measured bottleneck supports the
      change

## Backlog

- [ ] Add boolean paths, gradient editing, clip/mask/filter editing,
      variable-width strokes, and text on path
- [ ] Add a web manifest, service worker, PWA installation, and stronger
      offline behavior
- [ ] Decide crates.io and desktop release packaging; automate release
      artifacts
- [ ] Revisit skill organization after SVG and MCP workflows stabilize
- [ ] Export SVG as copyable code
- [ ] Export PNG to clipboard
