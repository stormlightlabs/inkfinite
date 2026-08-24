# Performance corpus

`corpus.json` is the shared deterministic fixture description used by the Rust
Criterion benchmarks and the editor renderer traversal harness. It defines
100-, 1,000-, 5,000-, and 10,000-shape cases for flat, vector-heavy,
deeply-nested, imported-SVG, connection-heavy, and semantic/binding-heavy
documents.

The manifest is the fixture source rather than a checked-in copy of every
materialized document. Each harness builds the current native or editor
projection from the same profile, size, and seed. This keeps the corpus small
while making fixture changes reviewable.

## Native benchmarks

Run the Criterion suite with the release-like profiling profile when collecting
native samples:

```sh
cargo bench -p inkfinite-core --bench performance --profile profiling
```

Use a Criterion filter to focus on one profile or operation, for example:

```sh
cargo bench -p inkfinite-core --bench performance --profile profiling -- flat/vector-heavy
```

The native group includes validation, commit, separate undo and redo, remote
change merge, semantic queries, layout, SVG import/render, and renderer
algorithm measurements. Generated SVG imports scale with the 100, 1,000,
5,000, and 10,000 shape cases.

To capture a confirmed hotspot with `samply`, select a Criterion benchmark and
write the profiler output to `profiles/`:

```sh
pnpm performance:profile -- --filter 'transactions/commit/semantic-binding-heavy/100$'
```

The profiling command uses the `profiling` Cargo profile so symbols remain
available while release optimizations are enabled. Profile only a focused
benchmark; the full Criterion corpus is too broad for useful attribution.

## Renderer traversal

Build the current editor package, then capture traversal-only timings:

```sh
pnpm --filter @inkfinite/core build
pnpm --filter @inkfinite/editor build
pnpm performance:capture
```

The Node harness uses the production editor renderer with a no-op Canvas 2D
context. It measures JavaScript scene traversal, culling, geometry dispatch,
and cache work only. It does not measure browser rasterization, text shaping,
compositing, GPU work, paint, or garbage collection. Use Playwright and Chrome
DevTools Protocol for those measurements.

The capture records the seed, fixture profile and size, warmups, samples,
hardware, Node/tool versions, and the sampling method in
`rendering-budget.json`.

## Browser measurements

Run the browser capture for real Chrome editor workloads with:

```sh
pnpm performance:browser
```

The default capture measures the flat 1,000-shape fixture with three samples
and one warmup per workload. Run the slower 10,000-shape heap-retention workload
with `--memory`. This is the reference baseline; broader corpus sweeps must be
requested explicitly.

The harness starts a Vite server, seeds the shared corpus through the browser's
IndexedDB adapter, and drives the production editor with Playwright. It covers
load, pan, zoom, box selection, single- and multi-object drag, vector editing,
connected-shape movement, and nested selection. Workloads that do not match the
selected document profile are recorded as skipped.

Chrome DevTools Protocol collects frame, paint, raster, compositor, long-task,
GC, and heap data. Browser performance marks measure document-engine worker
requests and editor projection/store updates. For a 10,000-shape selection, the
memory workload opens the board, performs 20 alternating drags, and replaces
the active board before collecting heap measurements. It waits for each
WebAssembly operation and rendered frames before starting the next drag, then
allows up to two minutes for document replacement.

The summary is written to
`fixtures/native/performance/browser-budget.json`. The August 2026 reference
capture completed the edit sequence in 150 seconds. JavaScript heap use was 310
MB above the pre-load reading after editing and 286 MB above it after document
replacement; use these values to investigate retention, not as target limits. The first measured sample
for each workload also writes a gzipped diagnostic trace to
`fixtures/native/performance/browser-traces/`. Use `--all-profiles`,
`--all-sizes`, `--samples`, `--warmups`, and `--no-traces` to control the
capture. Use `--memory` to include heap retention. The harness does not
enable Playwright's interaction tracing, which would change the workload being
measured.

## Complete process measurements

Install [`hyperfine`](https://github.com/sharkdp/hyperfine), then run:

```sh
pnpm performance:process
```

This builds the profiling CLI, MCP server, and fixture emitter, materializes
the shared corpus, and measures complete CLI `inspect`, `query`, `validate`,
`render`, and `shape patch` commands for the 1,000-shape `flat` profile by
default. Use `--size`, `--all-sizes`, `--profile semantic-binding-heavy`, or
`--all-profiles` for a scale-specific investigation or baseline refresh. Mutation samples
start from a fresh fixture copy. The same run measures MCP startup by
sending one JSON-RPC `initialize` request and closing stdin. Results include
hyperfine's individual sample times in `process-budget.json`; the startup
helper terminates after the first response. Do not compare captures across
different hardware without recording the new machine details.
For attribution rather than timing, set `RUST_LOG=inkfinite_core=info`
(or include `inkfinite_mcp` and run the MCP server) to emit span-close times to
stderr. Keep tracing disabled for clean latency captures.
