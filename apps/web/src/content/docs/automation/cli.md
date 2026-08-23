---
title: CLI
description: Inspect, query, change, validate, and render files and live desktop sessions.
section: Automation
group: Automation
order: 11
---

Inspect, change, validate, and render Inkfinite documents from a terminal.

## Command overview

Run `inkfinite --help` or `inkfinite <command> --help` for the complete option reference. The main
commands are:

| Command                      | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `new`                        | Create a blank canonical document                             |
| `inspect`                    | Print a document summary or materialized snapshot             |
| `query`                      | Find records by semantic, structural, kind, or bounds filters |
| `validate`                   | Load and validate a canonical document                        |
| `shape`, `connect`, `layout` | Build a structured file or live desktop edit                  |
| `apply`                      | Validate and apply a transaction draft from JSON              |
| `import svg`                 | Import static SVG content into native shapes                  |
| `render`                     | Write an SVG or PNG of a document or filtered view            |
| `app`                        | Inspect or work with a running desktop session                |
| `completions`                | Print a Bash, Fish, or Zsh completion script                  |
| `schema`, `capabilities`     | Print machine-readable contracts for integrations             |

During development, build the binary with:

```sh
cargo build -p inkfinite-cli --bin inkfinite
```

## Build and install the CLI

The workspace includes an `xtask` helper for building the CLI and generating its
man page and shell completions:

```sh
cargo xtask man
cargo xtask completions
cargo xtask dist
```

The first two commands write to `target/man/inkfinite.1` and
`target/completions/`. `cargo xtask dist` builds the release binary and writes a
source-built distribution under `target/dist/`:

```text
target/dist/bin/inkfinite
target/dist/share/man/man1/inkfinite.1
target/dist/share/bash-completion/completions/inkfinite
target/dist/share/fish/vendor_completions.d/inkfinite.fish
target/dist/share/zsh/site-functions/_inkfinite
```

On a Unix system, install those files with:

```sh
sudo mkdir -p /usr/local/bin /usr/local/share/man/man1 \
  /usr/local/share/bash-completion/completions \
  /usr/local/share/fish/vendor_completions.d \
  /usr/local/share/zsh/site-functions

sudo install -m 755 target/dist/bin/inkfinite /usr/local/bin/inkfinite

sudo install -m 644 target/dist/share/man/man1/inkfinite.1 \
  /usr/local/share/man/man1/inkfinite.1

sudo install -m 644 target/dist/share/bash-completion/completions/inkfinite \
  /usr/local/share/bash-completion/completions/inkfinite

sudo install -m 644 target/dist/share/fish/vendor_completions.d/inkfinite.fish \
  /usr/local/share/fish/vendor_completions.d/inkfinite.fish

sudo install -m 644 target/dist/share/zsh/site-functions/_inkfinite \
  /usr/local/share/zsh/site-functions/_inkfinite
```

Use `inkfinite completions bash`, `inkfinite completions fish`, or
`inkfinite completions zsh` to print one script directly. `comp` is an alias for
`completions`.

## File mode

File-mode commands operate on a closed `.inkfinite` file. Start by inspecting its heads and querying
only the records you need:

```sh
inkfinite inspect architecture.inkfinite --summary --json
inkfinite query architecture.inkfinite \
  --role architecture.service --detail --limit 20 --json
```

Prefer `shape create`, `shape patch`, `shape delete`, `connect`, and `layout` when one of them
expresses the edit. Use `apply` for a transaction with operations that the structured commands do
not cover. Test mutations with `--dry-run` before saving:

```sh
inkfinite shape patch architecture.inkfinite \
  --role architecture.service \
  --patch '@service-patch.json' \
  --dry-run --json

inkfinite apply architecture.inkfinite \
  --transaction transaction.json \
  --dry-run --json

inkfinite import svg architecture.inkfinite \
  --input icon.svg --dry-run --json
```

`layout` supports `align`, `distribute`, `stack`, `grid`, `tidy`, and `graph`. Select
shapes with repeated `--shape` flags or one `--role` selector. Stack accepts
`--axis` and `--gap`, grid accepts `--columns`, `--column-gap`, and
`--row-gap`, tidy accepts `--gap`, and graph accepts `--algorithm flow|tree|radial`,
`--direction top-to-bottom|left-to-right`, `--node-gap`, and `--rank-gap`.
Graph edges come from selected-to-selected relation bindings or the two endpoints
of a selected connector. Proximity and unselected endpoints are ignored.

`import svg` creates the retained source asset, native group containers, and
supported shapes in one validated transaction. Use `--page` or `--layer` to
choose a target. Otherwise the first page and layer receive the import.

File commands never prompt. Close the desktop editor before changing its file. A lock or stale-head
error is a signal to inspect current state, not a reason to overwrite the file.

To hand the edit to another process without changing the document, add
`--transaction-out transaction.json` to a structured mutation. The CLI validates the transaction
and refuses to overwrite an existing output file. Run `shape kinds` or `shape describe KIND` to
discover shape contracts.

Use `connect --kind relation --relation-type TYPE` for a semantic connection that does not
participate in arrow routing. Query its direction or type with `--outgoing-from`, `--incoming-to`,
and `--relation-type`:

```sh
inkfinite connect architecture.inkfinite \
  --source shape:service --target shape:database \
  --kind relation --relation-type depends_on --json
inkfinite query architecture.inkfinite \
  --outgoing-from shape:service --relation-type depends_on --detail --json
```

## Live mode

With the desktop app running, use `app status`, `app context`, `app inspect`, and `app query` for
read-only access. Context reports the active page, selection, viewport, actor, and current heads.
Add `--app` to apply a structured mutation to the open document:

```sh
inkfinite app status --json
inkfinite app context --json
inkfinite app query --role architecture.service --detail --limit 20 --json
inkfinite shape patch --app --role architecture.service \
  --patch '@service-patch.json' --json
inkfinite app apply --transaction transaction.json --json
```

Structured `--app` mutations and `app apply` validate and commit immediately. They enforce current
heads, record versions, transaction validation, and document locks. Reviewed, permissioned model
access belongs to the MCP interface rather than the general CLI.

## Rendering

The output extension selects SVG or PNG. The same options work for a closed file and a live desktop
session:

```sh
inkfinite render architecture.inkfinite --output architecture.svg
inkfinite render architecture.inkfinite --output architecture.png
inkfinite app render --output current.png
```

Use `--region x,y,width,height` for an exact world-space crop. Live rendering can also write a
proposed result with `--transaction` and `--proposed-output` without changing the open document.

## Output format

Pass `--json` for deterministic machine-readable output. Successful mutations report the previous
and current heads, transaction ID, created, updated, and deleted records, repairs, and warnings.
Failures go to standard error as JSON with `code`, `message`, `details`, `retryable`, and
`suggestion`, so agents can respond without parsing prose.

`capabilities --json` reports supported commands and stable exit codes. Current exit codes are:

| Code | Meaning                                |
| ---: | -------------------------------------- |
|  `0` | Success                                |
|  `2` | Invalid command usage                  |
|  `3` | File or input error                    |
|  `4` | Invalid document or data               |
|  `5` | Existing file, lock, or state conflict |

Use `schema document`, `schema transaction`, and `schema protocol` instead of inferring JSON shapes
from examples. Global `--json` and `--non-interactive` options may appear before or after a
subcommand.
