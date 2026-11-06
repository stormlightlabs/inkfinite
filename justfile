# Inkfinite's repository commands. `just check` is the gate: run it before
# pushing.

# List the recipes.
default:
    @just --list

# Run the gate: Rust formatting, Clippy and tests, then every pnpm check and test.
check: rust-check js-check

# Check Rust formatting, run Clippy with warnings denied, then run the Rust tests.
rust-check:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    cargo test --workspace --all-features

# `pnpm test` builds the WebAssembly, core and editor packages before testing, and
# includes `pnpm bindings:test`. `pnpm check` type-checks against those builds, so it
# runs second; it includes `pnpm bindings:check` and `pnpm lint`.

# Check formatting, run the workspace tests, then check bindings, Svelte, TypeScript and lint.
js-check:
    pnpm format:check
    pnpm test
    pnpm check

# Run the Playwright visual tests. They need browsers, so the gate leaves them out.
visual:
    pnpm test:visual
