---
title: Performance corpus and profiling
description: 'How Inkfinite measures document, process, renderer, and browser performance against shared fixtures.'
section: Development
group: Development
order: 24
---

Inkfinite measures performance against a shared, deterministic document corpus.
The same document structures drive native benchmarks, complete command
measurements, renderer traversal, and browser interactions. This makes a result
more useful than a standalone timing: it identifies the document shape, scale,
operation, runtime, and machine that produced it.

## Corpus design

`fixtures/native/performance/corpus.json` defines one seed and six document
profiles at 100, 1,000, 5,000, and 10,000 shapes:

| Profile                  | What it stresses                                      |
| ------------------------ | ----------------------------------------------------- |
| `flat`                   | Root-level shapes and general document overhead       |
| `vector-heavy`           | Native paths and geometry traversal                   |
| `deeply-nested`          | Containers, transforms, and hierarchical selection    |
| `imported-svg`           | Native path records produced by the SVG pipeline      |
| `connection-heavy`       | Arrows and endpoint bindings                          |
| `semantic-binding-heavy` | Metadata, semantic queries, and relationship bindings |

The manifest is checked in instead of thousands of generated documents. Rust
and TypeScript materialize equivalent fixtures from the profile, size, and
seed. A fixture change is therefore reviewable, while every measurement still
uses the current document model.

A performance fixture should represent a real workload. Add a profile only when
an existing structure cannot expose the cost under investigation. Keep seeds
stable when comparing results, and record a new baseline when fixture semantics
change.

## Measurement layers

No single harness describes application performance. Inkfinite separates four
measurement layers:

1. **Native algorithms.** Criterion measures document load, save,
   materialization, validation, transactions, undo and redo, merge, queries,
   layout, SVG import and render, and scene rendering.
2. **Complete processes.** Hyperfine measures CLI startup and full `inspect`,
   `query`, `validate`, `render`, and mutation commands, plus MCP startup.
3. **Renderer traversal.** A Node harness runs the production editor renderer
   against a no-op Canvas context. It isolates scene traversal, culling,
   geometry dispatch, and renderer cache work. It does not measure pixels.
4. **Browser behavior.** Playwright and Chrome DevTools Protocol drive the
   production web editor and collect frame, paint, raster, compositor,
   long-task, garbage-collection, heap, JS-to-WASM, and projection timings.

The browser workloads cover load, pan, zoom, box selection, object dragging,
vector editing, connected-shape movement, and nested selection. A separate
10,000-shape workload checks heap retention after sustained editing and active
document replacement.

## Running measurements

The private `@inkfinite/perf` package provides the TypeScript CLI. Root commands
build the required packages before starting a measurement:

```sh
# Renderer traversal across the shared corpus
pnpm performance:capture

# Complete CLI and MCP timings for the flat 1,000-shape fixture
pnpm performance:process

# Representative browser interactions for the flat 1,000-shape fixture
pnpm performance:browser

# The slower 10,000-shape browser memory workload
pnpm performance:browser -- --memory

# One focused native CPU profile
pnpm performance:profile -- --filter 'transactions/commit/semantic-binding-heavy/100$'
```

Use `node packages/perf/dist/cli.mjs <command> --help` after running
`pnpm perf:build` to inspect filters and expansion options. The browser command
uses a representative 1,000-shape interaction run by default. Process
measurements use the same size. Request `--all-sizes` or `--all-profiles` only
for a baseline refresh or a scale-specific investigation. Browser heap
retention is also opt-in with `--memory` because its 10,000-shape edit sequence
is much slower than the interaction baseline.

Run one Criterion benchmark when recording with Samply. End exact Criterion
filters with `$`: without it, a filter ending in `/1000` also matches `/10000`.
A profile that mixes unrelated operations is difficult to attribute and takes
much longer without producing better evidence.

## Reading results

Compact summaries live under `fixtures/native/performance/`. Browser captures
retain one gzipped Chrome trace for the first measured sample of each workload.
The summaries record fixture inputs, warmups, sample counts, tool versions, and
hardware alongside the measurements. Each measured timing also records a
machine-specific regression ceiling 20% above the selected baseline statistic.
Refresh that ceiling when the fixture, machine, or measurement method changes.

Compare results only when the fixture, operation, build profile, and hardware
are compatible. Treat small changes near timer noise as inconclusive. Browser
traces explain frame and memory behavior; Criterion deltas explain native hot
paths; Samply attributes CPU time after a benchmark identifies a regression.

A traversal result is not a browser frame budget. The no-op Canvas harness
excludes rasterization, text shaping, paint, compositing, GPU work, and browser
garbage collection. Likewise, an algorithm benchmark does not include CLI
startup, filesystem access, IPC, or serialization around that algorithm.

## Setting budgets and optimizing

Set a regression budget only after repeated current measurements establish a
stable baseline. Record the dominant cost and choose the harness closest to the
user-visible behavior. Keep the budget wide enough for expected machine noise
but narrow enough to catch a meaningful regression.

Optimize the measured path rather than adding infrastructure speculatively. A
connection-heavy traversal regression, for example, can justify indexing
bindings once per render pass. A slow query may justify an index only after the
query benchmark and an end-to-end command measurement identify the same cost.
Re-run the focused measurement after the change, then run the representative
baseline to check that the optimization did not move work into another layer.
