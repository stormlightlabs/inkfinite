# Agent Guide

## Rules

- Use writing rust & reviewing rust when appropriate
- Always using the writing skill when updating documentation
    - Write TSDoc/rustdoc comments for exported/public and contextually important symbols
      for maintainers
- Helpers need more than 1 call-site to justify abstraction
- Prefer the smallest end-to-end path through the shared document model before widening a
  feature's surface. Verify save/reopen, undo/redo, merge, inspection, and export where they apply.
- Add shared fixtures and regression coverage with feature work. Optimize from measured bottlenecks
  rather than speculative architecture.
- Run the full test suite through the root `pnpm test` command, or run a package's
  Vitest command from that package's directory.
    - Do not invoke a package-local vitest from the repository root Vitest will miss the
      package Vite config, collect unrelated generated Svelte tests, run browser imports
      in the forks pool, and fail aliases such as `$editor`.
- The user will stage files so don't be alarmed by that. Try to not rely on git for
  reviewing the state of your edits.
- Refrain from using the words "bounded" & "durable" and the phrase "load-bearing"

## Architecture

For source ownership, dependency directions, and adapter boundaries, read the
[architecture guide](apps/web/src/content/docs/development/architecture.md) before reorganizing
internals. Keep `inkfinite-core` as one crate and follow that guide when deciding where new code
belongs.

## Verification

For affected editor surfaces, run the relevant Playwright visual tests (or add new ones) and
inspect the baselines in `apps/web/e2e/visual/*-snapshots/` at their full captured size.

`cargo clean` regularly as not to fill up too much space on disk.

### Gate

Run `just check` before pushing. The justfile lists its steps: Rust formatting, Clippy and
tests, then `pnpm format:check`, `pnpm test` and `pnpm check`. It needs the toolchain and
Tauri packages from the [build guide](apps/web/src/content/docs/development/building-from-source.md).
Run `just visual` for the Playwright visual tests when a change affects the editor.

## Commits and pull requests

- Titles follow [Conventional Commits](https://www.conventionalcommits.org/), lowercase:
  `feat: add lasso selection`.
- Descriptions say what changed and why, briefly. Verification goes in a PR comment.

## Tasks

Work is tracked in the Inkfinite team in Linear (`INK-<n>`), through the Linear connector.

- Start: set In Progress. Only start a task whose blockers are done; otherwise ask.
- Complete: comment `Done in #<pr> at <sha>: <summary>`, then set Done.
- Hand off: comment the handoff note, then set Backlog.
- Breaking work down: projects or milestones, parent issues, sub-issues, blocked-by links.
- Record bugs found along the way as new issues instead of fixing them in the same change.
- Finish issues labeled `Before features` before starting feature work.
