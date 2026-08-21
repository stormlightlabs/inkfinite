---
title: Desktop editor
description: Build the Inkfinite desktop app and work safely with native files.
section: Applications
group: Applications
order: 6
---

The desktop editor combines the shared canvas interface with native file handling and authenticated
local CLI access.

## Run locally

Install Node.js 18 or newer, pnpm, Rust 1.89, and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. From
the repository root, run:

```sh
pnpm install
pnpm tauri dev
```

This starts the web frontend and native Tauri shell in development mode.

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
[Agent workflows](/docs/reference/agents/) and
[Command-line interface](/docs/reference/cli/) for commands.
