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

- [x] Offer creation of a new document from SVG as a separate editor action
- [x] Verify and fix TypeScript editor traversal of imported root containers so
      existing child records can be selected, edited, reparented, and deleted
      independently
- [x] Test import through save/reopen, edit/export, undo/redo, and CRDT merge
- [x] Test active-document import and explicit new-document creation end to end
- [x] Test imported child shapes through editor selection and targeted CLI
      query and mutation
- [x] Verify native vectors export without rasterization
- [x] Verify nested transforms export deterministically
- [x] Verify compound fill rules survive import and export
- [x] Add sanitized static fallback content for unsupported visuals and verify
      that it remains visually stable
- [x] Add deterministic round-trip fixtures for these workflows

## Richer interoperability and embeds

- [ ] Extend the existing TypeScript JSON Canvas round-trip for new card,
      relationship, frame, and asset fields where the format supports them
- [ ] Add integration fixtures that combine native objects, imported SVG,
      raster assets, and external links
- [ ] Define the initial editable Mermaid and D2 import subset, mapping graph
      nodes, edges, labels, groups, and supported styling to canonical shapes
      and relationships
- [ ] Import supported Mermaid and D2 diagrams as ordinary editable Inkfinite
      objects and run them through the shared graph-layout pipeline
- [ ] Define warning and fallback behavior for diagram constructs that cannot
      be represented natively
- [ ] Add Mermaid and D2 import fixtures covering representative flowcharts,
      labels, edge directions, groups, and unsupported constructs
- [ ] Add end-to-end import, edit, and export comparisons for representative
      mixed-format documents

## Connector geometry

Make arrows semantic connectors backed by the same geometry operations used
for native paths. Avoid separate approximations for rendering, export,
selection, labels, and arrowheads.

### Shared resolved geometry

- [x] Define a resolved arrow geometry representation backed by native
      `PathGeometry`
- [x] Resolve bound endpoints, explicit waypoints, and routing configuration
      before rendering or interaction code consumes the arrow
- [x] Make straight arrows resolve to ordinary line path segments without
      changing existing document behavior
- [x] Move canonical arrow geometry resolution into Rust and expose it through
      the existing editor/WASM bindings
- [x] Use the same resolved geometry for interactive rendering and headless SVG
      export
- [x] Replace arrow bounds derived only from stored points with bounds from the
      resolved path, including Bézier extrema
- [x] Add deterministic fixtures comparing interactive and exported geometry
      for free, bound, transformed, and multi-point arrows

### Path metrics

- [x] Add shared path flattening with a geometric tolerance rather than fixed
      samples per curve
- [x] Add path length and point-at-distance queries
- [x] Add tangent-at-distance queries for line, quadratic, and cubic segments
- [x] Add nearest-point and distance-along-path queries for hit testing and
      snapping
- [x] Add path trimming by start and end distance
- [x] Reuse the shared path metrics for native path and arrow hit testing
      instead of maintaining separate curve-sampling implementations
- [x] Add deterministic tests for lines, quadratic curves, cubic curves,
      transformed paths, and degenerate segments

### Curved arrows

- [x] Add persistent curved-arrow bend state without storing sampled curve
      points
- [x] Resolve two-point curved arrows to native quadratic Bézier geometry
- [x] Add a direct-manipulation bend handle with a well-defined straight-arrow
      zero state
- [x] Preserve bound endpoints while the bend handle is edited
- [x] Define multi-point curved-arrow behavior as rounded waypoint routes
      rather than an unconstrained spline
- [x] Render native quadratic and cubic path segments directly instead of
      drawing sampled curves with `lineTo`
- [x] Add undo/redo and save/reopen coverage for curved-arrow edits
- [x] Add visual fixtures for positive, negative, zero, short, long, bound, and
      multi-point curves

### Path-aware arrowheads and labels

- [ ] Orient start and end arrowheads from the tangent of the resolved path
      rather than the first or last sampled line segment
- [ ] Define arrowhead geometry independently from shaft geometry so additional
      head styles can be added without changing routing
- [ ] Trim the visible shaft where required so filled arrowheads do not overlap
      the path beneath them
- [ ] Position arrow labels by distance along the resolved path
- [ ] Apply label offset along the local path normal rather than a global axis
- [ ] Keep label placement stable when bindings, bend, or orthogonal routing
      change
- [ ] Add hit-test and visual coverage for arrowheads and labels on straight,
      curved, and orthogonal routes

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

Build text-on-path behavior on the shared path metrics introduced for
path-aware connectors rather than creating a second path-placement system.

- [ ] Define the relationship between a text object and its supporting path
- [ ] Represent text position as an offset along the supporting path
- [ ] Reuse shared path length, point, tangent, and normal queries for layout
- [ ] Support direction, alignment, side, and path reversal
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
