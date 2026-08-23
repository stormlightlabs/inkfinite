# Inkfinite

Inkfinite is a local-first infinite canvas for drawing, wireframing, and
diagramming. It runs in the browser or as a desktop app.

## What you can do

- Draw and edit rectangles, ellipses, lines, arrows, text, Markdown, freehand
  strokes, and native vector paths.
- Organize work with pages, layers, groups, nested containers, and a built-in
  stencil library.
- Pan, zoom, select, transform, reorder, style, undo, and redo directly on the
  canvas.
- Store boards in your browser or work with local, Automerge-backed
  `.inkfinite` files in the desktop app.
- Import static SVG, Excalidraw, and Obsidian Canvas content. Export SVG, PNG,
  Excalidraw, and Obsidian Canvas files.
- Inspect, query, edit, validate, and render saved files or open desktop sessions
  from the CLI.
- Let coding agents propose changes for review in the desktop app or apply them
  directly when you enable direct access.

## Run from source

You need Node.js 18 or newer, pnpm, and Rust 1.89. The desktop app also requires
the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

To get started, clone the repo & install the front-end toolchain/deps:

```sh
pnpm install
```

The browser app also needs the Rust WebAssembly target and the `wasm-bindgen`
CLI version used by `Cargo.lock`:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.126 --locked
pnpm wasm:build
pnpm dev:web # adding --open will open your browser
```

To start the desktop app:

```sh
pnpm tauri dev
```

To build the CLI used by scripts and live desktop sessions:

```sh
cargo build -p inkfinite-cli --bin inkfinite
./target/debug/inkfinite --help

# Build an installable release tree with the binary, man page, and completions.
cargo xtask dist
```

See the [CLI documentation](apps/web/src/content/docs/automation/cli.md) for
installation paths and shell completion setup.

## Documentation

- [Quickstart](apps/web/src/content/docs/quickstart.md)
- [Editor guide](apps/web/src/content/docs/guide/editor.md)
- [Import and export](apps/web/src/content/docs/guide/import-and-export.md)
- [Web platform](apps/web/src/content/docs/platforms/web.md)
- [Desktop platform](apps/web/src/content/docs/platforms/desktop.md)
- [CLI](apps/web/src/content/docs/automation/cli.md)
- [Agent workflows](apps/web/src/content/docs/automation/agents.md)
- [Architecture](apps/web/src/content/docs/development/architecture.md)

## Credits

I was inspired by fantastic apps in the space like [Excalidraw](https://github.com/excalidraw/excalidraw)
and more recently, tldraw. [tldraw offline](https://offline.tldraw.com/) in particular
was so cool that it kicked off [a lot](https://thndrs.stormlightlabs.org/)
[of other](https://sbuf.stormlightlabs.org/) [agent-capable](https://mire.stormlightlabs.org/)
projects.

The choice to use [perfect-freehand](https://www.npmjs.com/package/perfect-freehand) came
from playing around with [this](https://reactflow.dev/examples/whiteboard/freehand-draw)
react flow demo.

The SVG capabilities were inspired by this [post](https://aturi.to/explore/did:plc:p572wxnsuoogcrhlfrlizlrb/app.bsky.feed.post/3mth4fkaok2nl).

## License

Inkfinite is licensed under [Apache-2.0](LICENSE).
