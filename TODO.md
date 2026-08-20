# Inkfinite TODO

Active implementation work for [ROADMAP.md](ROADMAP.md).

Completed work is in [CHANGELOG.md](CHANGELOG.md).

## SVG Interoperability

### Native path geometry

Inkfinite now supports validated native paths across Rust and TypeScript, including compound geometry, transforms, bounds, rendering, hit testing, and shared fixtures.

### SVG import

Inkfinite now imports SVGs through one validated Rust pipeline across desktop, web, and CLI while preserving supported content and safely retaining unsupported visual content.

### SVG round-trip

#### Document workflows

- [ ] Test SVG import → save → reopen
    - Import representative SVGs, save each document, and reopen it. Confirm the scene
      hierarchy, geometry, styles, and fallback content match the imported state.
- [ ] Test SVG import → edit → SVG export
    - Import an SVG, modify its shapes in Inkfinite, and export it as SVG. Confirm the
      export includes the edits and remains valid when opened by an independent SVG renderer.
- [ ] Test SVG import → undo → redo
    - Import an SVG, undo the import, and redo it. Verify both operations restore the
      expected document state without missing or duplicated shapes.
- [ ] Test imported content through CRDT merge
    - Import SVG content into one replica, merge it with concurrent changes from another replica,
      and verify convergence. Cover native shapes, hierarchy, styles, and opaque fallback content.
- [ ] Test imported shapes through CLI inspect
    - Import an SVG and use the CLI inspection commands to examine the resulting document.
      Confirm imported shape types, properties, hierarchy, and source metadata are reported correctly.
- [ ] Test imported shapes through CLI query
    - Query an imported document for representative native and fallback shapes.
      Verify filters and selectors return the expected shapes and expose the properties needed by CLI users.
- [ ] Test imported shapes through CLI mutation
    - Apply CLI mutations to imported shapes, then inspect and render the result.
      Confirm supported properties change correctly without corrupting unrelated SVG data or hierarchy.

#### Export fidelity

- [ ] Verify native vector geometry exports without rasterization
    - Import supported SVG geometry and export it again. Assert that paths and native
      primitives remain vector elements rather than images or other rasterized output.
- [ ] Verify nested transforms export deterministically
    - Round-trip fixtures with multiple transform levels and compare repeated exports.
      Confirm transform composition preserves visual placement and produces identical serialized
      output each time.
- [ ] Verify compound fill rules survive import and export
    - Round-trip compound paths that use both `nonzero` and `evenodd` fill rules. Render
      or inspect the exports to confirm holes and overlapping regions retain their original fill behavior.
- [ ] Verify opaque fallback content remains visually stable
    - Round-trip unsupported SVG elements stored as opaque fallback content. Compare renders
      before and after export to catch changes in appearance, placement, clipping, or styling.
- [ ] Add deterministic round-trip fixtures
    - Add focused fixtures for native geometry, transforms, compound fills, and opaque fallbacks. Make
      tests compare canonical exports or renders so regressions produce stable, reviewable failures.

## WASM

Inkfinite now runs the canonical Rust document engine in a browser worker. Root
verification builds the WASM package and browser smoke coverage verifies the full
document lifecycle, including SVG import and rendering.

## Vector Editing

### Hierarchical object editing

#### Navigation and transforms

- [x] Audit current nested-transform selection behavior
- [x] Select an imported SVG container as one object
- [x] Enter a container for child selection
- [x] Leave a container and return to parent selection
- [x] Move nested child shapes
- [x] Resize nested child shapes
- [x] Rotate nested child shapes
- [x] Restyle nested child shapes

#### Hierarchy semantics and tests

- [ ] Route committed hierarchy operations through canonical Rust geometry APIs
- [ ] Reparent shapes while preserving world-space appearance
- [ ] Define selection behavior across different parents
- [ ] Define multi-selection behavior across different parents
- [ ] Ensure hit testing maps through nested transforms correctly
- [ ] Ensure gesture previews use the same transform semantics as commits
- [ ] Preserve locked and hidden hierarchy behavior
- [ ] Add nested-selection runtime tests
- [ ] Add nested-transform renderer tests

