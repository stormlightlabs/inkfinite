---
title: Native path geometry
description: 'The path representation used by SVG interoperability and vector editing.'
section: Development
group: Development
order: 21
---

Inkfinite stores arbitrary vector geometry as native `path` shapes. SVG import and vector
editing use this representation instead of keeping an SVG-specific document model.

## Representation

A path shape has `kind: "path"`. Its kind-specific properties store `subpaths` and `fill_rule`:

```json
{
	"subpaths": [
		{
			"segments": [
				{ "type": "move", "to": { "x": 0, "y": 0 } },
				{ "type": "line", "to": { "x": 40, "y": 0 } },
				{
					"type": "quadratic",
					"control": { "x": 50, "y": 10 },
					"to": { "x": 40, "y": 20 }
				},
				{
					"type": "cubic",
					"control_1": { "x": 40, "y": 30 },
					"control_2": { "x": 0, "y": 30 },
					"to": { "x": 0, "y": 20 }
				}
			],
			"closed": true
		}
	],
	"fill_rule": "nonzero"
}
```

Coordinates belong to the path's local coordinate system. The shape transform places that local
geometry relative to its layer or parent container. Painting properties can live alongside the
geometry in the shape's properties.

## Segments and subpaths

Every subpath has at least one segment and starts with exactly one `move` segment. The move gives
the subpath its starting point. Later segments continue from the previous destination:

- `line` stores a destination point.
- `quadratic` stores one control point and a destination.
- `cubic` stores two control points and a destination.

A `closed` subpath connects its final destination back to its initial move point. Closure is a
property of the subpath, not a separate segment. Separate subpaths represent compound geometry
but do not use additional move segments inside one subpath.

## Compound fills

`fill_rule` is either `nonzero` or `evenodd`, matching the SVG fill-rule values. The rule applies
to all subpaths in the path when a renderer determines which regions are inside the compound path.

## Validation and bindings

Rust validates path properties before they enter a shape record. It rejects empty paths,
empty subpaths, subpaths without an initial move, later move segments, and non-finite coordinates.
`validate_shape_properties` applies this check whenever the shape kind is `path`. Create and patch
operations reserialize valid path geometry through the Rust representation before committing it.

Freehand shapes keep their input points and brush settings as properties. Rust validates those
properties at the same transaction boundary, writes their canonical field representation, and
computes the committed outline for bounds and invalidated regions. TypeScript can use
`perfect-freehand` for pointer previews and hit testing. It doesn't decide whether a stroke enters
the document.

The binding generator exports `PathFillRule`, `PathSegment`, `PathSubpath`, and `PathGeometry` to
`@inkfinite/bindings`. Its registry also exposes `validatePathGeometry` and applies the same
structural checks to serialized values.

## Editing ownership

`inkfinite-core` owns deterministic operations that produce committed path geometry or hierarchy
changes. This includes splitting curves to add anchors, deleting anchors, converting segment types,
opening and closing subpaths, joining endpoints, and computing parent-relative transforms when
reparenting a shape without changing its world-space appearance. These operations are exposed to
interactive clients through generated bindings and WASM where needed. CLI, MCP, desktop, and web
edits therefore use the same implementations rather than replacing complete paths with geometry
constructed independently by each interface.

TypeScript owns direct-selection tool state, selected anchors and handles, pointer interpretation,
overlays, and frame-by-frame gesture previews. A preview may mirror a Rust calculation to avoid a
round trip during pointer movement, but it does not define committed geometry. Shared fixtures must
compare preview results with the canonical Rust operation for curve splitting, topology changes,
and nested transforms.

Direct selection uses Alt-click on a rendered segment to add an anchor. Delete removes selected
anchors. Q and C convert their incoming segments to quadratic and cubic curves, L converts them
to lines, O opens selected subpaths, Z closes them, and B breaks selected cubic handles. J joins
two selected endpoints from separate open subpaths, or joins cubic handles for another selection.
These commands remain editor interactions. The resulting topology operations are committed through
the Rust reconciliation API.

A completed gesture submits one operation in one transaction through the Rust document session. Rust
applies the operation, validates the resulting path and hierarchy, computes committed bounds and
invalidated regions, and returns the updated editor projection. One completed gesture therefore
produces one undo step.

## Geometry and rendering

Path bounds use segment endpoints and the interior extrema of quadratic and cubic Bézier
curves. A closed subpath contributes its implicit closing line. Shape transforms compose
from the path to its parent and through the containing hierarchy.

The Canvas renderer draws move, line, quadratic, and cubic segments and applies the stored
compound fill rule. Fill hit testing uses the same rule. Stroke hit testing follows the
flattened curve segments with the stored stroke width and selection tolerance. Headless SVG
output serializes normalized commands with fixed numeric formatting, fill rules, painting
properties, and composed transforms.

Rust and TypeScript consume shared valid and invalid path fixtures. The fixtures cover curve
bounds, compound geometry, nested transforms, and validation errors for malformed paths. SVG
parsing and direct path editing build on these services.
