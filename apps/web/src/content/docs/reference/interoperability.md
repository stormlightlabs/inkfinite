---
title: Interoperability
description: Check import, export, editability, and compatibility across supported canvas formats.
section: Reference
group: Reference
order: 16
---

## Format matrix

| Format                     | Import      | Export | Editability                          | Main limits                                          |
| -------------------------- | ----------- | ------ | ------------------------------------ | ---------------------------------------------------- |
| `.inkfinite`               | Yes         | Yes    | Native                               | Use desktop or CLI for files                         |
| SVG                        | Yes         | Yes    | Supported geometry is native         | Unsupported visuals are omitted with warnings        |
| PNG                        | As an image | Yes    | Raster                               | No individual vector objects                         |
| Excalidraw v2              | Yes         | Yes    | Supported objects are mapped         | Rough styles, some shapes, and exact metrics differ  |
| Obsidian / JSON Canvas 1.0 | Yes         | Yes    | Supported nodes and edges are mapped | File bytes and general drawing shapes need fallbacks |
| Mermaid flowcharts         | Yes         | No     | Nodes, groups, labels, and arrows    | The initial subset uses editable Markdown cards      |
| D2                         | Yes         | No     | Shapes, groups, labels, and arrows   | The initial subset omits advanced layout and assets  |

## Round trips

A native `.inkfinite` file preserves the document, causal heads, and Automerge history. Treat it as
the source when work will return to Inkfinite.

Excalidraw conversion supports rectangles, ellipses, lines, arrows, text, freehand strokes, groups,
frames, bindings, and labels. Unsupported images, iframes, diamonds, style details, and some
arrowheads are reported during conversion.

JSON Canvas conversion follows the [JSON Canvas 1.0 specification](https://jsoncanvas.org/spec/1.0/).
Text nodes become Markdown cards. File and link nodes become editable file or URL references. Group
nodes become frames, including their label, color, and background path in frame metadata. Edges become
bound arrows. JSON Canvas has no embedded asset store, so Inkfinite image assets export as file nodes
with a conversion warning.

[Mermaid flowcharts](https://mermaid.js.org/syntax/flowchart.html) import the `flowchart` and `graph` forms with directions, node labels, common arrow forms, subgraphs, `classDef`, `class`, `style`, `linkStyle`, and `click` URLs. Nodes remain editable Markdown
cards with source IDs in metadata. Unsupported node shapes use rectangular cards and produce a warning.
Unsupported directives are ignored rather than rendered as a format-specific overlay.

[D2 connections and shapes](https://d2lang.com/tour/connections/) import shape declarations, nested object groups, `label`, `shape`, `link`, common fill and stroke
styles, directions, and `--`, `->`, `<-`, and `<->` connections. The importer creates ordinary
Inkfinite cards, frames, and bound arrows, then runs the result through the shared flow layout. D2
icons, images, tooltips, classes, scenarios, and advanced layout directives produce warnings and use
an omission or rectangular-card fallback.

SVG import maps the supported static subset and embedded raster images to native shapes and retains
the original SVG as a source asset. It omits unsupported visuals with warnings. SVG export produces
vector output for the current page or selection. PNG captures the current viewport.

Read [Import and export](/docs/guide/import-and-export/) for the editor workflow and
[File format](/docs/reference/file-format/) for native storage details.
