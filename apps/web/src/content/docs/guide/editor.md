---
title: Editor
description: Navigate the canvas, use drawing tools, select objects, and change their appearance.
section: Guide
group: Guide
order: 3
---

The web and desktop apps share the same canvas, tools, shortcuts, and document operations. The
desktop app adds native file handling and local CLI access.

## Canvas navigation

Pan with a trackpad, middle-button drag, or Space-drag. Pinch or hold Ctrl/Cmd while scrolling to
zoom. The lower-left controls set an exact zoom level, fit the drawing, or fit the current
selection. **Shift+1** fits the drawing and **Shift+2** fits the selection.

The status bar reports the active tool, cursor and viewport coordinates, selection, save state,
and grid settings. Grid visibility, size, and snapping preferences persist between sessions.

## Tools and selection

The toolbar contains Select, Direct Select, shapes, text, Markdown, and pen tools. Select works
with complete objects. Direct Select edits anchors and handles on native paths.

Drag a selection to move it. Hold Shift to constrain movement or drawing to 15-degree angles. Hold
Alt/Option while dragging to duplicate. During resize, Shift preserves the aspect ratio and
Alt/Option resizes around the center.

Double-click a nested object to enter its group or frame. Press Escape to return to its parent.
Right-click the canvas or a selection for commands that apply at that location.

## Appearance

Select an object to edit its fill, stroke, and opacity. Text, Markdown, and Card selections also
show font family and size controls. Arrow controls edit bends, endpoint heads, routing, and labels.

The command palette searches selection and viewport commands. The Layers panel controls layer
order, visibility, locks, names, and opacity. See [Objects and structure](/docs/guide/objects-and-structure/)
for frames, groups, cards, and metadata.

## Errors and recovery

The editor reports failed saves, imports, exports, and clipboard operations in the interface. A
desktop draft remains separate from a named `.inkfinite` file until you choose **Save As**.
