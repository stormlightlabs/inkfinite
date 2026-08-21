---
title: Agent workflows
description: 'Safe, reviewable Inkfinite document changes for coding agents.'
section: Reference
group: Reference
order: 9
---

Use Inkfinite's command-line tools to inspect, validate, and change documents.

## Workflow

For a saved file, follow the same sequence for every change:

1. Run `inspect --summary --json` and keep the returned heads.
2. Use `query --detail --limit N --json` to read only the relevant records.
3. Build the smallest transaction that satisfies the request.
4. Run the mutation with `--dry-run --json`.
5. Apply it only after the dry run passes.
6. Validate the document and render the affected page, role, or selection.

Prefer semantic roles, names, and tags over coordinates when they identify one record. If a selector
matches multiple shapes, narrow it with an exact ID. Do not guess which one the human meant.

## Live documents

For a document open in the desktop app, add `--app` to a structured `shape`, `connect`, or `layout`
command instead of changing its file. Validated live edits commit immediately. Use the permissioned
MCP interface when model-controlled changes require authorization or review.

## Permissions

Shape and layer locks apply to every CLI transaction. Do not work around a lock by editing a child
or bypassing the CLI. The direct CLI does not enforce `agent_editable` or hide records in invisible
layers; permissioned integrations can use that metadata as part of their own policy.

Raw `app apply` validates and commits a prepared transaction.

## Conflicts

Document heads are preconditions. If a file mutation exits with code `5`, inspect the current heads,
query the affected records again, and rebuild the transaction from that state. Do not remove lock
files, copy an older document over the current file, or silently drop intervening edits.

Record-version preconditions protect individual objects in the same way. A failed version check
means the object changed after the agent inspected it.

## Skill

The repository includes an installable agent skill at `skills/inkfinite`. It documents the safe
CLI workflow and points agents to the CLI's generated help and schemas for current commands.
