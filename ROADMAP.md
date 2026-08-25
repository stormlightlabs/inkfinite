# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop
app, CLI, MCP server, and web application share one native document model and
transaction engine.

The product centers on meaningful objects arranged in two-dimensional space.
A small set of composable geometry, content, structure, and relationship
primitives should support diagramming, sketching, spatial thinking, visual
collection, and agent-assisted editing without separate internal systems for
each workflow.

The roadmap prioritizes interoperability, editor usability, distribution, and
performance before large libraries of templates or format-specific content.

## Current: richer interoperability

JSON Canvas support should continue to map external data onto ordinary
Inkfinite objects, relationships, frames, cards, and assets. Mixed-document
fixtures should exercise native geometry, imported SVG, raster assets, links,
cards, frames, and relationships together.

Mermaid and D2 are candidates for structured import where their graphs map
cleanly onto Inkfinite's native objects and relationships. Imported nodes,
edges, labels, groups, and supported styles should remain editable and use the
shared graph-layout pipeline. Unsupported constructs need clear warnings and a
predictable fallback rather than a separate format-specific renderer.

## Next: web installation and export workflows

### Clipboard interoperability

Treat the clipboard as another interchange surface. Selections and documents
should be copyable as canonical SVG markup. Raster exports should be copyable
as PNG when platform clipboard APIs permit it, with predictable browser
fallbacks.

### PWA and offline operation

Make the existing local-first web editor installable rather than creating a
separate offline product.

The PWA should cache the application shell, WebAssembly runtime, and required
static assets while continuing to use Inkfinite's normal local document
repository. Creating, editing, reopening, and exporting local documents should
continue to work without a network connection.

Application updates must be explicit enough that cached application code does
not become an invisible second deployment state.

## Distribution

Inkfinite should be releasable before its release process is heavily
automated.

Define the public Rust package surface, crates.io publication order, desktop
platform matrix, and CLI/MCP binary distribution. Keep a documented manual
release checklist and small reproducible build scripts.

GitHub Releases should eventually contain desktop, CLI, and MCP artifacts with
checksums. Publish the intended Rust packages to crates.io. Add automation where
manual repetition becomes expensive rather than making it a prerequisite for
the first useful release candidate.

## Later: reusable content

### User libraries

Built-in stencils already demonstrate reusable ordinary Inkfinite objects.
Later library work should let users save, find, insert, update, and remove their
own selections while retaining nested content, assets, relationships, and
semantics.

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
