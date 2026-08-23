---
name: inkfinite
description: >-
    Create, inspect, edit, arrange, validate, and render Inkfinite boards through
    the CLI, MCP server, or desktop app. Use when Inkfinite or a .inkfinite file is
    mentioned, including diagrams, SVG imports, and reviewed desktop changes.
---

# Inkfinite

Use Inkfinite's CLI or MCP tools for every document read and write. These
interfaces own validation, causal heads, record versions, locks, persistence,
and rendering. Never edit `.inkfinite` bytes, Automerge state, recovery files,
lock files, or sidecars directly.

## Choose an interface

Pick one target before reading or changing a board:

- For a closed local file, use file-mode CLI commands.
- For a board open in Inkfinite Desktop, use `app` reads and structured commands
  with `--app`. Do not edit the file behind the desktop session.
- When model access needs scoped permissions or human review, use the local
  `inkfinite-mcp` tools. Do not fall back to the direct CLI after MCP denies an
  operation.
- To create a file, run `inkfinite new FILE.inkfinite`, then inspect it before
  adding content.

If the user has not identified a target, look for the named `.inkfinite` file or
use `inkfinite_list_documents` / `inkfinite_list_sessions`. Ask the user only
when more than one plausible target remains.

Start by discovering the installed interface rather than assuming its options:

```sh
inkfinite capabilities --json
inkfinite --help
inkfinite <command> --help
```

If `inkfinite` is unavailable, do not substitute a ZIP, JSON, SVG, or direct
file edit and call it an Inkfinite document. Report the missing CLI or use an
available Inkfinite MCP server.

## File workflow

Follow this sequence for a saved file:

1. Inspect the summary and retain its heads.
2. Query only the records needed for the request, with complete record detail.
3. Resolve every selector to one intended record. Retain record versions for
   patches and deletes.
4. Build one transaction for the requested change. Prefer structured mutation
   commands over raw transaction JSON.
5. Preview it with `--dry-run --json`, or use `--transaction-out FILE` to write
   the exact validated transaction without changing the board.
6. Apply the mutation. Apply a saved transaction with `apply --transaction`.
   If state changed since inspection, inspect and rebuild instead of forcing the
   old transaction.
7. Run `validate --json`, query the affected records again, and render the
   affected page, role, selection, or region.

Typical reads:

```sh
inkfinite inspect board.inkfinite --summary --json
inkfinite query board.inkfinite --role architecture.service \
  --detail --limit 20 --json
inkfinite shape kinds --json
inkfinite shape describe rect --json
```

Typical mutations:

```sh
inkfinite shape create board.inkfinite \
  --kind rect --layer "$LAYER_ID" --name API \
  --role architecture.service \
  --properties '{"width":240,"height":120}' \
  --dry-run --json

inkfinite shape patch board.inkfinite \
  --shape-id "$SHAPE_ID" --expected-version "$VERSION" \
  --patch '@api-patch.json' --dry-run --json

inkfinite connect board.inkfinite \
  --source-role architecture.api --target-role architecture.database \
  --kind relation --relation-type depends_on --dry-run --json

inkfinite layout graph board.inkfinite \
  --role architecture.node --algorithm flow \
  --direction left-to-right --dry-run --json
```

These examples show the command shape, not universal IDs or properties. Read
IDs from `inspect` or `query`, and read kind-specific properties from
`shape describe KIND`. Never invent a page, layer, shape, or record version.

Use `shape create`, `shape patch`, `shape delete`, `connect`, `layout`, and
`import svg` when they express the change. Use `apply --transaction` only for
operations the structured commands cannot represent. A raw transaction must
match `schema transaction` and use the heads and actor returned by the read that
informed it.

## Live desktop workflow

Read the active session before acting:

```sh
inkfinite app status --json
inkfinite app context --json
inkfinite app inspect --json
inkfinite app query --role architecture.service --detail --limit 20 --json
```

`app context` reports the active page and layer, selection, camera, visible
world bounds, floating-UI occlusions, actor, and heads. Add `--session-id` when
more than one session is open.

Apply a direct live edit by omitting the file and adding `--app`:

```sh
inkfinite shape patch --app --shape-id "$SHAPE_ID" \
  --expected-version "$VERSION" --patch '@api-patch.json' --json
```

Live CLI mutations validate and commit immediately; they do not support
`--dry-run` or `--transaction-out`. Use MCP proposals when a person should
review the result before commit. Use `app ui` only to change transient page,
layer, selection, or camera state.

## MCP workflow

When Inkfinite MCP tools are available:

1. Call `inkfinite_capabilities` to read the available operations and policy.
2. Discover the target with `inkfinite_list_documents` or
   `inkfinite_list_sessions`.
3. Call `inkfinite_inspect_document`, then `inkfinite_query_records` with
   `include_records: true` and a narrow limit.
4. Use `inkfinite_mutate` with `dry_run: true` before a permitted direct commit.
5. For desktop review, call `inkfinite_propose`, retain the proposal ID, and
   check it with `inkfinite_proposal_status`.

Use each MCP tool's current input schema. MCP defaults to read-only access and
may restrict reads and writes by canonical file path or desktop session ID.
Policy can separately grant `read`, `create`, `modify`, `delete`, `layout`, and
`propose`; hide invisible layers; and require `agent_editable: true` on existing
shapes. `authorization_denied` is a policy result, not a reason to switch
interfaces or actors.

## Selection, layout, and visual checks

- Prefer exact semantic roles, names, and tags when they identify one record.
  If a selector is empty or ambiguous, query again and narrow with an exact ID.
- Give new shapes meaningful names, roles, and tags so later edits do not depend
  on coordinates or generated IDs alone.
- Use relative placement for additions near an existing shape:
  `--relative-role`, `--relative-name`, or `--relative-id` with `--placement`.
- Use `layout align`, `distribute`, `stack`, `grid`, `tidy`, or `graph` instead
  of approximating a layout with unrelated coordinate patches.
- Keep each user request in one coherent transaction. Do not include incidental
  cleanup.
- Render after a visual change and inspect the output image at its captured
  size. Check clipping, overlap, connector routing, text fit, spacing, and
  hierarchy. Fix observed problems through another validated transaction.

The output extension selects SVG or PNG:

```sh
inkfinite render board.inkfinite --output board.png
inkfinite render board.inkfinite --role architecture.service \
  --output service.svg
inkfinite app render --output current.png
```

## Locks, heads, and failures

Read the structured error `code`, `details`, `retryable`, and `suggestion`
instead of treating every nonzero exit alike.

For `stale_heads` or a failed record-version precondition, discard the old
transaction, inspect current heads, query the affected records again, and
rebuild the smallest change. Preserve intervening human or peer edits.

Treat locked layers, locked shapes, and locked ancestors as read-only. If a
file is open in Desktop, use the live session or ask the user to close it before
file-mode work. Never delete a lock, overwrite the document, copy an older file
over it, select a child to evade an ancestor lock, or change actors to bypass a
permission.

## Schemas and machine output

Use generated help and schemas as the source of truth:

```sh
inkfinite schema document
inkfinite schema transaction
inkfinite schema protocol
inkfinite capabilities --json
```

Use `--json` for machine output. Successful data is written to stdout. Failures
are written to stderr as structured JSON. `capabilities --json` reports the
supported commands and exit codes for the installed version.
