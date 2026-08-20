---
title: Native path geometry
description: 'The path representation used by SVG interoperability and vector editing.'
section: Concepts
group: Concepts
order: 11
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
property of the subpath, not a separate segment. Separate subpaths represent compound geometry;
they do not use additional move segments inside one subpath.

## Compound fills

`fill_rule` is either `nonzero` or `evenodd`, matching the SVG fill-rule values. The rule applies
to all subpaths in the path when a renderer determines which regions are inside the compound path.

## Validation and bindings

Rust validates path properties before they enter a shape record. It rejects empty paths,
empty subpaths, subpaths without an initial move, later move segments, and non-finite coordinates.
`validate_shape_properties` applies this check whenever the shape kind is `path`.

The binding generator exports `PathFillRule`, `PathSegment`, `PathSubpath`, and `PathGeometry` to
`@inkfinite/bindings`. Its registry also exposes `validatePathGeometry` and applies the same
structural checks to serialized values.

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
