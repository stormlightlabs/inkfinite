# Inkfinite TODO

Active implementation work for [ROADMAP.md](ROADMAP.md).

Completed work is in [CHANGELOG.md](CHANGELOG.md).

## SVG Interoperability

### Native path geometry

#### Representation and validation

- [x] Add a native `path` shape kind
- [x] Define normalized path and subpath representation
- [x] Support move segments
- [x] Support line segments
- [x] Support quadratic curves
- [x] Support cubic curves
- [x] Support closed subpaths
- [x] Define compound-path fill rules
- [x] Generate TypeScript bindings for path geometry
- [x] Implement Rust path validation

#### Geometry, rendering, and fixtures

- [x] Implement path bounds
- [x] Include quadratic and cubic extrema in bounds
- [x] Implement Canvas path rendering
- [x] Implement path fill hit testing
- [x] Implement path stroke hit testing
- [x] Implement deterministic SVG path rendering
- [x] Support parent-relative path transforms
- [x] Add shared Rust/TypeScript path fixtures
- [x] Add invalid-path fixtures

### SVG import

#### Parsing and native mapping

- [x] Add an SVG import boundary
- [x] Parse SVG into a normalized intermediate representation
- [x] Import `<g>` as containers
- [x] Import `<rect>` as rect shapes
- [x] Import `<circle>` as ellipse shapes
- [x] Import `<ellipse>` as ellipse shapes
- [x] Import `<line>` as line shapes
- [x] Import `<polygon>` as path shapes
- [x] Import `<polyline>` as path shapes
- [x] Import `<path>` as path shapes
- [x] Preserve nested transforms
- [x] Preserve supported fill styles
- [x] Preserve supported stroke styles
- [x] Preserve opacity
- [x] Define SVG text import behavior
- [x] Import supported embedded raster images as assets

#### Unsupported content and security

- [ ] Preserve original SVG source as an asset
- [ ] Define warnings for unsupported SVG features
- [ ] Define opaque fallback behavior for unsupported visual subtrees
- [ ] Handle gradients explicitly
- [ ] Handle clip paths explicitly
- [ ] Handle masks explicitly
- [ ] Handle filters explicitly
- [ ] Reject or ignore scripts and animation explicitly

#### Transactions and entry points

- [ ] Commit imports through one validated transaction
- [ ] Add desktop SVG file import
- [ ] Add drag-and-drop SVG import
- [ ] Add CLI SVG import

#### Import fixtures

- [ ] Add SVG import fixtures for icons
- [ ] Add SVG import fixtures for logos
- [ ] Add SVG import fixtures for nested groups
- [ ] Add SVG import fixtures for compound paths
- [ ] Add SVG import fixtures for unsupported features
- [ ] Add malformed SVG fixtures

### SVG round-trip

#### Document workflows

- [ ] Test SVG import → save → reopen
- [ ] Test SVG import → edit → SVG export
- [ ] Test SVG import → undo → redo
- [ ] Test imported content through CRDT merge
- [ ] Test imported shapes through CLI inspect
- [ ] Test imported shapes through CLI query
- [ ] Test imported shapes through CLI mutation

#### Export fidelity

- [ ] Verify native vector geometry exports without rasterization
- [ ] Verify nested transforms export deterministically
- [ ] Verify compound fill rules survive import and export
- [ ] Verify opaque fallback content remains visually stable
- [ ] Add deterministic round-trip fixtures

## Vector Editing

### Hierarchical object editing

#### Navigation and transforms

- [ ] Audit current nested-transform selection behavior
- [ ] Select an imported SVG container as one object
- [ ] Enter a container for child selection
- [ ] Leave a container and return to parent selection
- [ ] Move nested child shapes
- [ ] Resize nested child shapes
- [ ] Rotate nested child shapes
- [ ] Restyle nested child shapes

#### Hierarchy semantics and tests

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
