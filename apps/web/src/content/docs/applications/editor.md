---
title: Canvas editor
description: Draw, arrange, navigate, and move content through Inkfinite's shared editor.
section: Applications
group: Applications
order: 4
---

The web and desktop apps share the same canvas, tools, shortcuts, and document operations. The
desktop app adds native file handling and local CLI access; the web app stores boards in the
browser.

## Navigating the canvas

Pan with a trackpad, middle-button drag, or Space-drag. Pinch or hold Ctrl/Cmd while scrolling to
zoom. The controls in the lower-left corner set an exact zoom level, fit the drawing, or fit the
current selection. **Shift+1** fits the drawing and **Shift+2** fits the selection.

The status bar reports the active tool, cursor and viewport coordinates, selection, save state,
and grid settings. Grid visibility, grid size, and snapping preferences persist between sessions.

## Selecting and moving shapes

Use **Select** for whole shapes and **Direct Select** for a path's anchors and handles. Double-click
a nested shape to move into its group or frame; use Escape to move back out.

Dragging a selection can snap its edges, centers, corners, handles, and equal gaps to nearby
content. The canvas draws guides for each active snap. Hold Shift to constrain movement or drawing
to 15-degree angles. Hold Alt/Option while dragging to duplicate a selection. During resize, Shift
preserves the aspect ratio and Alt/Option resizes around the center.

The **Layout** menu aligns and distributes selected shapes, stacks and grids them, lays out
connected graphs, changes their stacking order, groups or ungroups them, and controls locks.
Graph layouts use relation bindings and both endpoints of bound arrows; they do not infer edges
from nearby objects. The **Object metadata** section edits names, roles, tags,
descriptions, sources, links, and structured metadata for any selection. A single selected object
also shows its provenance. Right-click the canvas or a selection for commands relevant to that
location.

## Draw and Connect

The toolbar includes rectangles, ellipses, frames, lines, arrows, text, Markdown, and freehand
pen strokes. A frame contains ordered child shapes and carries them when it moves. Select a frame
to enter it or fit it to the viewport. The Card stencil creates a frame from ordinary text and
Markdown objects; its selection controls edit the title and body alongside the shared object
metadata fields.

Arrows may be straight, curved, or elbow-routed. Drag an endpoint onto a shape to bind it; the
endpoint follows that shape when it moves. Arrow controls edit bends, endpoint heads, routing, and
labels.

Select a shape to edit its fill, stroke, and opacity. Text, Markdown, and Card selections also
show font and size controls. New canvas text uses Instrument Sans.

| Category | Bundled fonts                                                                         |
| -------- | ------------------------------------------------------------------------------------- |
| Sans     | Instrument Sans, Atkinson Hyperlegible Next, IBM Plex Sans, Google Sans, Playpen Sans |
| Serif    | Source Serif 4, Newsreader, Fraunces                                                  |
| Mono     | JetBrains Mono, Geist Mono, Azeret Mono                                               |

**Direct Select** exposes anchors and Bézier handles for native paths. Path commands can open or
close a path, split or join segments, and change segment geometry.

## Clipboard and Import

The editor preserves hierarchy, assets, and connections when copying and pasting native shapes.
It also accepts plain text, Markdown, SVG markup, SVG files, and images. Use paste in place when
you need the copied coordinates, or paste at the pointer to choose the destination.

Drop an `.inkfinite`, SVG, Excalidraw, or image file onto the canvas to import it. Imported SVG
geometry remains editable when Inkfinite supports the element. Unsupported visual content may be
kept as opaque fallback content; review the import report before discarding the source file.

Images support aspect-ratio resize, crop, opacity, and replacement. Copy a selection as SVG or PNG
when another application needs a presentation copy rather than editable Inkfinite records.

## Layers and Shortcuts

The Layers panel creates, activates, renames, reorders, hides, locks, and changes the opacity of
layers. Its arrow button collapses the panel when the canvas needs more room.

Press **?** for the searchable shortcut list. Common commands include:

- Cmd/Ctrl+C, X, and V for copy, cut, and paste
- Cmd/Ctrl+D to duplicate
- Cmd/Ctrl+G to group and Shift+Cmd/Ctrl+G to ungroup
- arrow keys to nudge, with Shift for 10-pixel steps
- Cmd/Ctrl+B to open the board browser
- Escape to clear a selection or close the current menu or dialog

The editor reports failed saves, imports, exports, and clipboard operations in the interface.
In the desktop app, a draft remains separate from a named `.inkfinite` file until you choose
**Save As**.
