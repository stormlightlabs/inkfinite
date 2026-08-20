---
title: Introduction
description: 'Learn what Inkfinite is, where documents live, and which guide to read next.'
section: Get started
group: Start here
order: 1
---

Inkfinite is a local-first infinite canvas for drawing, wireframing, and diagramming. It runs in
the browser and as a desktop app, with the same editor and document model in both.

## What you can make

Use shapes, arrows, text, Markdown, freehand strokes, layers, and stencils to sketch an idea or
build a structured diagram. The canvas supports direct manipulation, undo and redo, grouping,
reordering, panning, and zooming.

## Where documents live

The web editor stores boards in the browser's IndexedDB database. The desktop editor works with
local `.inkfinite` files and keeps an unsaved draft in the app's local data directory until you
choose **Save As**.

An `.inkfinite` file contains the document and its Automerge change history. The desktop app and
command-line tools use file locks, atomic replacement, and recovery data to protect writes.

## Ways to work

- Open the [web editor](/app) for a browser-based canvas, or read its
  [storage guide](/docs/applications/web/).
- Use the [desktop editor](/docs/applications/desktop/) for native files and desktop menus.
- Use the [command-line interface](/docs/reference/cli/) to inspect, edit, validate, or render a
  document from a script.
- Use [agent workflows](/docs/reference/agents/) to propose document changes for review.

## Where to go next

Follow [Getting started](/docs/getting-started/) to run an editor and create a document.

Read [Documents](/docs/concepts/documents/) for the data model or
[Transactions and Sync](/docs/concepts/transactions-and-sync/) for editing, history, and convergence.
