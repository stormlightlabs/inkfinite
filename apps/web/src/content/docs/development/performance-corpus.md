---
title: Performance corpus and profiling
description: 'How Inkfinite measures document, process, renderer, and browser performance with shared fixtures.'
section: Development
group: Development
order: 24
---

Inkfinite measures performance with a shared, deterministic document corpus.
Native benchmarks, process measurements, renderer traversal, and browser
workloads use equivalent documents generated from the same profile, size, and
seed. Each result identifies the document shape, scale, operation, runtime, and
machine behind the timing.

## Corpus design

`fixtures/native/performance/corpus.json` defines a seed and six profiles.
Each profile is available at 100, 1,000, 5,000, and 10,000 shapes:

| Profile                  | Primary workload                                      |
| ------------------------ | ----------------------------------------------------- |
| `flat`                   | Root-level shapes and general document overhead       |
| `vector-heavy`           | Native paths and geometry traversal                   |
| `deeply-nested`          | Containers, transforms, and hierarchical selection    |
| `imported-svg`           | Native path records produced by the SVG import path   |
| `connection-heavy`       | Arrows and endpoint bindings                          |
| `semantic-binding-heavy` | Metadata, semantic queries, and relationship bindings |

The manifest is checked in instead of thousands of generated documents. Rust
and TypeScript materialize equivalent fixtures from the profile, size, and seed.
A fixture change is therefore reviewable, while every measurement still uses the
current document model.

A performance fixture should represent a real workload. Add a profile only when
an existing structure cannot expose the cost under investigation. Keep seeds
stable when comparing results. Record a new baseline when fixture semantics
change.

## Measurement layers

No single harness measures all of application performance. Inkfinite uses four
measurement layers:

1. **Native algorithms.** Criterion measures document load and save,
   materialization, validation, transactions, undo and redo, merge, queries,
   layout, SVG import and rendering, and scene rendering.
2. **Complete processes.** Hyperfine measures CLI startup and full `inspect`,
   `query`, `validate`, `render`, and mutation commands, plus MCP startup.
3. **Renderer traversal.** A Node harness runs the production editor renderer
   against a no-op Canvas context. It isolates scene traversal, culling,
   geometry dispatch, and renderer cache work. It does not measure pixels.
4. **Browser behavior.** Playwright and the Chrome DevTools Protocol drive the
   production web editor and collect frame, paint, raster, compositor,
   long-task, garbage-collection, heap, JS-to-WASM, and projection timings.

The browser workloads cover load, pan, zoom, box selection, object dragging,
vector editing, connected-shape movement, and nested selection. A separate
10,000-shape workload measures heap retention after sustained editing and active
document replacement.

## Running measurements

The private `@inkfinite/perf` package provides the TypeScript CLI. Run these
commands from the repository root. Each root command builds the packages it
needs before starting the measurement:

```sh
# Measure renderer traversal across the shared corpus
pnpm performance:capture

# Measure complete CLI and MCP timings for the flat 1,000-shape fixture
pnpm performance:process

# Measure representative browser interactions for the flat 1,000-shape fixture
pnpm performance:browser

# Run the slower 10,000-shape browser memory workload
pnpm performance:browser -- --memory

# Record one focused native CPU profile
pnpm performance:profile -- --filter 'transactions/commit/semantic-binding-heavy/100$'
```

After running `pnpm perf:build`, use
`node packages/perf/dist/cli.mjs <command> --help` to inspect filters and
expansion options. Process and browser measurements use the flat 1,000-shape
fixture by default. Use `--all-sizes` or `--all-profiles` only for a baseline
refresh or a scale-specific investigation. Browser heap retention is opt-in
with `--memory` because its 10,000-shape edit sequence is much slower than the
interaction baseline. The sequence waits for each edit's WebAssembly operation
and rendered frames before starting the next edit. Document replacement can
take up to two minutes at this size.

Run one Criterion benchmark when recording with Samply. End exact Criterion
filters with `$`: without it, a filter ending in `/1000` also matches `/10000`.
A profile that mixes unrelated operations is difficult to attribute and takes
much longer without producing better evidence.

## Reading results

Compact summaries are stored under `fixtures/native/performance/`. Browser
captures retain one gzipped Chrome trace for the first measured sample of each
workload. The summaries record fixture inputs, warmups, sample counts, tool
versions, and hardware alongside the measurements. Each measured timing also
records a machine-specific regression ceiling 20% above the selected baseline
statistic. Refresh that ceiling when the fixture, machine, or measurement method
changes.

Compare results only when the fixture, operation, build profile, and hardware
are compatible. Treat small changes near timer noise as inconclusive. Use
browser traces to explain frame and memory behavior, Criterion deltas to
identify native hot paths, and Samply to attribute CPU time after a benchmark
identifies a regression.

Do not use a renderer-traversal result as a browser frame budget. The no-op
Canvas harness excludes rasterization, text shaping, paint, compositing, GPU
work, and browser garbage collection. An algorithm benchmark also excludes CLI
startup, filesystem access, IPC, and serialization around that algorithm.

## Findings from August 2026

Focused load and commit profiles showed repeated materialization of an unchanged
Automerge projection. The native adapter now caches the validated projection
and clears it after every local or remote change. On the reference Apple M1,
the flat 10,000-shape Criterion load fell from about 6.75 seconds to about 3.77
seconds. A commit on the same fixture still takes about 3.59 seconds because the
current transaction path reconciles the full document.

The first completed 10,000-shape browser memory baseline took 150 seconds for
20 edits. The JavaScript heap was 310 MB above the pre-load reading after those
edits and 286 MB above it after active-document replacement. Use this capture to
investigate retained editor and WebAssembly state; it is not a memory target.

## Setting budgets and optimizing

Set a regression budget only after repeated measurements establish a stable
baseline. Record the dominant cost and choose the harness closest to the
user-visible behavior. Keep the budget wide enough for expected machine noise
but narrow enough to catch a meaningful regression.

Optimize the measured path instead of adding infrastructure speculatively. A
connection-heavy traversal regression can justify indexing bindings once per
render pass. A slow query may justify an index only after the query benchmark
and an end-to-end command measurement identify the same cost. Re-run the focused
measurement after the change, then run the representative baseline to check that
the optimization did not move work into another layer.
