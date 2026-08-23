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
