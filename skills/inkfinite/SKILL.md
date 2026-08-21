---
name: inkfinite
description: >-
    Safely inspect, query, create, edit, review, validate, and render Inkfinite
    .inkfinite documents through the validated CLI and authenticated desktop
    workflow. Use when an agent must change a local Inkfinite board,
    prepare a reviewed desktop proposal, resolve stale heads, or inspect the
    document and transaction schemas.
---

# Inkfinite agent

Use the `inkfinite` CLI as the only document boundary. It owns heads,
validation, permissions, history, persistence, and deterministic rendering.
Never edit `.inkfinite` bytes, Automerge state, recovery files, or sidecars
directly.

## Operating sequence

Follow this order for every change:

1. Inspect the current heads.
2. Query only the records relevant to the requested change.
3. Describe the smallest transaction that satisfies the request.
4. Build it with a structured command. Use a raw `TransactionDraft` only when
   the structured commands cannot express the change.
5. In file mode, run the same change with `--dry-run`.
6. Resolve any stale head, selector, or lock error by inspecting again and
   rebuilding the transaction from current state.
7. Apply the file-mode change, or add `--app` to commit it to the desktop
   session.
8. Validate the resulting document and render the affected view or role.

In short: inspect heads → narrow query → minimal transaction → dry-run in file
mode → resolve → submit → validate → render.

Start with machine-readable output:

```sh
inkfinite capabilities --json
inkfinite inspect board.inkfinite --summary --json
inkfinite query board.inkfinite --role architecture.service --detail --limit 20 --json
```

The live equivalents are `app status`, `app context`, `app inspect`, and
`app query`. `app context` reports the active page and layer, selection, camera,
visible world bounds, floating-UI occlusions, actor, and heads.
Keep the heads returned by the read that informed the transaction. They are a
precondition, not decoration.

## Rules for safe edits

- Prefer exact semantic selectors (`--role`, `--name`, and `--tag`) when they
  identify one record. If a selector matches more than one shape, narrow it
  with `--shape-id`; do not guess.
- Prefer `shape create`, `shape patch`, `shape delete`, `connect`, and
  `layout align`/`layout distribute` over hand-written operations. Use a raw
  transaction only when the structured commands cannot express the change.
- Treat `locked` layers and shapes as read-only. Do not work around them by
  selecting a child, changing bytes, or using a different actor. The direct
  CLI does not enforce `metadata.agent_editable` or hide records in invisible
  layers; permissioned integrations may apply their own policy to that metadata.
- Use layout operations for alignment and distribution. Do not approximate a
  layout operation with many unrelated coordinate patches.
- Use `shape create` with `--relative-role`, `--relative-name`, or
  `--relative-id` and `--placement` for semantic placement. Read the operation
  preview bounds before describing the proposed composition.
- Keep one coherent user request in one transaction. Do not bundle unrelated
  cleanup into an otherwise small proposal.
- A dry run must pass before a durable file apply. A dry run changes no
  canonical bytes. Use `--transaction-out FILE` when another tool or person
  needs the validated transaction without changing the document.
- For a live document, add `--app` to `shape`, `connect`, or `layout`. The CLI
  commits the edit after validation and lock checks.
- Use `app ui` only for transient page, layer, selection, or camera navigation.
  It does not authorize a document edit.

## Heads and conflicts

When a file or live mutation returns exit code `5`, discard the stale transaction as a commit candidate. Inspect
the current heads, query the affected records again, and rebuild the smallest
safe transaction. Re-run `--dry-run` before applying it.

Do not resolve a head conflict by overwriting the document, deleting its lock,
or copying an older file over the current one. The engine must see the current
heads and preserve intervening human or peer work.

## Command and schema reference

The CLI is the source of truth for options and serialized shapes. Discover it
at the point of use instead of copying a complete option table into this skill:

```sh
inkfinite --help
inkfinite <command> --help
inkfinite capabilities --json
inkfinite shape kinds --json
inkfinite shape describe rect --json
inkfinite schema document
inkfinite schema transaction
inkfinite schema protocol
```

Use `--json` for machine output. Successful data stays on stdout. Failures use
structured JSON on stderr with `code`, `message`, `details`, `retryable`, and
`suggestion`. Stable exit codes are reported by `capabilities --json`.
