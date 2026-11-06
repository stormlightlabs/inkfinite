---
title: Building from source
description: Set up Rust, WebAssembly, Svelte, and Tauri development for Inkfinite.
section: Development
group: Development
order: 19
---

Inkfinite is a pnpm workspace with Rust crates, a WebAssembly document engine, a Svelte web app,
and a Tauri desktop shell.

## Requirements

Install Node.js 18 or newer, pnpm, and Rust 1.89. Install the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system
too: the repository checks build the desktop crate, so they're needed even if you only work
on the web app or the CLI.

From the repository root, install JavaScript packages:

```sh
pnpm install
```

Add the WebAssembly target and install the `wasm-bindgen` CLI version used by `Cargo.lock`:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.126 --locked
pnpm wasm:build
```

## Run the applications

Start the documentation site and web editor:

```sh
pnpm dev:web
```

Open the printed local URL for the site or its `/app` route for the editor. Start the desktop app
with:

```sh
pnpm tauri dev
```

## Workspace commands

Build the CLI with Cargo or create target-named CLI and MCP release archives:

```sh
cargo build -p inkfinite-cli
cargo xtask dist
```

Generate TypeScript bindings after changing shared Rust types:

```sh
pnpm bindings:generate
```

Run the repository checks from the root with [just](https://github.com/casey/just):

```sh
cargo install just --locked
just check
```

`just check` runs Rust formatting, Clippy with warnings denied, the Rust tests,
`pnpm format:check`, `pnpm test` and `pnpm check`. It leaves out the Playwright visual
tests, which need browsers; run those with `just visual`.

See [Testing](/docs/development/testing/) for focused package and Playwright commands. See
[Performance corpus and profiling](/docs/development/performance-corpus/) for native, process,
renderer, and browser measurements.
