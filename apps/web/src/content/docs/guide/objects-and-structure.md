---
title: Objects and structure
description: Work with shapes, rich content, frames, groups, layers, metadata, and stencils.
section: Guide
group: Guide
order: 4
---

Inkfinite combines drawing primitives with structured canvas objects. Every object has a stable ID,
a transform, properties for its kind, and optional metadata.

## Drawing objects

The shape tools create rectangles, ellipses, frames, lines, arrows, text, Markdown, and freehand
strokes. Images remain native assets and support crop, captions, display masks, opacity,
replacement, and color sampling.

URL, file, and page-reference objects keep external or internal targets as editable content. The
Card stencil creates a frame with ordinary text and Markdown children. Select a card to edit its
title and body.

## Frames and groups

Frames and groups contain ordered child objects. Moving a container moves its children. Double-click
a nested object to enter its container, then press Escape to return to the parent.

Frames provide a visible canvas region and can be fitted to the viewport. Groups collect objects
without adding a frame presentation. Container child order controls drawing order within the
container and the order used by SVG export.

## Layers

Each page contains ordered layers. The Layers panel creates, activates, renames, reorders, hides,
locks, and changes the opacity of layers. A shape lock prevents edits regardless of the source of
the transaction.

## Metadata and stencils

The object metadata controls edit names, roles, tags, descriptions, sources, links, and structured
metadata. A single selected object also shows read-only provenance: actor, origin, time, and source.
These fields let people and CLI queries find objects by meaning instead of canvas coordinates.

Open **Insert** to add a stencil. Stencils can create a single object or a structured set of
objects, such as a Card frame with title and body children.
