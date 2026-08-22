---
title: Documents
description: 'Pages, layers, shapes, bindings, and persistence in Inkfinite documents.'
section: Concepts
group: Concepts
order: 3
---

An Inkfinite document stores canvas content and the history needed to merge edits from different
peers.

## Document structure

A document contains pages. Each page has an ordered tree of layers and shapes, along with bindings
that connect related shapes. Stable IDs identify every record, so an edit can refer to one object
without relying on its current position or display name.

Pages separate canvases within one document. The editor displays one selected page at a time, but
the native file preserves every page and its history.

## Shapes and layers

Shapes include rectangles, ellipses, lines, arrows, text, Markdown blocks, and freehand strokes.
Each shape has a kind, transform, kind-specific properties, and metadata. A container can present
ordinary text and Markdown children as an editable card with a title, body, role, tags, source,
link, and structured metadata. Shapes can also carry a name, semantic role, and tags for reliable
CLI queries.

Layers control stacking and visibility. Container shapes own ordered children, so a frame moves and
exports its contents as one composition. Bindings connect arrows to source and target shapes
without making either shape a child of the other.

Locks prevent edits to a layer or shape regardless of who created the transaction. The
`agent_editable` metadata flag is available to permissioned integrations, but the document engine
and direct CLI do not treat it as a lock.

## Persistence

The web editor stores documents in the browser's IndexedDB database. Clearing site data or using a
different browser profile can make those documents unavailable, so export important work.

The desktop editor and CLI use canonical `.inkfinite` files. Each file contains Automerge state
and change history, not just the visible canvas snapshot. Writers use a lock, recovery data, and
atomic file replacement to avoid partial saves. See [File format](/docs/reference/file-format/) for
editable interchange and presentation exports.
