---
title: File format
description: 'Inkfinite native files, document contract, safe writes, editable canvas interchange, compatibility limits, and lossless exports.'
section: Reference
group: Reference
order: 17
---

Inkfinite uses `.inkfinite` as its native document format. The editor can also import and export Excalidraw and Obsidian Canvas files, and import Mermaid and D2 source when you need to move editable content between applications.

## Native files

A canonical `.inkfinite` file is Automerge's compact binary form containing the document and its change history. Keep this file as the source of truth when you expect to continue editing in Inkfinite.

Opening and saving native files is separate from editable-format import and export. Importing an external file creates a new Inkfinite document. Exporting does not change the current document's native path or saved state.

## Document contract

The materialized snapshot carried by a file has a stable format identifier and explicit contract version:

```rust
pub struct DocumentSnapshot {
    pub format: FormatId,
    pub format_version: u32,
    pub document_id: DocumentId,
    pub heads: Vec<ChangeHash>,
    pub document: Document,
}
```

The `format` field is `"inkfinite.document"` and `format_version` is currently `2`. The document contains normalized pages, layers, shapes, bindings, and assets. Binding records may include a `relation_type` alongside their source and target shape IDs. Pages own ordered layers. Layers own ordered root shapes. Containers own their ordered child shapes. Container child order drives frame presentation and SVG export. Card fields are stored in the container's semantic metadata while title and body remain ordinary text and Markdown children. IDs remain stable across saves and replicas.

Text and Markdown shapes store their CSS font family as a string. Card titles and bodies use the font families on their text and Markdown child shapes, so changing a card's font does not require a document format migration. The web and desktop editors load their bundled fonts at runtime. A headless renderer needs the requested family supplied as a font asset or an available font family and otherwise reports a fallback warning.

The CLI can print a deterministic JSON projection for inspection and CI. That projection is not a second file format and cannot replace the Automerge history or causal heads stored in the canonical file.

## Safe writes

`DocumentFile` holds an advisory sidecar lock for the canonical path. Every transaction is validated before it is committed. A save writes a temporary same-directory replacement, flushes and syncs it, and then replaces the canonical file. An interrupted replacement leaves recovery data that can be validated and saved as a new canonical baseline.

Invalid bytes, stale heads, missing references, and invalid record properties are rejected before the canonical file is changed. Recovery uses the same document validation and persistence path as a normal save.

## Versioning

`format_version` and protocol version fields are explicit so future releases can reject unsupported data safely. They describe the current serialized contract. They do not select between document models or file flows.

## Editable interchange

Use **Import** in the editor toolbar to select an Excalidraw `.excalidraw`, Obsidian Canvas `.canvas`, Mermaid `.mmd` or `.mermaid`, or D2 `.d2` file. Use **Export** to write the current page as Excalidraw or Obsidian Canvas. The desktop app offers the same commands in its File menu.

Imports are limited to 16 MB of UTF-8 JSON. Inkfinite rejects malformed geometry and duplicate identifiers instead of guessing at corrupt data. It omits edges and bindings that refer to missing or unsupported shapes and includes them in the conversion notes.

Both formats describe one canvas, so Inkfinite imports them as a one-page document and exports only the selected page. An export reports this when the source document contains more than one page.

## Excalidraw

Inkfinite reads and writes Excalidraw v2 scene JSON. The converter handles rectangles, ellipses, lines, arrows, text, freehand strokes, groups, frames, arrow bindings, and arrow labels.

| Excalidraw content               | Inkfinite result                                     |
| -------------------------------- | ---------------------------------------------------- |
| Rectangle, ellipse, text         | Matching editable shape                              |
| Line or arrow                    | Matching line or arrow. Extra line vertices are lost |
| Bound arrow and label            | Arrow bindings and label                             |
| Freedraw                         | Freehand stroke                                      |
| Group or frame                   | Flat Inkfinite group                                 |
| Embeddable URL                   | Markdown link card                                   |
| Markdown exported from Inkfinite | Literal Excalidraw text                              |
| Image, iframe, or diamond        | Omitted with a conversion note                       |

Excalidraw's rough rendering, fill patterns, canvas settings, nested group hierarchy, some arrowhead styles, and exact font metrics do not have Inkfinite equivalents. Inkfinite converts rotation around Excalidraw's center-based origin into its own top-left transform so rotated supported shapes keep their placement.

Embedded Excalidraw raster images become editable Inkfinite image shapes when their file data is present. Images without file data are omitted with a conversion note.

## Obsidian Canvas

Inkfinite implements the JSON Canvas 1.0 structure used by Obsidian `.canvas` files.

| JSON Canvas content | Inkfinite result                                       |
| ------------------- | ------------------------------------------------------ |
| Text node           | Markdown card                                          |
| File node           | Editable file reference, including an optional subpath |
| Link node           | Editable URL reference                                 |
| Group node          | Inkfinite frame with label, color, and source metadata |
| Edge between nodes  | Bound Inkfinite arrow                                  |

JSON Canvas does not represent general drawing primitives, freehand strokes, layers, rotation, or free-floating arrows. When exporting, Inkfinite writes text and Markdown as cards, file and URL references as file or link nodes, bound arrows as edges, and containers as groups. Native image assets become file nodes because JSON Canvas stores paths rather than embedded bytes. Other drawing shapes are omitted and listed in the conversion notes. Rotated objects use axis-aligned bounds.

File nodes refer to paths in an Obsidian vault. Inkfinite preserves those paths as editable file references but does not copy or resolve the target attachments. Group background paths are kept in frame source metadata; the importer cannot read the referenced file from JSON Canvas text alone.

## Mermaid and D2 imports

Mermaid imports flowcharts declared with `flowchart` or `graph`. The supported subset includes directions, common node labels and shapes, subgraphs, arrow labels, `classDef`, `class`, `style`, `linkStyle`, and `click` URLs. D2 imports shape declarations, nested groups, labels, common fills and strokes, directions, and `--`, `->`, `<-`, and `<->` connections. Both importers create ordinary cards, frames, and bound arrows and run the nodes through the shared flow layout.

The importers report unsupported constructs instead of silently treating them as native equivalents. Unsupported Mermaid and D2 node shapes use rectangular Markdown cards. D2 icons, images, tooltips, classes, scenarios, and advanced layout directives are omitted with warnings. These imports are one-way; export to Mermaid or D2 is not part of the current interchange surface.

## Image and SVG exports

PNG and SVG are presentation exports rather than editable interchange formats. PNG captures the current viewport. SVG can export the selected shapes or all shapes on the current page.

Use `.inkfinite`, `.excalidraw`, or `.canvas` when another editor needs to continue working with individual objects.
