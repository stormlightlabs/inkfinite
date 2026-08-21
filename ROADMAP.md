# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents.

The desktop app, CLI, and programmatic interfaces operate on the same native
document model and transaction engine. New work should extend that model rather
than introduce alternate document representations or mutation paths.

Completed work is recorded in [CHANGELOG.md](CHANGELOG.md). Concrete
implementation work lives in [TODO.md](TODO.md).

## Current Direction

### SVG interoperability

Inkfinite uses SVG as a first-class interchange format. Rust owns native path
geometry, import, export, validation, and transaction construction across the
desktop, web app, and CLI. Unsupported visual content retains an opaque fallback
when possible.

Remaining work focuses on round-trip workflows: save and reopen, undo and redo,
CRDT merge, CLI inspection and mutation, deterministic transforms and compound
fills, and visual stability for opaque fallback content. The checked-in fixture
corpus under [`fixtures/svg-import`](fixtures/svg-import/) is shared across native
and browser tests.

The [native path geometry guide](apps/web/src/content/docs/internals/native-path-geometry.md)
documents the representation and geometry semantics used by import and editing.

### WASM

The web app runs the canonical Rust document engine in a dedicated worker. The
worker owns Automerge state, validated commits, projection, reconciliation,
undo/redo, SVG import, and deterministic SVG rendering. IndexedDB stores canonical
bytes and the Rust projection. TypeScript continues to own interaction previews,
hit testing, Canvas rendering, and browser APIs.

Browser smoke coverage exercises the compiled module and worker through document
creation, mutation, save and reopen, projection, undo and redo, SVG import, and
SVG rendering. Root verification builds the WASM package before running tests.

### Vector editing

Build native vector editing on top of the path representation introduced for
SVG interoperability.

Object-level editing comes first:

- select an imported SVG as one object
- enter and leave nested groups
- select individual vector elements
- move, resize, rotate, reparent, and restyle nested shapes
- preserve world-space appearance when changing hierarchy

The initial navigation and transforms slice is implemented. The Rust editor
projection includes imported containers and composed world transforms. The web
editor selects containers as objects, enters and leaves nested scopes, and
moves, resizes, rotates, and restyles selected children through the existing
reconciliation path.

Hierarchy commits now use the Rust affine geometry helpers. Reparenting computes
a parent-relative transform from the shape's world transform, and rejects a
move when the native transform cannot represent it. Selection is scoped to the
current container, multi-selection removes descendant duplicates, and hit
testing excludes locked or hidden ancestors. Rust renderer tests cover nested
transform composition alongside runtime selection tests.

The initial direct-selection slice is implemented for native paths. It adds a
separate direct-selection tool, complete-subpath and multi-anchor selection,
anchor and subpath movement, and quadratic and cubic control-handle rendering
and dragging. Path-edit previews recompute bounds and hit regions from the
preview document. Each completed geometry gesture produces one history entry,
with interaction coverage for preview, commit, and undo behavior.

The next direct path-editing slice covers:

- add and remove anchors
- open and close paths
- join compatible endpoints
- convert straight segments to curves and curves to straight segments

Path anchors, handles, and subpath selections are ephemeral editor state.
They are geometry owned by a path shape rather than independent durable
document records. Rust owns the deterministic path and hierarchy operations
that produce committed geometry; TypeScript owns tool state and low-latency
previews. The [native path geometry guide](apps/web/src/content/docs/internals/native-path-geometry.md)
defines this editing boundary.

Advanced vector operations such as boolean geometry, masks, gradients,
filters, and variable-width strokes can follow once the native path model and
basic editing workflow are proven.

### Direct CLI control

Make the CLI a predictable, fully capable document interface rather than a
permission boundary.

Direct CLI operations should be constrained by document correctness, causal
heads, validation, and ordinary document locks. They should not acquire extra
restrictions merely because the caller is classified as an agent.

The CLI should:

- expose the full native document mutation surface
- retain dry-run support
- retain causal-head and record-version checks
- retain validation and atomic transactions
- retain ordinary shape and layer locks
- remove agent-specific authorization behavior
- remain equally useful to humans, shell scripts, and agents

Caller origin may remain useful as provenance and history metadata, but should
not determine general CLI capability.

Agent authorization belongs at higher-level integration boundaries rather than
inside the general-purpose CLI.

### Permissioned MCP

Add an MCP server as Inkfinite's policy-aware interface for model-controlled
document access.

The MCP server should reuse the existing query and transaction engine rather
than defining another document API or mutation path.

Initial MCP capabilities should include:

- discover available Inkfinite documents and sessions
- inspect document state
- query records semantically or spatially
- create, modify, move, and delete shapes
- create and modify containers and layouts
- create and remove connections
- render or inspect affected content
- expose dry-run or preview behavior where useful

