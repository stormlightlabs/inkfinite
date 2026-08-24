# Inkfinite TODO

## Editor defaults

Make newly created content look deliberate before the user changes any styling.

- [x] Move creation-time visual defaults into a shared style policy instead of
      hard-coding colors independently in editor tools and UI controls
- [x] Define defaults for rectangles, ellipses, frames, lines, arrows, pen
      strokes, text, Markdown, and cards
- [x] Use neutral shape styling by default and reserve the Inkfinite accent for
      selection, arrows, emphasis, and interactive state
- [x] Increase the default rectangle corner radius and define distinct frame
      styling so frames do not look like ordinary shapes
- [x] Remove light-canvas assumptions from text and Markdown defaults
- [x] Resolve automatic creation colors against the document/page canvas at creation time
      and persist the resulting explicit colors; keep application theme colors out of
      canonical document rendering
- [x] Ensure creation through the editor, CLI, MCP, stencils, and starter
      documents uses the same default style policy where appropriate
- [x] Add light- and dark-canvas visual fixtures covering every built-in
      primitive
- [x] Add screenshot regression coverage for a representative mixed document

## SVG round-trip

Run representative native and fallback SVG fixtures through each complete
document workflow. Compare normalized structure where representation matters
and rendered output where visual fidelity matters.

- [ ] Offer creation of a new document from SVG as a separate editor action
- [ ] Verify and fix TypeScript editor traversal of imported root containers so
      existing child records can be selected, edited, reparented, and deleted
      independently
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

## Advanced vector editing

### Boolean paths

- [ ] Define union, intersection, difference, and exclusion operations over
      Inkfinite's native path representation
- [ ] Preserve transforms and fill rules when combining selected paths
- [ ] Expose boolean operations through editor commands and selection controls
- [ ] Make each boolean operation one undoable document transaction
- [ ] Verify generated geometry through SVG import/export round trips
- [ ] Add deterministic fixtures for overlapping, nested, compound, and
      self-intersecting paths

### Gradient fills and strokes

- [ ] Extend the paint representation beyond flat colors with linear and radial
      gradients
- [ ] Represent gradient stops, positions, transforms, spread behavior, and
      opacity in canonical document data
- [ ] Render gradients consistently in the interactive renderer and exports
- [ ] Import and export supported SVG gradients without flattening them
- [ ] Add gradient controls for stop creation, deletion, position, color, and
      opacity
- [ ] Add fixtures covering transformed gradients and gradient inheritance

### Clips, masks, and filters

- [ ] Define which SVG clip, mask, and filter constructs Inkfinite can represent
      natively
- [ ] Preserve unsupported constructs as sanitized fallback content instead of
      silently discarding them
- [ ] Add native clip-path editing before exposing more general mask editing
- [ ] Add basic mask composition once clip-path behavior is stable
- [ ] Define the initial editable filter subset rather than attempting the full
      SVG filter graph at once
- [ ] Verify deterministic import, editing, save/reopen, and SVG export

### Variable-width strokes

- [ ] Extend stroke data with a width or pressure profile along the path
- [ ] Capture pointer pressure where available without making pressure input
      mandatory
- [ ] Add editing for width points independently of ordinary path nodes
- [ ] Render width profiles consistently at different zoom levels
- [ ] Define SVG export behavior, including conversion to outlined paths when
      required
- [ ] Add pen, edit, undo/redo, and export fixtures

### Text on path

- [ ] Define the relationship between a text object and its supporting path
- [ ] Support offset, direction, alignment, and path reversal
- [ ] Keep the path independently editable without destroying attached text
- [ ] Add direct manipulation for text offset along the path
- [ ] Import and export representative SVG `textPath` content
- [ ] Add undo/redo and round-trip fixtures

## Clipboard and export workflows

### SVG as code

- [ ] Add "Copy as SVG" for the current selection and document
- [ ] Generate the SVG through the same canonical exporter used by file export
- [ ] Write SVG markup as `text/plain` and `image/svg+xml` where supported
- [ ] Provide a visible fallback when rich clipboard MIME types are unavailable
- [ ] Verify copied SVG can be pasted into a text editor and common vector tools

### PNG clipboard export

- [ ] Render the current selection or document through the existing raster
      export path
- [ ] Write PNG data to the system clipboard where the platform supports it
- [ ] Preserve transparent backgrounds when requested
- [ ] Provide file-download fallback where image clipboard APIs are unavailable
- [ ] Add browser capability tests and desktop integration coverage

## PWA and offline web app

- [ ] Add a web app manifest with name, icons, start URL, display mode, and
      light/dark theme metadata
- [ ] Add installable application icons at the required sizes
- [ ] Add a service worker for the application shell and versioned static assets
- [ ] Cache the WASM runtime and other editor-critical assets for offline startup
- [ ] Keep documents in the existing local persistence layer rather than
      introducing a second PWA-specific store
- [ ] Verify create, edit, save, close, reopen, and export while offline
- [ ] Define service-worker update behavior so stale application code cannot
      silently remain active indefinitely
- [ ] Add Playwright coverage for first load, installation eligibility, cached
      reload, offline reload, and application updates

## Release and distribution

Keep releases understandable and reproducible before investing in extensive
automation.

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

Revisit skills after the CLI and MCP surfaces have stabilized.

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
