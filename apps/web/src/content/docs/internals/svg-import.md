---
title: SVG import
description: 'How static SVG content is parsed into Inkfinite native shapes and assets.'
section: Concepts
group: Concepts
order: 12
---

Inkfinite parses the supported static SVG subset in Rust and maps it to native
shape properties. The importer does not retain an SVG-specific document model.
Its output is a normalized tree that can later be turned into one validated
Inkfinite transaction.

## Import boundary

`inkfinite_core::svg_import` exposes two entry points:

- `parse_svg(&str)` parses UTF-8 SVG text.
- `import_svg(impl AsRef<[u8]>)` accepts SVG text or UTF-8 file bytes.

Both functions return an `SvgImport` value:

```rs
SvgImport {
    view_box: Option<SvgViewBox>,
    root: SvgGroup,
    source_asset: SvgAsset,
    assets: Vec<SvgAsset>,
    warnings: Vec<SvgImportWarning>,
}
```

`SvgGroup` retains its source ID, parent-relative transform, opacity, calculated
size, and ordered `SvgImportNode` children. A node is a group, a native
`SvgShape`, or an `SvgImage` referencing an extracted asset. Source IDs are
hints for the transaction layer. Callers assign document record IDs when they
create the import transaction.

`source_asset` is the exact UTF-8 input as an `image/svg+xml` asset with a
content-addressed ID. `assets` contains the embedded raster assets referenced
by image nodes. The source asset is retained even when the native tree omits
unsupported content, so a later transaction can re-import it or attach an
opaque fallback when that shape kind exists.

## Native mappings

| SVG element             | Import result                                             |
| ----------------------- | --------------------------------------------------------- |
| `g`                     | `SvgGroup`, which maps to a native container              |
| `rect`                  | `rect` shape with width, height, radius, fill, and stroke |
| `circle`                | `ellipse` shape with equal width and height               |
| `ellipse`               | `ellipse` shape                                           |
| `line`                  | `line` shape with local endpoints, stroke, and width      |
| `polygon`               | Closed `path` shape                                       |
| `polyline`              | Open `path` shape                                         |
| `path`                  | `path` shape                                              |
| `text`                  | `text` shape                                              |
| embedded raster `image` | `SvgImage` plus an embedded `SvgAsset`                    |

The importer handles SVG coordinates in user units. Numeric lengths can use
`px`, `pt`, `pc`, `mm`, `cm`, `in`, or percentages when the root has a view box.
Negative coordinates are valid, and negative dimensions are rejected.

## Path normalization

SVG path data is normalized to the native path representation described in the
[native path geometry guide](/docs/internals/native-path-geometry/):

- relative and absolute move, line, horizontal, and vertical commands become
  move and line segments
- quadratic, cubic, smooth quadratic, and smooth cubic commands become native
  quadratic and cubic segments
- elliptical arcs become one or more cubic Bézier segments
- `Z` sets the current subpath's `closed` flag
- a later command after `Z` starts a new normalized subpath at the closing point
- `fill-rule="nonzero"` and `fill-rule="evenodd"` are preserved

Path parsing rejects malformed command data and produces no partial path.

## Transforms

Each group keeps its own SVG transform. A shape keeps its element transform and
combines it with its local geometry origin. Nested groups therefore compose in
the same order as the SVG hierarchy.

The native transform model represents translation, rotation, and scale. SVG
transform lists and matrices are accepted when they decompose into that model.
Skewed matrices and zero scales return an error rather than changing the
geometry silently.

## Painting and opacity

Presentation attributes and declarations in `style` are resolved together with
inherited values. The importer preserves supported `fill`, `stroke`,
`stroke-width`, `fill-rule`, `fill-opacity`, `stroke-opacity`, and `opacity`
values. SVG defaults are a black fill and no stroke. `none` and `transparent`
become absent native paint values.

Paint servers such as gradients, patterns, `currentColor`, and other
unsupported `url` values produce warnings and are omitted from the native paint
properties. `linearGradient`, `radialGradient`, mesh gradients, patterns,
`clipPath`, `mask`, and `filter` definitions and references each produce a
feature-specific warning. The importer does not evaluate a paint server or
resolve a resource URL.

## Text

Simple SVG text becomes one native `text` shape. The importer uses the first
`x` and `y` value as the native text origin, copies the first font family,
`font-size`, and fill, and concatenates descendant text nodes. Nested `tspan`
elements contribute their text but do not create separate shapes. Text layout,
text paths, anchors, and rich span styling are not represented yet.

## Embedded images

The importer accepts embedded PNG, JPEG, GIF, and WebP data URLs. It decodes
the bytes once, creates a content-addressed `SvgAsset` with a SHA-256 digest,
and reuses that asset when multiple image elements contain the same bytes.
External URLs and unsupported media types are skipped with warnings. The parser
does not fetch resources.

`SvgImage` nodes retain the source element's position, size, transform,
opacity, and asset ID. The current native shape registry has no image kind, so
these nodes remain in the import result until image shape support is added.

## Unsupported content and security

The importer is a static parser. Named unsupported visual features are omitted
from the normalized native tree and reported through typed
`SvgImportWarning::UnsupportedFeature` values. Other unsupported elements use
`SvgImportWarning::UnsupportedElement`. Their bytes remain in
`source_asset`. The importer does not create a live opaque fallback because the
native document model does not yet have an SVG-backed shape. A future fallback
must render only a sanitized, static projection of the retained source and keep
the imported subtree movable as one object.

Gradients, patterns, clip paths, masks, and filters are not evaluated. Stylesheet
blocks, event-handler attributes, scripts, and SVG animation elements are
ignored with warnings. External image URLs and other resource references are
also omitted. No script, animation, stylesheet, or resource is executed,
inserted into a live DOM, or fetched during import. The retained source asset is
input data for provenance and future re-import, not executable document content.

## Input safety and failures

The parser accepts at most 16 MiB of UTF-8 input. XML, numeric attributes,
transforms, path data, and embedded image data are validated before they enter
the result. Malformed input returns an error rather than a partial import.
