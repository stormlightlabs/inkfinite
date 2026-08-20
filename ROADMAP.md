# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents.

The desktop app, CLI, and programmatic interfaces operate on the same native
document model and transaction engine. New work should extend that model rather
than introduce alternate document representations or mutation paths.

Completed work is recorded in [CHANGELOG.md](CHANGELOG.md). Concrete
implementation work lives in [TODO.md](TODO.md).

## Current Direction

### SVG interoperability

Make SVG a first-class interchange format.

Inkfinite should be able to import useful SVG content into its native document
model, edit that content as ordinary shapes, and export deterministic SVG
without introducing an SVG-specific document model.

SVG import should map supported elements onto native Inkfinite concepts:

- groups become containers
- basic primitives become existing shape kinds
- arbitrary vector geometry becomes native paths
- transforms become parent-relative Inkfinite transforms
- fills, strokes, opacity, and other supported styles become native style data
- embedded images become assets

The original SVG source may be retained as an asset for provenance, fallback,
and future re-import.

Unsupported SVG features should degrade explicitly rather than silently
disappear. Content that cannot yet be represented natively may use an opaque
SVG-backed fallback while remaining movable, scalable, rotatable, and
deletable like other Inkfinite content.

SVG interoperability must use the same transaction, persistence, undo/redo,
CRDT, desktop, and CLI paths as content created directly in Inkfinite.

### Vector editing

Build native vector editing on top of the path representation introduced for
SVG interoperability.

Object-level editing comes first:

- select an imported SVG as one object
- enter and leave nested groups
- select individual vector elements
- move, resize, rotate, reparent, and restyle nested shapes
- preserve world-space appearance when changing hierarchy

Direct path editing follows:

- select path subpaths
- select one or more anchors
- move anchors
- manipulate quadratic and cubic Bezier handles
- add and remove anchors
- open and close paths
- join compatible endpoints
- convert straight segments to curves and curves to straight segments

Path anchors, handles, and subpath selections are ephemeral editor state.
They are geometry owned by a path shape rather than independent durable
document records.

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
