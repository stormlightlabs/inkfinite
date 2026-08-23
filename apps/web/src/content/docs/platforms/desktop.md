---
title: Desktop
description: Work with native files, drafts, workspaces, and live local CLI sessions.
section: Platforms
group: Platforms
order: 10
---

The desktop editor combines the shared canvas interface with native file handling and authenticated
local CLI access. See the [Editor guide](/docs/guide/editor/) for tools, gestures, selection, and
styling. To run the desktop app from a checkout, follow
[Building from source](/docs/development/building-from-source/).

## Document sessions

Use **Open** to load a canonical `.inkfinite` file. New documents remain drafts in the app's local
data directory until you choose **Save As**. The app tracks the current native path separately from
imports and exports, so exporting a PNG, SVG, Excalidraw file, or Obsidian Canvas file does not mark
the native document as saved elsewhere.

The desktop backend uses file locks, recovery data, and atomic replacement for canonical writes.
Do not edit the same file with a file-mode CLI command while it is open in the desktop app. Use the
live CLI workflow instead.

## Local CLI access

The desktop app exposes authenticated IPC to the local `inkfinite` CLI. Commands can list sessions,
report editor context, inspect and query the open document, apply validated transactions, control
the view, or focus the window.

Structured live mutations commit immediately after causal-head, record-version, validation, and
lock checks. Reviewed model access belongs to the permissioned MCP interface. CLI discovery and
authentication remain local to the current user account. See
[Agent workflows](/docs/automation/agents/) and
[Command-line interface](/docs/automation/cli/) for commands.
