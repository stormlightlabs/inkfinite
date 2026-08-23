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

## Canvas interaction quality

Make common drawing and editing operations fast, predictable, and consistent
across mouse, touch, and keyboard input.

### Selection and direct manipulation

- [x] Add duplicate-and-connect alongside the existing duplicate-and-drag flow
- [x] Add selection cycling for overlapping and nested shapes
- [x] Add a searchable command palette for existing selection and viewport
      commands

### Connectors and conversion

- [x] Implement deterministic obstacle-aware connector routing in Rust and use
      it for TypeScript interaction previews
- [x] Implement shape conversion as a Rust transaction and expose it through
      TypeScript selection commands without losing shared style or metadata
- [x] Cover duplicate-and-connect, selection cycling, command execution, and
      automatic routing with Playwright integration tests

## Stronger content primitives

### Cards and frames

- [x] Turn the existing TypeScript card stencil into editable card behavior
      built from ordinary Rust container, content, and semantic records
- [x] Add card title, body, role, tags, source, link, and custom metadata to the
      native model and generated bindings, then expose TypeScript controls
- [x] Convert cards to and from simpler content objects without losing content
- [x] Add persisted frame ordering and export behavior in Rust, with
      presentation and navigation controls in TypeScript

### Images, assets, and rich content

- [x] Add image caption and mask properties, validation, and export in Rust,
      with reusable-asset and editing controls in TypeScript
- [x] Add TypeScript color sampling controls for image selections; use the
      shared grid layout operation for arrangement
- [x] Add native URL, file, and page-reference content with TypeScript editor
      rendering and controls where practical
- [x] Verify new card, frame, and asset behavior through save/reopen, undo/redo,
      merge, inspection, and export
- [x] Add end-to-end coverage for the new card, frame, and asset workflows

## Semantic objects and relationships

Keep semantics optional while making mature documents queryable by people,
the CLI, and agents.

### Object metadata

- [x] Project existing Rust names, roles, tags, descriptions, and provenance
      into TypeScript editor selection controls
- [x] Add optional user-defined source and structured metadata to the Rust model
      and generated bindings
- [x] Preserve semantic fields in the TypeScript editor projection and through
      conversion, grouping, duplication, import, and export where supported

### Semantic connections

- [x] Add an optional relation type to Rust binding records and generated
      bindings
- [x] Query incoming, outgoing, and typed relationships in Rust without
      inferring them from coordinates
- [x] Validate dangling or invalid relationship references separately from
      visual routing
- [x] Add model, CLI, and editor integration tests for typed relationships

## Layout operations

Treat layout as an operation that updates ordinary editable objects rather than
as a permanent graph constraint.

### Selection layout

- [x] Add deterministic Rust stack operations beside the existing shared align
      and distribute commands, then expose them in TypeScript
- [x] Add Rust grid and tidy operations for mixed selections and TypeScript
      controls and previews
- [x] Define deterministic spacing, ordering, nesting, and locked-object rules
- [x] Preserve connector attachment and semantic relationships after layout

### Graph layout

- [x] Add deterministic Rust tree and flow layouts using structured connections
- [x] Add Rust radial layout after tree and flow behavior is stable
- [x] Verify layout through undo/redo, save/reopen, merge, and stale-head
      handling
- [x] Add integration tests for representative before/after layout operations

## Agent proposal review

Turn structured agent mutations into visual proposals that people can inspect
before committing them.

### Richer canvas preview

- [x] Derive object-specific modification, removal, and move previews in Rust
      and render them in the TypeScript canvas
- [x] Include relationship and metadata changes in Rust preview data and the
      TypeScript review UI
- [x] Define distinct visual tokens for proposed additions, modifications, and
      removals

### End-to-end review

- [ ] Add end-to-end tests for the existing proposal summary, partial accept,
      reject, ghost preview, and stale-head flows
- [ ] Verify accepted and rejected proposals leave no stale canvas or review
      state

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

## Board management

Bring board creation, discovery, switching, and maintenance up to the quality of
the canvas editor.

### Browser and workspace

- [ ] Clarify the active board, storage location, save state, and last-updated
      information in the TypeScript board-management UI
- [ ] Add explicit sort controls and complete keyboard navigation for large
      board lists
- [ ] Unify browser storage, desktop workspaces, and recent files behind the
      same board-management interaction where their capabilities overlap
- [ ] Make the board browser responsive and accessible on narrow viewports and
      coarse pointers

### Board actions

- [ ] Add board duplication through the shared TypeScript repository interface
      and the existing Rust desktop file/session services
- [ ] Surface TypeScript UI busy and failure states instead of logging
      board-action errors to the console
- [ ] Protect board switches when pending editor changes cannot be flushed
- [ ] Make the board inspector useful to users while retaining file, schema, and
      document diagnostics for maintainers
- [ ] Add end-to-end tests for the existing board actions plus duplication,
      switching, workspace selection, and persistence across reloads

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
- [x] Add a move handle to the layer pane
