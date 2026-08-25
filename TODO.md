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

## Architecture consolidation

### Clarify model ownership

- [x] Document the dependency direction between the canonical Rust document,
      generated bindings, TypeScript editor model, editor runtime, UI, and apps
- [x] Rename or reorganize TypeScript editor-model types so they cannot be
      confused with canonical Rust records; update affected tests and public
      imports without changing serialized document behavior
- [x] Put canonical-to-editor projection and editor-to-canonical reconciliation
      adapters behind an explicit TypeScript module boundary, with round-trip
      coverage for projection -> edit -> canonical transaction
- [x] Keep generated bindings generated; remove hand-maintained duplicates of
      Rust-owned contract types where unnecessary and verify binding generation
      remains reproducible

### Make TypeScript core headless

- [x] Audit `@inkfinite/core` exports and classify them as domain, editor,
      browser/platform, persistence, or UI concerns
- [x] Move DOM and `HTMLCanvasElement`-dependent raster export helpers out of
      `@inkfinite/core`; preserve existing SVG/PNG behavior in browser and
      desktop integration tests
- [x] Move UI-specific file-browser and status-bar contracts out of
      `@inkfinite/core` and update consumers without introducing circular
      package dependencies
- [x] Keep browser and desktop persistence adapters at application/platform
      boundaries rather than exposing them through the core root barrel;
      verify create, save, reopen, and export workflows in both hosts
- [x] Add explicit `@inkfinite/core` subpath exports for stable capability
      groups such as model, geometry, commands, selection, and interchange,
      with package-consumer typecheck coverage
- [x] Reduce the root `@inkfinite/core` export surface to the intentionally
      supported convenience API
- [x] Add an import-boundary lint rule or test preventing core from depending
      on DOM, Svelte, application, or platform-specific modules

### Decompose the editor implementation

- [x] Split `packages/editor/src/renderer.ts` into renderer lifecycle, scene
      traversal, shape rendering, text/assets, and overlay responsibilities
      without changing its public API or rendering fixtures
- [x] Keep one exhaustive shape-render dispatch point and require existing
      rendering coverage to pass for every supported shape kind
- [x] Centralize Canvas path, transform, effect, and paint helpers shared by
      shape renderers; verify Canvas and SVG output remain consistent for the
      supported effects subset
- [x] Move renderer caches and image-loading behavior behind focused helpers
      with explicit lifetimes and preserve redraw behavior for asynchronously
      loaded assets
- [x] Extract keyboard shortcut resolution from `EditorRuntime` into a pure,
      independently tested module
- [x] Define a small host-request boundary for clipboard, board-browser,
      command-palette, shortcut-panel, undo, and redo requests, with tests for
      browser-host dispatch
- [x] Move reusable document operations out of the runtime so keyboard
      shortcuts, menus, context menus, and the command palette dispatch the same
      editor commands
- [x] Keep `EditorRuntime` focused on gestures, interaction state, command
      routing, previews, and transaction boundaries; preserve gesture and undo
      transaction semantics in runtime tests
- [x] Keep the DOM input adapter limited to browser-event normalization and
      dispatch, retaining pointer-capture, pressure, wheel, and keyboard
      coverage

### Decompose large UI inspectors

- [ ] Split `SelectionControls.svelte` into capability-focused inspector
      sections for transform, appearance, text, path/vector, effects, image,
      container/layout, and metadata controls while preserving current
      inspector behavior
- [ ] Move reusable selection-derived state and mutation helpers out of Svelte
      components and add focused unit tests for the extracted behavior
- [ ] Keep inspector sections driven by shared editor commands rather than
      introducing component-specific document mutations
- [ ] Review other large editor components for the same presentation-versus-
      behavior boundary; split only where a coherent responsibility can be
      extracted and covered independently

### Organize Rust internals

- [ ] Move canonical document types and supporting value types out of
      `inkfinite-core/src/lib.rs` into focused model modules while preserving
      existing public re-exports and serialization/schema tests
- [ ] Split Rust editor projection types, projection logic, and reconciliation
      logic into focused modules under the existing editor boundary, preserving
      projection and transaction reconciliation fixtures
- [ ] Group related path, routing, boolean, layout, and geometry modules under a
      coherent geometry namespace where doing so improves navigation; preserve
      existing public paths where they are part of the intended API
- [ ] Keep WASM, CLI, and MCP as adapters over `inkfinite-core`; do not create
      additional crates solely to subdivide implementation files
- [ ] Update architecture documentation and `AGENTS.md` with allowed dependency
      directions and guidance for where new models, commands, renderers, UI,
      and platform integrations belong

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
