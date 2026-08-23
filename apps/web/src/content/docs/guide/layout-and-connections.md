---
title: Layout and connections
description: Align selections, arrange connected graphs, bind arrows, and use snapping guides.
section: Guide
group: Guide
order: 5
---

Inkfinite can arrange a selection by geometry or by the relationships stored between objects.

## Align and distribute

Select two or more objects and open **Layout**. Alignment commands line up left, center, right, top,
middle, or bottom edges. Distribution makes horizontal or vertical spacing even. **Tidy** repairs
an uneven row or column, while stack and grid commands create a regular arrangement.

Order commands move objects forward, backward, to the front, or to the back. The menu also groups,
ungroups, locks, and unlocks a selection.

## Graph layout

Tree, flow, and radial layouts arrange objects connected by relationship bindings. Tree and flow
layouts support horizontal and vertical directions. Radial layout places connected objects around
the graph.

Graph layout reads relation bindings and both endpoints of bound arrows. It does not infer an edge
because two objects happen to be near each other. Select the connected objects you want to arrange,
then choose a graph layout from **Layout**.

## Arrow bindings

Create an arrow and drop an endpoint on a shape to bind it. A bound endpoint follows the shape when
it moves or resizes. Arrows can be straight, curved, or elbow-routed and can carry labels and
relationship metadata.

Use arrow selection controls to change routing, bends, heads, and labels. A free endpoint remains at
its canvas position until you drag it onto an object.

## Snapping

When you move or resize a selection, Inkfinite can snap edges, centers, corners, handles, and equal
gaps to nearby content. The canvas draws a guide for each active snap. Change snapping and grid
preferences from the status bar.
