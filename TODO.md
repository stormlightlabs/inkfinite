# Inkfinite TODO

## Richer interoperability and embeds

- [x] Extend the existing TypeScript JSON Canvas round-trip for new card,
      relationship, frame, and asset fields where the format supports them
- [x] Add integration fixtures that combine native objects, imported SVG,
      raster assets, and external links
- [x] Define the initial editable Mermaid and D2 import subset, mapping graph
      nodes, edges, labels, groups, and supported styling to canonical shapes
      and relationships
- [x] Import supported Mermaid and D2 diagrams as ordinary editable Inkfinite
      objects and run them through the shared graph-layout pipeline
- [x] Define warning and fallback behavior for diagram constructs that cannot
      be represented natively
- [x] Add Mermaid and D2 import fixtures covering representative flowcharts,
      labels, edge directions, groups, and unsupported constructs
- [x] Add end-to-end import, edit, and export comparisons for representative
      mixed-format documents

## Clipboard and export workflows

### SVG as code

- [x] Add "Copy as SVG" for the current selection and document
- [x] Generate the SVG through the same canonical exporter used by file export
- [x] Write SVG markup as `text/plain` and `image/svg+xml` where supported
- [x] Provide a visible fallback when rich clipboard MIME types are unavailable
- [x] Verify copied SVG can be pasted into a text editor and common vector tools

### PNG clipboard export

- [x] Render the current selection or document through the existing raster
      export path
- [x] Write PNG data to the system clipboard where the platform supports it
- [x] Preserve transparent backgrounds when requested
- [x] Provide file-download fallback where image clipboard APIs are unavailable
- [x] Add browser capability tests and desktop integration coverage

## PWA and offline web app

- [x] Add a web app manifest with name, icons, start URL, display mode, and
      light/dark theme metadata
- [x] Add installable application icons at the required sizes
- [x] Add a service worker for the application shell and versioned static assets
- [x] Cache the WASM runtime and other editor-critical assets for offline startup
- [x] Keep documents in the existing local persistence layer rather than
      introducing a second PWA-specific store
- [x] Verify create, edit, save, close, reopen, and export while offline
- [x] Define service-worker update behavior so stale application code cannot
      silently remain active indefinitely
- [x] Add Playwright coverage for first load, installation eligibility, cached
      reload, offline reload, and application updates

## Release and distribution

- [ ] Decide which Rust crates are public API and which remain workspace-only
- [ ] Define crates.io package metadata and publication order for publishable
      crates
- [ ] Decide whether CLI and MCP ship from one crate with multiple binaries or
      independent packages
- [ ] Define the desktop release matrix for macOS, Linux, and Windows
- [ ] Define the CLI and MCP binary release matrix
- [ ] Add a documented manual release checklist covering version changes,
      changelog, tests, builds, packaging, checksums, tags, and publication
- [ ] Add local release scripts for repeatable desktop and CLI/MCP builds
      without requiring a fully automated release pipeline
- [ ] Publish GitHub release artifacts with checksums
- [ ] Publish intended Rust packages to crates.io
- [ ] Verify installation instructions against clean machines or containers

## Agent skills

- [ ] Inventory existing skills and the commands or workflows each depends on
- [ ] Remove duplicated instructions that are better represented by CLI or MCP
      capabilities
- [ ] Separate product workflows from repository-development skills
- [ ] Keep skills thin wrappers around stable Inkfinite capabilities rather
      than introducing alternative document semantics
- [ ] Add end-to-end examples for the supported agent workflows
- [ ] Document when agents should use direct CLI control versus permissioned MCP

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
