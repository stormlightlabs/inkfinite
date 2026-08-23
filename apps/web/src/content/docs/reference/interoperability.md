---
title: Interoperability
description: Check import, export, editability, and compatibility across supported canvas formats.
section: Reference
group: Reference
order: 16
---

## Format matrix

| Format                     | Import      | Export | Editability                          | Main limits                                             |
| -------------------------- | ----------- | ------ | ------------------------------------ | ------------------------------------------------------- |
| `.inkfinite`               | Yes         | Yes    | Native                               | Use desktop or CLI for files                            |
| SVG                        | Yes         | Yes    | Supported geometry is native         | Unsupported visuals may use fallback content            |
| PNG                        | As an image | Yes    | Raster                               | No individual vector objects                            |
| Excalidraw v2              | Yes         | Yes    | Supported objects are mapped         | Rough styles, some shapes, and exact metrics differ     |
| Obsidian / JSON Canvas 1.0 | Yes         | Yes    | Supported nodes and edges are mapped | General drawing shapes and rotation are not represented |

## Round trips

A native `.inkfinite` file preserves the document, causal heads, and Automerge history. Treat it as
the source when work will return to Inkfinite.

Excalidraw conversion supports rectangles, ellipses, lines, arrows, text, freehand strokes, groups,
frames, bindings, and labels. Unsupported images, iframes, diamonds, style details, and some
arrowheads are reported during conversion.

JSON Canvas conversion supports text, file, link, and group nodes plus edges between nodes. The
format cannot represent Inkfinite's general drawing primitives, freehand strokes, layers, rotation,
or free-floating arrows.

SVG import maps the supported static subset to native shapes. SVG export produces vector output for
the current page or selection. PNG captures the current viewport.

Read [Import and export](/docs/guide/import-and-export/) for the editor workflow and
[File format](/docs/reference/file-format/) for native storage details.
