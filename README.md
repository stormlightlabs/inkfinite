# Inkfinite

Inkfinite is a local-first infinite canvas for drawing, wireframing, and
diagramming. It runs in the browser or as a desktop app.

## What you can do

- Draw rectangles, ellipses, lines, arrows, text, Markdown, and freehand strokes.
- Organize work with pages, layers, groups, and a built-in stencil library.
- Pan, zoom, select, resize, reorder, undo, and redo directly on the canvas.
- Store documents in your browser (`idb`) or work with local `.inkfinite` files in the
  desktop app.
- Inspect and validate `.inkfinite` files from scripts with the CLI.

Inkfinite is under active development. [TODO.md](TODO.md) shows what is being
built next, while [ROADMAP.md](ROADMAP.md) covers the longer-term direction and
technical decisions.

## Run from source

You need Node.js 18 or newer, pnpm, and Rust 1.89. The desktop app also requires
the platform dependencies used by Tauri 2.

Install the workspace from the repository root:

```sh
pnpm install
```

Start the browser app:

```sh
pnpm dev:web
```

Start the desktop app:

```sh
pnpm tauri dev
```

## Command-line interface

The `inkfinite` CLI works on `.inkfinite` files while the desktop app is closed.
Run it through Cargo during development:

```sh
inkfinite new architecture.inkfinite
inkfinite inspect architecture.inkfinite
inkfinite validate architecture.inkfinite
```

Use `query` to find records by ID, name, role, tag, shape kind, page, layer,
parent, or bounds:

```sh
inkfinite query architecture.inkfinite --role architecture.service --json
```

The CLI can also print its schemas and capability contract:

```sh
cargo run -p inkfinite-cli --bin inkfinite -- schema document
cargo run -p inkfinite-cli --bin inkfinite -- capabilities --json
```

Run `inkfinite --help` for examples and the complete command reference.

## Inkfinite files

Canonical `.inkfinite` files contain the document and its change history in a
compact Automerge format.

The desktop app and CLI protect writes with file locks, atomic replacement, and
recovery data.

## Repository layout

Inkfinite is a pnpm monorepo and Cargo workspace:

```sh
.
├── apps/
│   ├── web/                 # Static SvelteKit app with Dexie persistence
│   └── desktop/             # Tauri app backed by Rust document sessions
├── packages/
│   ├── bindings/            # TypeScript records generated from Rust
│   ├── core/                # Editor model, geometry, tools, and web persistence
│   ├── input-dom/           # Browser input normalization
│   ├── renderer/            # Interactive Canvas 2D renderer
│   ├── runtime/             # Framework-neutral editor interaction
│   └── ui/                  # Shared Svelte components and product editor
└── crates/
    ├── inkfinite-core/      # Document engine, CRDT, files, schemas, and SVG
    └── inkfinite-cli/       # File-mode CLI and binding generator
```

The web app stores documents in IndexedDB.

The desktop app sends file and editing operations to the filesystem.

Run the shared UI workshop when changing components or the editor:

```sh
pnpm dev:ui
```

## License

Inkfinite is licensed under the [GNU Affero General Public License v3.0](LICENSE).
