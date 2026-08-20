---
title: Getting started
description: Install Inkfinite and create your first document.
section: Get started
group: Start here
order: 2
---

Run Inkfinite from the repository, then choose the web or desktop editor based on where you want
to keep your documents.

## Requirements

You need Node.js 18 or newer, pnpm, and Rust 1.89. Building the desktop app also requires the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

Clone the repository, open a terminal in its root directory, and install the JavaScript packages:

```sh
pnpm install
```

## Installation

Start the web editor:

```sh
pnpm dev:web
```

The command prints a local URL for the documentation site. Open its `/app` route to use the
editor. Documents created there stay in that browser profile.

To run the desktop editor instead:

```sh
pnpm tauri dev
```

The desktop app can open and save `.inkfinite` files on your computer.

## Create a document

Open the editor and use the file browser to create a board. Add shapes from the toolbar, then drag
on the canvas to place them. The editor saves web documents to IndexedDB; the desktop app keeps a
draft until you choose **Save As** and select a file.

Use **Import** when you already have an Excalidraw or Obsidian Canvas file. Import creates a new
Inkfinite document and leaves the source file unchanged.

## Next steps

- Read [Documents](/docs/concepts/documents/) to understand pages, layers, and shapes.
- Read [Web editor](/docs/applications/web/) or [Desktop editor](/docs/applications/desktop/) for
  storage details.
- Read [Command-line interface](/docs/reference/cli/) before changing a saved document from a
  script or coding agent.