### Direct selection

#### Selection and manipulation

- [ ] Add a direct-selection tool
- [ ] Select complete subpaths
- [ ] Select individual anchors
- [ ] Select multiple anchors
- [ ] Move selected anchors
- [ ] Move complete subpaths
- [ ] Render quadratic control handles
- [ ] Render cubic control handles
- [ ] Drag quadratic control handles
- [ ] Drag cubic control handles

#### Preview, commit, and tests

- [ ] Update bounds during path-edit previews
- [ ] Update hit regions during path-edit previews
- [ ] Commit one transaction per completed geometry gesture
- [ ] Make one direct-edit gesture one undo step
- [ ] Add direct-selection interaction tests

### Path topology

#### Segment editing

- [ ] Route committed topology operations through canonical Rust geometry APIs
- [ ] Add anchors to path segments
- [ ] Delete anchors
- [ ] Convert straight segments to curves
- [ ] Convert curves to straight segments
- [ ] Break Bezier handles
- [ ] Join Bezier handles

#### Open paths, compound paths, and tests

- [ ] Open closed paths
- [ ] Close open paths
- [ ] Join compatible endpoints
- [ ] Preserve compound-path fill behavior during topology changes
- [ ] Reject invalid durable path topology
- [ ] Add topology-edit fixtures and tests

## Direct CLI Control

### Separate capability from policy

#### Remove agent-specific restrictions

- [ ] Audit all `Origin::Agent` behavior
- [ ] Separate document invariants from agent authorization
- [ ] Separate ordinary document locks from agent policy
- [ ] Remove `agent_editable` restrictions from direct CLI operations
- [ ] Remove hidden-from-agent restrictions from direct CLI operations
- [ ] Decide whether `Origin` remains provenance-only

#### Preserve document correctness

- [ ] Keep causal-head checks
- [ ] Keep record-version checks
- [ ] Keep transaction validation
- [ ] Keep atomic mutation behavior
- [ ] Keep ordinary shape locks
- [ ] Keep ordinary layer locks

### Simplify CLI and live control

#### Runtime behavior and contracts

- [ ] Remove Review/Direct authorization concepts from general CLI behavior
- [ ] Simplify live apply semantics
- [ ] Keep proposal behavior only where it remains independently useful
- [ ] Update `capabilities --json`
- [ ] Update generated protocol/schema contracts as needed

#### Guidance and regression coverage

- [ ] Update CLI help
- [ ] Update CLI documentation
- [ ] Update bundled skill guidance
- [ ] Replace permission-oriented CLI tests with direct-control tests
- [ ] Add regression coverage for unrestricted scripted mutation

## Permissioned MCP

### Server

- [ ] Choose the Rust MCP SDK or implementation approach
- [ ] Add an `inkfinite-mcp` crate or binary
- [ ] Start with stdio transport
- [ ] Reuse `inkfinite-core` query APIs
- [ ] Reuse `inkfinite-core` transaction APIs
- [ ] Avoid shelling out to the CLI from the MCP server
- [ ] Expose Inkfinite capability metadata

### Resources and discovery

#### Documents and state

- [ ] Discover open desktop sessions
- [ ] Discover accessible Inkfinite files where appropriate
- [ ] Inspect document metadata
- [ ] Inspect causal heads

#### Record queries

- [ ] Query document records
- [ ] Query by semantic role
- [ ] Query by shape kind
- [ ] Query by parent
- [ ] Query by bounds

### Mutation tools

#### Shape and structure mutations

- [ ] Create shapes
- [ ] Patch shapes
- [ ] Move/reparent shapes
- [ ] Delete shapes
- [ ] Create and patch layers
- [ ] Create containers
- [ ] Apply layout operations

#### Connections, import, and results

- [ ] Create connections
- [ ] Delete connections
- [ ] Import SVG where appropriate
- [ ] Return affected IDs and heads from every mutation
- [ ] Expose dry-run or preview behavior where useful

### Permission model

#### Permission scopes

