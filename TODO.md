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

## Performance profiling

### Corpus and harnesses

- [x] Build shared 100, 1,000, 5,000, and 10,000-shape fixtures for flat,
      vector-heavy, deeply nested, imported-SVG, connection-heavy, and
      semantic/binding-heavy documents
- [x] Replace the stale Node capture with a traversal-only benchmark against
      the current editor renderer; keep its no-op canvas scope explicit
- [x] Add Criterion benchmarks for document load/save/materialization,
      transactions, queries, SVG, layout, and renderer algorithms
- [x] Add a profiling Cargo profile with release optimizations and debug symbols
- [x] Record reference hardware, tool versions, fixture seeds, warmups, and
      sampling methodology

### Native and process measurements

- [ ] Benchmark validation, commit, undo/redo, merge, query, layout, and SVG
      operations across fixture sizes
- [ ] Use `samply` to attribute native CPU hotspots identified by benchmarks
- [ ] Use `hyperfine` to measure complete CLI inspect, query, validate, render,
      and mutate commands plus MCP startup
- [ ] Add coarse `tracing` spans for document, IPC, and MCP operations so
      end-to-end latency can be attributed without instrumenting hot geometry
      loops

### Browser measurements

- [ ] Add Playwright and CDP workloads for load, pan, zoom, box selection,
      single- and multi-object drag, vector editing, connected-shape movement,
      and nested selection
- [ ] Capture real Chrome frame, paint, raster, compositor, long-task, GC, and
      memory data instead of treating the no-op canvas benchmark as browser
      rendering performance
- [ ] Measure JS-to-WASM document operations and projection/store updates with
      browser performance marks
- [ ] Test heap retention after opening a 10,000-shape board, sustained editing,
      and replacing the active document
- [ ] Save compact summaries and diagnostic traces for representative browser
      workloads without enabling full Playwright tracing during measurement

### Baselines and optimization

- [ ] Refresh the July 2026 baseline and set regression budgets from current
      native, process, and browser measurements
- [ ] Record dominant costs and use Criterion deltas, Chrome traces, and
      `samply` profiles to investigate regressions
- [ ] Evaluate spatial indexes, path/render caches, incremental materialization,
      alternate renderers, or allocation profilers only when a measured
      bottleneck supports the change

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
