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
      in the forks pool, and fail aliases such as`$editor`.
- The user will stage files so don't be alarmed by that. Try to not rely on git for
  reviewing the state of your edits.
- Refrain from using the words "bounded" & "durable" and the phrase "load-bearing"

## Verification

For affected editor surfaces, run the relevant capture scripts (or add new ones) and inspect
`scripts/images/__screenshots__` at their full captured size. These are in `scripts/images/*.mjs`

### Code Quality

```sh
cargo fmt --all -- --check
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
pnpm format:check
pnpm bindings:check
pnpm bindings:test
pnpm test
pnpm check
pnpm lint
```
