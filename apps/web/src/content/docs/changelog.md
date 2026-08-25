---
title: Changelog
description: 'Highlights from each Inkfinite release.'
section: Project
group: Project
order: 25
---

## 0.1.0

First public release of Inkfinite, a local-first infinite canvas for web, desktop, CLI, and agent
workflows.

### Highlights

- **One document across every interface.** Automerge-backed `.inkfinite` files carry validated
  transactions, history, undo and redo, causal heads, and sync across the shared Rust engine,
  browser, desktop app, CLI, and MCP server.
- **Canvas and vector editing.** Draw with shapes, text, Markdown, freehand strokes,
  connectors, layers, groups, frames, cards, images, stencils, native paths, boolean operations,
  gradients, masks, filters, variable-width strokes, and text on a path.
- **Open import and export workflows.** Edit native SVG geometry, render deterministic SVG and PNG
  output, and exchange structured content with Excalidraw, Obsidian Canvas, Mermaid, and D2.
- **Local-first web and desktop apps.** Work offline in the installable web app, keep browser boards
  in local storage, or use Automerge-backed files and recoverable drafts in the Tauri desktop app.
- **Automation built around the same model.** Inspect, query, validate, edit, lay out, and render
  documents from the CLI, or let coding agents propose permissioned changes for visual review
  through MCP.
- **Measured behavior and performance.** Cross-interface fixtures exercise persistence,
  interchange, rendering, and editor behavior, with native, process, browser, and heap regression
  ceilings.
