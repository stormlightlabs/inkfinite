# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop
app, CLI, MCP server, and web application share one native document model and
transaction engine.

The product centers on meaningful objects arranged in two-dimensional space.
A small set of composable geometry, content, structure, and relationship
primitives should support diagramming, sketching, spatial thinking, visual
collection, and agent-assisted editing without separate internal systems for
each workflow.

The roadmap prioritizes stronger primitives, interoperability, correctness,
editor usability, and performance before large libraries of templates or
format-specific content.

## Current: reliable core editor

### Visual defaults and editor polish

A new document should look intentional without requiring immediate styling.

Centralize creation defaults shared by the editor primitives and remove
hard-coded styling from individual tools. Use restrained neutral styling for
ordinary geometry and reserve Inkfinite's accent for interaction, emphasis,
and relationships.

The editor should have coherent defaults for shapes, frames, connectors, pen
strokes, text, Markdown, and cards across light and dark appearances. Visual
regression fixtures should make accidental changes to those defaults visible.

### Connector geometry

Treat arrows as semantic relationships whose resolved visual geometry uses the
same native path representation as other Inkfinite vectors.

Straight, curved, and orthogonal routing should resolve bindings, waypoints,
and routing parameters into ordinary path geometry. Rendering, SVG export,
bounds, hit testing, labels, and arrowheads should consume that resolved path
rather than maintaining separate connector approximations.

Curved arrows should retain compact editable routing state such as bend and
waypoint information rather than persisting sampled polylines. Arrowheads
should follow the tangent of the resolved path, and labels should be positioned
by distance and normal offset along it.

Shared path metrics should provide length, point and tangent at distance,
nearest-point queries, flattening, and trimming. Keep the canonical geometry
implementation in Rust and expose it through the existing editor bindings so
interactive rendering and headless export cannot diverge.

This path-aware connector work should also provide the geometry foundation for
text on path and other future features that attach content or markers to vector
paths.

### SVG round-trip

Inkfinite has one validated Rust SVG pipeline across desktop, web, CLI, and
MCP. It maps supported geometry and embedded images into native shapes,
preserves hierarchy, transforms, and compound fills, retains source assets,
and reports unsupported content.

Imported descendants are ordinary document records available to editor, CLI,
and MCP operations. Native and fallback fixtures cover save/reopen,
edit/export, undo/redo, CRDT merge, active-document import, and explicit
creation of a new document from SVG.

Interchange uses deterministic native representation where Inkfinite
understands the content and sanitized static fallback content where it does
not.

See [SVG import](apps/web/src/content/docs/development/svg-import.md) and
[native path geometry](apps/web/src/content/docs/development/native-path-geometry.md).

### Richer interoperability

JSON Canvas support should continue to map external data onto ordinary
Inkfinite objects, relationships, frames, cards, and assets rather than
creating a parallel document system.

Mixed-document fixtures should exercise native geometry, imported SVG, raster
assets, links, cards, frames, and relationships together.

Mermaid and D2 are candidates for structured import only if their graphs map
cleanly onto Inkfinite's native objects and relationships. Avoid a separate
format-specific rendering architecture.

## Next: stronger vector primitives

Once native SVG round-trip and ordinary editing workflows are dependable,
expand the vector model itself.

### Boolean geometry

Union, intersection, difference, and exclusion operate on selected native paths
as one undoable editor command. Rust resolves transformed path geometry through
one boolean pipeline, stores the result as ordinary native line segments, and
keeps the first path's transform, paint, metadata, and fill rule. Generated
geometry survives SVG export and import.

### Rich paint

Linear and radial gradients extend flat colors. Gradient stops, opacity,
coordinate units, transforms, and spread behavior live in the canonical
document representation and work through rendering, serialization, SVG
interoperability, editing, CLI inspection, and export.

### Clipping, masks, and effects

Inkfinite supports editable path clipping, alpha and luminance masks composed
from path subpaths, and an initial SVG filter subset: blur, colour adjustments,
opacity, and drop shadows. The editor, canvas renderer, deterministic SVG
exporter, and canonical document projection use the same effect properties.
Unsupported SVG effect primitives remain available as sanitized static fallback
content rather than being discarded.

### Expressive strokes

Add variable-width and pressure-aware strokes without making pressure hardware
a requirement. Width data must remain editable and have deterministic SVG
export behavior.

### Text on path

Allow text to reference editable vector geometry while retaining independent
text and path semantics. Support the useful subset of SVG text-path
interoperability.

## Next: web installation and export workflows

### Clipboard interoperability

Treat the clipboard as another interchange surface.

Selections and documents should be copyable as canonical SVG markup. Raster
exports should be copyable as PNG when platform clipboard APIs permit it, with
predictable browser fallbacks.

### PWA and offline operation

Make the existing local-first web editor installable rather than creating a
separate offline product.

The PWA should cache the application shell, WASM runtime, and required static
assets while continuing to use Inkfinite's normal local document repository.
Creating, editing, reopening, and exporting local documents should continue to
work without a network connection.

Application updates must be explicit enough that cached application code does
not become an invisible second deployment state.

## Distribution

Inkfinite should be releasable before its release process is heavily
automated.

Define the public Rust package surface, crates.io publication order, desktop
platform matrix, and CLI/MCP binary distribution. Keep a documented manual
release checklist and small reproducible build scripts.

GitHub Releases should eventually contain desktop, CLI, and MCP artifacts with
checksums. Publish the intended Rust packages to crates.io.

Automation can be introduced where manual repetition becomes expensive; it is
not a prerequisite for the first useful release candidate.

## Later: reusable content

### User libraries

Built-in stencils already demonstrate reusable ordinary Inkfinite objects.
Later library work should let users save, find, insert, update, and remove
their own selections while retaining nested content, assets, relationships,
and semantics.

Libraries remain ordinary document fragments validated by the shared native
document APIs.

### Starter boards

Starter boards can eventually demonstrate workflows such as system design,
brainstorming, project planning, moodboards, research maps, and wireframes.

They should be ordinary inspectable documents assembled from the same
primitives available to users and agents. Templates should demonstrate a
capable editor rather than compensate for missing primitives or editing
behavior.

## Later: agent and hosted capabilities

Revisit skill organization once CLI and permissioned MCP workflows have
stabilized. Skills should compose stable Inkfinite capabilities rather than
becoming another command or document layer.

Hosted collaboration, remote MCP, identity, and hosted sync remain separate
future concerns. They should not complicate the local document model or local
editor architecture prematurely.
