---
title: Testing
description: 'How Inkfinite tests document behavior, editor workflows, and visual changes.'
section: Development
group: Development
order: 23
---

Inkfinite keeps fast correctness checks close to the code they protect. Rust and
Vitest suites cover the document model, interchange boundaries, persistence,
and component behavior. Playwright covers editor workflows that need the full
web app.

Run the complete unit and integration suite from the repository root:

```sh
pnpm test
```

## Component states

Storybook stories in `packages/ui/src/` cover shared controls and complete editor states in light and
dark themes. Include hover, pressed, selected, disabled, busy, and focus-visible states when they
apply to a component. Menus and popovers should also show dismissal, focus restoration, and
viewport-edge placement.

```sh
pnpm dev:ui
pnpm --filter @inkfinite/ui storybook:build
```

## Editor end-to-end tests

`apps/web/e2e/` contains behavioral and visual Playwright tests. The shared
`InkfiniteEditor` fixture provides a small set of canvas operations such as
choosing tools, dragging, drawing rectangles, and selecting objects. Tests
should use accessible locators for controls and keep coordinate-based input
inside these canvas operations.

Behavioral tests assert what the editor does. Visual tests use the `@visual` tag
and Playwright's `toHaveScreenshot()` matcher to compare the rendered result
with checked-in baselines.

```sh
# Run behavioral and visual editor tests
pnpm test:e2e

# Compare visual baselines only
pnpm test:visual

# Review and accept an intentional visual change
pnpm test:visual:update

# Inspect or debug tests interactively from apps/web
pnpm test:e2e:ui
```

The Playwright runner starts the web app, fixes the viewport and theme, waits
for fonts, hides screenshot carets, and retains traces on failures. It runs the
editor tests serially because simultaneous editor startup makes the development
server and WebAssembly initialization unreliable.

Review every changed baseline at its captured size before accepting it. Keep the
browser channel, fonts, operating system, and headless mode consistent when
creating authoritative baselines because those inputs can change rasterization.
Playwright writes actual, expected, and diff images under `apps/web/test-results/`
when a comparison fails.

Standalone scripts remain appropriate for profiling and publication assets.
UI validation belongs in the Playwright suite rather than a script that starts
Vite, launches a browser, and writes passive screenshots.

## SVG import fixture corpus

`fixtures/svg-import/` contains the checked-in inputs used by the Rust SVG
import integration tests. Icon and logo inputs are derived from the Catppuccin,
Simple Icons, Skill Icons, and Devicon Plain Iconify sets. The corpus also
covers nested group transforms, compound even-odd paths, unsupported features
and active content, and malformed XML, numbers, paths, and transforms.

The fixture tests check native node counts, source retention, `currentColor`,
path validation, fill rules, warning coverage, and typed failures. Add a
minimized fixture when a real SVG exposes an importer regression.

Run the focused suite with:

```sh
cargo test -p inkfinite-core --test svg_import_fixtures
```

The source and licenses for the Iconify-derived inputs are listed in the
repository's `fixtures/svg-import/README.md`.
