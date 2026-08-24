---
title: Vector editing
description: Edit native path anchors, Bézier handles, segments, and imported SVG geometry.
section: Guide
group: Guide
order: 6
---

Inkfinite stores supported arbitrary vector geometry as native path shapes. You can edit paths drawn
in Inkfinite and paths created from supported SVG elements.

## Direct Select

Choose **Direct Select**, then select a path. Inkfinite displays anchors and the Bézier handles that
control curved segments. Drag an anchor to move it. Drag a handle to change the direction and
strength of a curve.

Whole-object selection still controls the path's transform, bounds, fill, stroke, and opacity. Use
Direct Select only when you need to change the geometry inside those bounds.

## Gradient fills and strokes

The Fill and Stroke controls accept solid colours, linear gradients, and radial gradients. Open the
small gradient control beside a colour control to choose a gradient type, change its spread mode,
and edit its stops. Each stop exposes a colour, position from 0 to 1, and opacity. Add a stop or
remove one when at least two stops remain.

Gradient definitions stay in the document and are preserved when you save, reopen, import from SVG,
or export to SVG. Interactive Canvas rendering uses the same stop data for previews.

## Path topology

Path commands open or close a subpath, split a segment, join compatible endpoints, and change a
segment's geometry. A path may contain more than one subpath and may mix line and Bézier segments.

Closing a path adds a segment from its final anchor to its first anchor. Opening it removes the
closing segment. Split creates a new anchor on a segment. Join connects compatible open endpoints.

## Imported SVG paths

SVG paths and supported vector primitives become native Inkfinite geometry during import. Their
anchors and segments can then be edited with Direct Select. Inkfinite reports and omits unsupported
visual content.

Read [Import and export](/docs/guide/import-and-export/) for the supported workflow. Maintainers can
read [Native path geometry](/docs/development/native-path-geometry/) for the stored representation
and invariants.