MCP should own agent-facing authorization policy, including:

- read-only versus writable access
- create, modify, and delete permissions
- structural and layout permissions
- `agent_editable` behavior
- per-document or per-session policy
- optional proposal and review workflows

The initial server should favor local stdio operation. Remote authentication,
hosted access, and network-facing MCP transports are separate concerns.

The CLI remains the low-level capability interface. MCP provides the
permissioned model-facing interface.

### Performance profiling

Build repeatable evidence around Inkfinite's performance rather than optimizing
speculatively.

Maintain representative fixtures for:

- small documents
- medium documents
- large documents
- vector-heavy documents
- deeply nested hierarchies
- imported SVG artwork
- connection-heavy diagrams

Profile and benchmark:

- document open
- document save
- Automerge materialization
- transaction application
- query latency
- Canvas frame time
- hit testing
- nested-transform traversal
- path rendering
- SVG import
- SVG export
- CLI startup and command latency
- local IPC round trips
- memory use

Record reference hardware and benchmark methodology alongside results.

Optimization should follow measured bottlenecks. Spatial indexes, render caches,
path caches, incremental materialization, alternate rendering backends, and
similar architecture changes should require evidence from representative
workloads.

## Prioritizing Correctness

Finish the smallest end-to-end path through the shared document model before
expanding feature coverage. For each slice, establish the durable Rust
representation and validation first, then bindings, rendering and hit testing,
transaction workflows, and interface-specific behavior. A feature is not done
when one entry point can create it; it must survive save and reopen, undo and
redo, CRDT merge, inspection, and deterministic export where applicable.

Use this order when work competes:

1. Protect document invariants and reject malformed durable state.
2. Preserve transaction atomicity, causal-head checks, and convergence.
3. Match geometry, transforms, bounds, fill, stroke, and hit testing across Rust
   and TypeScript.
4. Make unsupported or unauthorized operations explicit and non-destructive.
5. Add workflow and interoperability coverage before broadening the supported
   feature set.
6. Optimize only after a representative benchmark identifies the dominant cost.

Prefer executable examples over duplicated assertions. Shared Rust/TypeScript
fixtures should cover valid boundaries, invalid inputs, nested transforms, and
compound geometry. Round-trip tests should compare normalized structure where
representation matters and rendered output where visual equivalence matters.
Fuzz parsers and validation boundaries with size and recursion limits; keep any
minimized regression input as a fixture.

The following references define behavior rather than serving as optional design
inspiration:

- [SVG 2 paths](https://www.w3.org/TR/SVG2/paths.html) defines path grammar,
  subpaths, close behavior, and error handling.
- [SVG 2 coordinate systems](https://www.w3.org/TR/SVG2/coords.html) defines
  transforms, viewports, units, and bounding boxes.
- [SVG 2 painting](https://www.w3.org/TR/SVG2/painting.html) defines fill rules,
  strokes, markers, and paint order.
- [SVG 2 conformance and processing modes](https://www.w3.org/TR/SVG2/conform.html)
  distinguishes scripts, animation, interaction, and external resource loading.
  Import should choose and test a static, non-interactive policy rather than
  inheriting browser behavior accidentally.
- [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
  and [MCP security guidance](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
  guide permission failures and transport-specific authorization. The initial
  stdio server should receive credentials from its environment and must not
  treat document validation as authorization.
- The [Rust Fuzz Book](https://rust-fuzz.github.io/book/cargo-fuzz.html) describes
  `cargo-fuzz`, which should target SVG parsing, path normalization, transaction
  decoding, and durable validation once those boundaries exist.

## Engineering Principles

- Rust owns the durable document model and transaction engine.
- TypeScript owns low-latency interaction and Canvas rendering.
- All durable mutations pass through the same validated transaction boundary.
- Desktop, CLI, MCP, file operations, and future interfaces share one document
  model.
- Prefer native Inkfinite shapes over embedded foreign editing models.
- Keep document invariants separate from agent authorization policy.
- Keep low-level capability separate from higher-level permission boundaries.
- Add fixtures and regression coverage alongside feature work.
- Prefer measured optimization over speculative complexity.
- Record completed work in the changelog rather than retaining historical
  implementation plans in the roadmap.

## Later

Potential work after the current roadmap includes:

- vector boolean operations
- gradient editing
- clip-path editing
- mask editing
- SVG filter support
- richer vector stroke tooling
- additional import and export formats
- PWA and offline web installation
- richer agent skills
- packaging crates for crates.io
- packaged desktop releases
- hosted collaboration
- remote MCP access
- hosted sync and identity