- [ ] Define read permission
- [ ] Define create permission
- [ ] Define modify permission
- [ ] Define delete permission
- [ ] Define structural/layout permission
- [ ] Define per-document policy
- [ ] Define per-session policy

#### Document policy and errors

- [ ] Apply `agent_editable` policy at the MCP boundary
- [ ] Decide hidden-layer visibility policy for MCP clients
- [ ] Decide how ordinary shape/layer locks interact with MCP permissions
- [ ] Decide whether proposal/review mode belongs in MCP
- [ ] Return explicit authorization errors
- [ ] Keep authorization separate from document validation

### Verification and skills

- [ ] Add MCP integration fixtures
- [ ] Test read-only sessions
- [ ] Test restricted write sessions
- [ ] Test denied mutations
- [ ] Test stale-head recovery
- [ ] Test invalid transactions
- [ ] Test document locks
- [ ] Test `agent_editable`
- [ ] Update or split Inkfinite agent skills for CLI and MCP usage

## Performance Profiling

### Fixture corpus

#### Scale fixtures

- [ ] Turn representative fixtures into an executable performance corpus
- [ ] Add a small document fixture
- [ ] Add a medium document fixture
- [ ] Add a large document fixture
- [ ] Retain a 10,000-shape fixture

#### Workload fixtures and methodology

- [ ] Add a vector-heavy fixture
- [ ] Add a deeply nested hierarchy fixture
- [ ] Add a large imported SVG fixture
- [ ] Add a connection-heavy diagram fixture
- [ ] Record reference hardware
- [ ] Record benchmark methodology

### Document and CRDT profiling

#### Persistence and materialization

- [ ] Profile document open
- [ ] Profile document save
- [ ] Profile Automerge load
- [ ] Profile Automerge materialization

#### Transactions, merge, and queries

- [ ] Profile transaction validation
- [ ] Profile transaction commit
- [ ] Profile undo/redo
- [ ] Profile CRDT merge
- [ ] Profile query latency
- [ ] Profile memory use at representative document sizes

### Renderer and interaction profiling

#### Scene traversal and paths

- [ ] Profile Canvas frame time
- [ ] Profile viewport culling
- [ ] Profile hit testing
- [ ] Profile nested-transform traversal
- [ ] Profile path rendering
- [ ] Profile compound paths

#### Overlays and editing

- [ ] Profile selection overlays
- [ ] Profile vector-edit previews
- [ ] Profile text and Markdown alongside vector-heavy scenes

### Interop and tooling profiling

#### SVG and CLI

- [ ] Profile SVG parse time
- [ ] Profile SVG import time
- [ ] Profile SVG export time
- [ ] Profile CLI startup
- [ ] Profile common CLI queries
- [ ] Profile common CLI mutations

#### IPC and MCP

- [ ] Profile local IPC round trips
- [ ] Profile MCP startup
- [ ] Profile MCP queries and mutations

### Optimization

#### Baselines and budgets

- [ ] Record baseline measurements before architecture changes
- [ ] Identify dominant costs
- [ ] Establish regression budgets for measured bottlenecks

#### Evidence-driven architecture

- [ ] Evaluate spatial indexing only if hit testing warrants it
- [ ] Evaluate path caches only if vector rendering warrants them
- [ ] Evaluate render caches only if profiling warrants them
- [ ] Evaluate incremental materialization only if CRDT costs warrant it
- [ ] Evaluate alternate rendering backends only with benchmark evidence

## Backlog

### Vector features

- [ ] Boolean path operations
- [ ] Gradient editor
- [ ] Clip-path editing
- [ ] Mask editing
- [ ] SVG filter editing
- [ ] Variable-width strokes
- [ ] Text on path

### Web

- [ ] Add web manifest
- [ ] Add service worker
- [ ] Make the web app installable as a PWA
- [ ] Improve offline-first web behavior

### Packaging

- [ ] Decide crates.io publication strategy for CLI and core crates
- [ ] Decide desktop release packaging
- [ ] Automate GitHub release artifacts

### Agent tooling

- [ ] Revisit skill organization after SVG and MCP workflows stabilize
- [ ] Consider separate drawing, wireframing, SVG, and MCP skills
