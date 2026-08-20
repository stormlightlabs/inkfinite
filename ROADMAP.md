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

The original SVG source is retained as an asset for provenance, future
re-import, and fallback handling.

Desktop file-menu imports and the CLI already use the Rust importer and shared
SVG transaction builder. Browser file selection, drop, and pasted markup still
use a separate TypeScript parser, which supports a smaller SVG subset and can
produce different geometry, hierarchy, style, warning, and asset results. The
browser importer should be replaced rather than extended in parallel.

A small browser-facing WASM crate should call the importer in
`inkfinite-core`. The WASM API should expose a serializable normalized tree,
source and embedded assets, structured warnings and errors, and omitted-image
counts. TypeScript bindings should be generated or checked from that result
schema so the browser does not acquire another handwritten importer contract.
The core parser and normalization logic remain in Rust; the WASM crate is only
the browser adapter.

The web app should initialize and run WASM in a dedicated worker. It should
lazy-load the module, reuse one initialized worker across imports, and transfer
file bytes rather than parse on the main thread. The worker must enforce the
same 16 MB input limit and report failures without leaving the editor in a busy
state. Excalidraw and JSON Canvas imports should not wait for SVG WASM to load.

The browser projects the normalized Rust result into its local document model,
preserving groups, local transforms, styles, fill rules, warnings, and assets.
Each completed import is committed as one document transaction and one undo
step. Once file selection, drag-and-drop, and pasted markup use this path, the
handwritten TypeScript SVG parser can be removed.

The Bootstrap `filetype-svg` icon is the regression fixture for the original
browser failure. It combines inherited `currentColor`, `evenodd`, relative
commands, horizontal and vertical commands, arcs, and a compound path. Native
and browser-WASM tests should compare normalized geometry, hierarchy, styles,
warnings, source assets, and bounds. The imported result should be one editable
path, resolve `currentColor` to concrete SVG paint, normalize arcs to cubic
segments, retain `evenodd`, and match the artwork in its 16×16 viewBox. Canvas
output should also agree visually with deterministic Rust SVG output; malformed,
oversized, unsupported-feature, and embedded-image inputs must cross the worker
boundary with the same outcomes as native import.

Desktop imports into the active layer; browser imports create a new local board
using the browser persistence adapter; CLI imports can target a file or a live
desktop session.

Unsupported SVG features should be reported explicitly and preserve a path to
opaque fallback rather than silently disappearing.

The importer has a checked-in fixture corpus under
[`fixtures/svg-import`](fixtures/svg-import/). It includes Iconify-derived
icons and logos, nested groups, compound paths, unsupported features, and
malformed inputs. Rust and browser-WASM tests should exercise this corpus rather
than maintain separate fixtures. They must validate native mappings, warning
coverage, geometry semantics, and failure behavior as the supported SVG subset
grows.

SVG interoperability must use the same transaction, persistence, undo/redo,
CRDT, desktop, and CLI paths as content created directly in Inkfinite.

The [native path geometry guide](apps/web/src/content/docs/internals/native-path-geometry.md)
documents the native representation, fill rules, validation, exact bounds,
rendering, hit testing, and fixture coverage used by later import and editing work.

### WASM

Use WebAssembly to bring Inkfinite's canonical Rust semantics to the browser,
not to replace the browser editor. Rust should own document meaning while
TypeScript continues to own immediate interaction and browser APIs.

The web app currently persists a TypeScript document graph in Dexie, while the
desktop app and CLI use the Rust transaction engine and Automerge document.
Desktop projection also flattens native hierarchy without composing every
ancestor transform, and its reverse mirror can delete and recreate the scene for
an ordinary edit. Shared TypeScript types do not prevent these execution paths
from diverging.

The first step is a thin `inkfinite-wasm` facade. SVG import establishes the
build, packaging, worker, and binding path. Deterministic SVG export should use
the Rust renderer through the same facade so browser, desktop, and CLI output
share hierarchy, bounds, and serialization behavior. Canvas rendering and PNG
export remain in TypeScript.

The second step moves native-to-editor projection and editor-to-native
reconciliation into Rust. Projection must compose hierarchy transforms into a
consistent editor view. Editor commits should describe semantic changes such as
moving, resizing, restyling, reparenting, or changing path geometry. Rust should
translate those changes into minimal validated transactions instead of replacing
the scene. Native and WASM callers should exercise the same projection and
reconciliation fixtures.

The third step makes the browser document session stateful in WASM. It should
open, mutate, undo, redo, and save the same canonical Automerge document used by
native entry points. IndexedDB remains the browser storage adapter, but stores
canonical document bytes rather than acting as a second shape graph. Existing
browser documents need an explicit migration before the Dexie graph can stop
being the source of truth.

The JS/WASM boundary should carry coarse operations and batches. Strings,
objects, and arrays may require conversion or copying, so pointer movement,
hover, selection, camera state, drag previews, snap guides, Canvas rendering,
and DOM/Svelte work remain in TypeScript. A persistent WASM session avoids
serializing the complete document for each operation.

Rust remains authoritative for committed path geometry, exact bounds,
transforms, reparenting, topology, arc conversion, validation, and final
freehand normalization. TypeScript may keep fast previews, cached bounds, hit
testing, and selection geometry for responsive interaction. Shared fixtures
must keep those previews acceptably aligned with committed results. Batched WASM
geometry queries should be considered only when profiling shows a need.

Excalidraw and JSON Canvas conversion can remain TypeScript-only while they are
browser conveniences. Move them into Rust when desktop, CLI, or MCP also need
them. TypeScript history likewise continues to own ephemeral editor state;
durable document undo and redo belong to the Rust session.

This sequencing leads to one document engine across browser, desktop, CLI, and
future MCP access without placing the frame-by-frame editor loop behind WASM.

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
