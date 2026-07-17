# V2-02 Automerge boundary proof

This disposable spike tests Automerge behind `ProofDocument`, an Inkfinite-owned
interface. Production crates and packages must define their own types in later
tickets; they must not import this proof.

The suites cover:

- nested maps, ordered child lists, collaborative text, and the V1 10,000-shape
  fixture in Rust and JavaScript;
- compact binary exchange in both directions between Rust and JavaScript;
- concurrent property, list, text, delete, and reparent edits, merged in both
  orders and compared as materialized snapshots;
- patches, causal heads, explicit actor IDs, actor-scoped compensating undo,
  transport-independent sync, save/load, incremental journals, and compaction;
- merge-on-fork repair for duplicate children, missing parents, dangling
  bindings, and pages with no layers. The live document is unchanged until the
  repaired candidate passes validation.

## Run the proof

Install workspace dependencies once, then run the complete suite twice:

```sh
pnpm install
pnpm proof:v2-02:twice
```

Run the Rust suite directly when changing the adapter or repair rules:

```sh
cargo test --manifest-path spikes/crdt-automerge/Cargo.toml
```

Capture a machine-specific result with:

```sh
pnpm proof:v2-02:benchmark
```

The benchmark writes [`results/benchmark.json`](results/benchmark.json). It
imports, saves, and reloads the frozen V1 board; records resident memory and
compact storage; and measures an incremental journal followed by compaction.
The V1 baseline parses plain JSON, while the import measurement constructs CRDT
objects and history, so their open/save times are context rather than equivalent
hot-path comparisons.

## Decision

Automerge passed the semantic, convergence, repair, sync, and cross-language
gates. Yjs/Yrs was not evaluated because the fallback condition did not occur.
The production architecture will use the Rust Automerge crate behind Inkfinite
contracts; JavaScript will consume materialized snapshots and patches instead of
holding the authoritative CRDT.

V2-03 upgraded the workspace from the V2-01 Rust 1.88 baseline to Rust 1.89 and
moved this proof from Automerge Rust 0.6.1 to 0.10.0. The full fixed-seed proof
passed twice with `@automerge/automerge` 3.2.6 and produced identical snapshots.
Production crates continue to hide Automerge behind Inkfinite-owned contracts.
