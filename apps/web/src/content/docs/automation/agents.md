---
title: Agent workflows
description: 'Inspect and change Inkfinite documents through the CLI or permissioned MCP server.'
section: Automation
group: Automation
order: 12
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
layers. Permissioned integrations can use that metadata as part of their own policy.

### MCP access

Run `inkfinite-mcp` as a local stdio server. It discovers open desktop sessions through authenticated
local IPC. Pass standalone files as command arguments, or list them in `INKFINITE_MCP_DOCUMENTS`
using the platform path separator:

```sh
inkfinite-mcp board.inkfinite research.inkfinite
```

The server exposes tools to list sessions and documents, inspect heads and metadata, query records,
preview or apply ordered mutations, import SVG, and submit desktop proposals. Start with
`inkfinite_capabilities`, then select a source and inspect its current heads. Use `dry_run: true`
before a direct mutation. `inkfinite_propose` sends a validated transaction to an open desktop
session, and `inkfinite_proposal_status` reports the review outcome. Standalone files do not have a
review store.

The server defaults to read-only access. Set `INKFINITE_MCP_POLICY` to a JSON policy when a model
needs write access. The default rule and per-session rules use `read`, `create`, `modify`, `delete`,
`layout`, and `propose` scopes. Per-document rules are keyed by canonical path and per-session rules
by desktop session ID.

```json
{
	"default": {
		"permissions": {
			"read": true,
			"create": true,
			"modify": true,
			"delete": false,
			"layout": true,
			"propose": true
		},
		"hidden_layers": "deny",
		"require_agent_editable": true
	}
}
```

MCP filters hidden layers unless `hidden_layers` is `allow`, and changes to existing shapes require
`agent_editable` by default. `inkfinite-core` still checks document, layer, shape, and ancestor locks.
Policy failures use `authorization_denied`; lock and validation failures retain their document error
codes. A denied MCP operation is not permission to switch to the direct CLI.

Raw `app apply` validates and commits a prepared transaction.

## Conflicts

Document heads are preconditions. If a file mutation exits with code `5`, inspect the current heads,
query the affected records again, and rebuild the transaction from that state. Do not remove lock
files, copy an older document over the current file, or silently drop intervening edits.

Record-version preconditions protect individual objects in the same way. A failed version check
means the object changed after the agent inspected it.

## Skill

The repository includes an installable agent skill at `.agents/skills/inkfinite`. It covers CLI,
MCP, and reviewed desktop workflows and points agents to generated help and tool schemas.
