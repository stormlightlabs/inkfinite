---
title: Introduction
description: 'Learn what Inkfinite is, where documents live, and which guide to read next.'
section: Start here
group: Start here
order: 1
---

Inkfinite is a local-first infinite canvas for drawing, wireframing, and diagramming. It runs in
the browser and as a desktop app, with the same editor and document model in both.

## What you can make

Use shapes, arrows, text, Markdown, cards, images, freehand strokes, layers, and stencils to sketch
an idea or build a structured diagram. Inkfinite also supports graph layout, native vector path
editing, and SVG, Excalidraw, and Obsidian Canvas interchange.

## Where documents live

The web editor stores boards in the browser's IndexedDB database. The desktop editor works with
local `.inkfinite` files and keeps an unsaved draft in the app's local data directory until you
choose **Save As**.

An `.inkfinite` file contains the document and its Automerge change history. The desktop app and
command-line tools use file locks, atomic replacement, and recovery data to protect writes.

## Ways to work

- Open the [web editor](/app) for a browser-based canvas, or read its
  [storage guide](/docs/platforms/web/).
- Use the [desktop editor](/docs/platforms/desktop/) for native files and desktop menus.
- Use the [command-line interface](/docs/automation/cli/) to inspect, edit, validate, or render a
  document from a script.
- Use [agent workflows](/docs/automation/agents/) to inspect, validate, and apply scripted document changes.

## Where to go next

Follow the [Quickstart](/docs/quickstart/) to create and export a board.

Read [Document model](/docs/concepts/document-model/) for the data model or
[Transactions and sync](/docs/concepts/transactions-and-sync/) for editing, history, and convergence.
