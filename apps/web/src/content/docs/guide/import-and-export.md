---
title: Import and export
description: Move editable boards and presentation copies between Inkfinite and other tools.
section: Guide
group: Guide
order: 7
---

Use import when you want external content to become part of an Inkfinite board. Use export when you
want an editable interchange file or a presentation copy for another application.

## Supported formats

| Format                 | Import      | Export | Result                               |
| ---------------------- | ----------- | ------ | ------------------------------------ |
| Inkfinite              | Yes         | Yes    | Native document and history          |
| SVG                    | Yes         | Yes    | Supported geometry stays editable    |
| PNG and other images   | As an image | PNG    | Raster content                       |
| Excalidraw             | Yes         | Yes    | Supported objects are mapped         |
| Obsidian / JSON Canvas | Yes         | Yes    | Supported nodes and edges are mapped |

The editor also accepts pasted plain text, Markdown, SVG markup, and images. Native clipboard copy
preserves hierarchy, assets, and connections. **Paste in place** keeps copied coordinates. Ordinary
paste places content near the pointer.

## Import files

Choose **Import**, paste content, or drop a supported file on the canvas. Importing an Excalidraw or
Obsidian Canvas file creates an Inkfinite document and leaves the source unchanged. SVG import maps
supported static elements to native shapes and assets.

An import report lists conversions, warnings, and omitted content. Keep the source until you have
checked the imported board. Inkfinite retains the original SVG as a source asset, but unsupported
visuals do not appear on the canvas.

## Export a board

Export SVG for vector presentation output or PNG for the current viewport. SVG can include the
current selection or the current page. Excalidraw and Obsidian Canvas exports map supported editable
content and report content their formats cannot represent.

Export does not change the current desktop document's native path or saved state. Continue saving
the `.inkfinite` file as the source when you need the complete board and its history.

See [Interoperability](/docs/reference/interoperability/) for a concise capability matrix and known
format differences.
