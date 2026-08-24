# Inkfinite TODO

## SVG round-trip

Run representative native and fallback SVG fixtures through each complete
document workflow. Compare normalized structure where representation matters
and rendered output where visual fidelity matters.

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
- [ ] Add sanitized static fallback content for unsupported visuals and verify
      that it remains visually stable
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
