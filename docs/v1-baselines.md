# V1 compatibility baselines

V2-01 freezes the current document behavior before the v2 model and CRDT work
begins. The fixtures in [`fixtures/v1`](../fixtures/v1) are compatibility inputs,
not examples of the planned v2 format.

## Fixture set

- `desktop/all-features.inkfinite.json` is a complete desktop file.
- `web/all-features.web.json` is the equivalent web export.
- `invalid/` contains malformed JSON, an incomplete desktop envelope, dangling
  references, and duplicate persisted ordering.
- `rendering/all-shapes.json` fixes the renderer state and draw order.
- `history/history-edits.json` records update, style, delete, and undo behavior.
- `performance/board-10000.inkfinite.json` contains 10,000 deterministic shapes.
  Its seed is recorded in the file and in `manifest.json`.
- `performance/baseline.json` records the reference machine, runtime versions,
  visible-shape count, frame time, hit-test time, memory, open time, and save
  time.

The all-features document covers every v1 shape kind, both arrow binding anchor
forms, two groups, two pages, Markdown, every built-in stencil output, and an
overlapping page whose `shapeIds` order determines rendering and hit testing.
The history fixture is separate because v1 persists document snapshots but does
not persist the undo stack.

## Regenerate fixtures

Run the deterministic generator after an intentional v1 compatibility change:

```sh
pnpm fixtures:v1
```

Review every generated change. Do not regenerate fixtures to make a regression
pass. Invalid fixtures must remain invalid.

## Capture performance

Build the two packages used by the harness, then capture a new machine-specific
result:

```sh
pnpm --filter @inkfinite/core build
pnpm --filter @inkfinite/renderer build
pnpm baseline:v1
```

The frame measurement runs the production renderer with a no-op Canvas 2D
context. It isolates JavaScript traversal from GPU and display timing. The v1
renderer visits all 10,000 shapes even though only the separately recorded
visible count intersects the 1280×720 viewport. V2-01 sets no performance
budget; later tickets compare their results with this captured file.

## Verification commands

Install dependencies and the browser used by the web suite before the first
run. The repository currently runs browser tests through the installed Chrome
channel.

```sh
pnpm install
pnpm --filter @inkfinite/core test --run
pnpm --filter @inkfinite/renderer test --run
pnpm --filter @inkfinite/web test
pnpm --filter @inkfinite/core typecheck
pnpm --filter @inkfinite/renderer typecheck
pnpm --filter @inkfinite/web check
pnpm --filter @inkfinite/web lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The cursor baseline reads canvas bounds and viewport dimensions again after a
resize. Invalid documents are asserted as failures. As of July 17, 2026, all
documented verification commands pass: 748 core tests, 20 renderer tests, and
189 web tests, plus type checks, Svelte checks, lint, formatting, and desktop
Rust tests.
