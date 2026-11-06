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

# Check Prettier formatting, bindings drift, Svelte and TypeScript, and lint, then run
# the workspace tests. `pnpm check` includes `pnpm bindings:check` and `pnpm lint`;
# `pnpm test` builds the WebAssembly package and includes `pnpm bindings:test`.
js-check:
    pnpm format:check
    pnpm check
    pnpm test

# Run the Playwright visual tests. They need browsers, so the gate leaves them out.
visual:
    pnpm test:visual
