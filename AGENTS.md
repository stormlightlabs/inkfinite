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

Run the gate before pushing:

```sh
just check
```

It runs, in order:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace --all-features`
- `pnpm format:check`
- `pnpm test`, which builds the WebAssembly, core and editor packages and includes
  `pnpm bindings:test`
- `pnpm check`, which includes `pnpm bindings:check` and `pnpm lint`. It type-checks
  against the packages `pnpm test` builds, so it has to run after it.

It needs `just`, the `wasm32-unknown-unknown` target, the `wasm-bindgen` CLI and the
Tauri 2 system packages, all listed in the
[build guide](apps/web/src/content/docs/development/building-from-source.md). Clippy and
the Rust tests build the desktop crate, so the Tauri packages are needed even for changes
that don't touch the desktop app.
The gate leaves out the Playwright visual tests because they need browsers. Run them
with `just visual` when a change affects an editor surface.

## Tasks

Inkfinite's work is tracked in the Inkfinite team in Linear (issue key `INK`). Use the
session's Linear connector for every step; subagents report back to the session and do
not need their own access.

| Step            | In Linear                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- |
| Read a task     | `get_issue INK-<n>`, its comments with `list_comments`, and its project with `get_project`  |
| Check readiness | Status is Todo and every blocked-by issue is Done or Canceled                               |
| Start           | `save_issue` with `state: "In Progress"`                                                    |
| Complete        | `save_comment` with `Done in #<pr> at <sha>: <summary>`, then `save_issue` with `state: "Done"` |
| Hand off        | `save_comment` with the handoff note, then `save_issue` with `state: "Backlog"`             |
| Pick up         | Read the latest handoff comment, then `save_issue` with `state: "In Progress"`              |
| Record new work | `save_issue` with `team: "Inkfinite"` and the project it belongs to                         |
| Record an idea  | `save_document` on the Inkfinite team                                                       |
| Record a spec   | `save_document` on the project it belongs to                                                |

When breaking work down, write these records:

| Primitive  | In Linear                                         |
| ---------- | ------------------------------------------------- |
| Collection | A project, or a milestone inside one              |
| Run unit   | A parent issue in that project                    |
| Task       | A sub-issue (`save_issue` with `parentId`)         |
| Dependency | A blocked-by link (`save_issue` with `blockedBy`) |

- Don't start a task that isn't ready. Ask the owner first, and say what it waits on.
- Record bugs and new work found along the way as new issues. Mention them in the pull
  request; don't fix them in the same change unless the owner asks.
- Issues labeled `Before features` gate feature work. Finish them before starting
  feature issues.
