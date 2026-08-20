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

The desktop app exposes authenticated IPC to the local `inkfinite` CLI. Read-only commands can list
sessions, report the active page, selection, viewport, and agent access mode, inspect the open
document, query records, or focus the window.

Each document starts with **Agent access** set to **Review changes**. Structured live commands then
open a ghost preview. Only the desktop UI can accept or reject it, while the CLI can poll the
outcome.

Switch **Agent access** to **Apply directly** when you want an agent to work independently. Validated
live edits then commit without repeated prompts. The setting belongs to the open document session,
resets when it closes, and cannot be enabled through the CLI. Discovery and authentication remain
local to the current user account. See [Agent workflows](/docs/reference/agents/) for both modes and
[Command-line interface](/docs/reference/cli/) for commands.
