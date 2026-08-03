# Inkfinite

Inkfinite is a local-first infinite canvas for drawing, wireframing, and
diagramming. It runs in the browser or as a desktop app.

## What you can do

- Draw rectangles, ellipses, lines, arrows, text, Markdown, and freehand strokes.
- Organize work with pages, layers, groups, and a built-in stencil library.
- Pan, zoom, select, resize, reorder, undo, and redo directly on the canvas.
- Store documents in your browser (`idb`) or work with local `.inkfinite` files in the
  desktop app.
- Import and export editable Excalidraw and Obsidian Canvas documents in either app.
- Inspect, edit, validate, and render `.inkfinite` files from scripts with the CLI.

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

Open the printed local URL for the documentation site, or add `/app` to open the editor.

Start the desktop app:

```sh
pnpm tauri dev
```

## CLI

The `inkfinite` CLI works with closed `.inkfinite` files and open desktop
sessions. Live commands use authenticated local IPC.

Run it through Cargo during development:

```sh
inkfinite new architecture.inkfinite
inkfinite inspect architecture.inkfinite --summary
inkfinite validate architecture.inkfinite
```

Use `query` to find records by ID, name, role, tag, shape kind, page, layer,
parent, or bounds:

```sh
inkfinite query architecture.inkfinite \
  --role architecture.service --detail --limit 20 --json
```

Use `apply` for a complete transaction draft. Pass `-` to read the transaction
from standard input. `--dry-run` runs the same validation and permission checks
without saving the result:

```sh
inkfinite apply architecture.inkfinite --transaction transaction.json --dry-run
cat transaction.json | inkfinite apply architecture.inkfinite --transaction - --json
```

The structured mutation commands build ordinary transactions. They generate
shape and binding IDs when you omit them. Shapes can be selected by exact ID,
name, or semantic role:

```sh
inkfinite shape create architecture.inkfinite \
  --kind rect --layer layer:architecture:1 \
  --x 80 --y 120 --properties '{"width":240,"height":120}' \
  --role architecture.service
inkfinite shape patch architecture.inkfinite --role architecture.service \
  --patch '{"properties":{"width":280,"height":120}}'
inkfinite connect architecture.inkfinite --binding-id binding:api-db \
  --source shape:arrow --target-role architecture.database
inkfinite layout align architecture.inkfinite \
  --role architecture.service --alignment top
```

Use `--transaction-out FILE` to validate a structured edit and write its
transaction without changing the document. The destination must not exist.
Use `shape kinds` and `shape describe KIND` to inspect the built-in shape
contract instead of guessing at property names.

`shape delete` removes a selected shape and its descendants. `layout align`
requires at least two shapes, and `layout distribute` requires at least three.
The transaction engine rejects locked layers, locked shapes, stale heads,
failed record-version preconditions, and agent edits to records that are not
agent-editable.

Render a document or a filtered view without opening the desktop app:

```sh
inkfinite render architecture.inkfinite --output architecture.svg
inkfinite render architecture.inkfinite --output services.svg \
  --role architecture.service
```

Mutation results include the previous and current heads, transaction ID,
created, updated, and deleted records, repairs, and warnings. `--json` and
`--non-interactive` are global options and may appear before or after a
subcommand. JSON commands keep successful data on stdout. Failures are JSON on
stderr with a stable code, structured details, retryability, and a suggested
next step.

The CLI can also print its schemas and capability contract:

```sh
cargo run -p inkfinite-cli --bin inkfinite -- schema document
cargo run -p inkfinite-cli --bin inkfinite -- capabilities --json
```

Run `inkfinite --help` for examples and the complete command reference.

### Live desktop control

With the desktop app running, use `app status`, `app context`, `app inspect`, and
`app query` to read current state. Context reports the active page and layer,
selection, camera, visible world bounds, floating-UI occlusions, actor, access
mode, and heads.

The desktop starts each document in **Review changes** mode. Add `--app` to a
structured mutation and the app opens a ghost preview for the user to accept or
reject. The user can switch **Agent access** to **Apply directly** for a solo
agent session; the same `--app` command then commits immediately. Direct access
ends when the document closes or the user switches back. The CLI cannot enable
it.

```sh
inkfinite app status --json
inkfinite app context --json
inkfinite app inspect --json
inkfinite app query --role architecture.service --detail --limit 20 --json
inkfinite app focus
inkfinite shape patch --app --role architecture.service \
  --patch '@service-patch.json' --json
inkfinite app propose --transaction transaction.json --json
inkfinite app proposal wait --proposal-id proposal:1 --json
inkfinite app proposal renew --proposal-id proposal:1 --json
inkfinite app render --output current.svg --transaction transaction.json \
  --proposed-output proposed.svg --json
inkfinite app ui --page page:1 --layer layer:1 --select shape:service \
  --camera 640,360,1.25 --json
inkfinite app apply --transaction transaction.json --json
```

`app propose` always opens a review, even in Direct mode, and remains available
for operations that the structured commands do not cover. `app apply` works
only while Direct mode is enabled. `shape create` accepts semantic relative
placement through `--relative-id`, `--relative-name`, or `--relative-role` with
`--placement`. Live SVG rendering previews a transaction without changing the
document. UI control changes only transient editor navigation; it does not edit
the document or change Agent access.

The desktop publishes a per-user Unix-domain socket on Unix-like systems or a
per-user named pipe on Windows. A protected discovery file carries a random
process token, and requests use versioned length-prefixed frames.

### Agent skill

The installable agent package lives in [`.agents/skills/inkfinite`](.agents/skills/inkfinite).
It teaches the inspect/query/transaction/dry-run/proposal workflow and includes
fixtures for file edits, desktop review polling, and stale-head recovery.

```sh
INKFINITE_CLI="$PWD/target/debug/inkfinite" \
  bash .agents/skills/inkfinite/scripts/verify-examples.sh
```

## Inkfinite files

Canonical `.inkfinite` files contain the document and its change history in a
compact Automerge format.

The desktop app and CLI protect canonical writes with file locks, atomic
replacement, and recovery data. A rejected or interrupted CLI mutation leaves
the original canonical file unchanged.

Excalidraw and Obsidian Canvas import and export are intentionally lossy. See the
[file format guide](apps/web/src/routes/docs/reference/file-format/+page.svx) for
the supported mappings and omitted features.

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
