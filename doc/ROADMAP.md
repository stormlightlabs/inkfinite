# Inkfinite Roadmap

Inkfinite is a local-first infinite canvas for humans and agents. The desktop
app, CLI, MCP server, and web application share one native document model and
transaction engine.

The product centers on meaningful objects arranged in two-dimensional space.
A small set of composable geometry, content, structure, and relationship
primitives should support diagramming, sketching, spatial thinking, visual
collection, and agent-assisted editing without separate internal systems for
each workflow.

The next phase prioritizes distribution before larger libraries of reusable or
format-specific content.

## Current: distribution

Inkfinite should be releasable before its release process is heavily
automated.

The public Rust package surface, publication order, target matrices, and local
release commands are defined in the [release guide](RELEASE.md).

The next release candidate needs signed desktop installers, CLI and MCP
archives, crates.io publication, and clean-system installation checks. Add
automation where manual repetition becomes expensive rather than making it a
prerequisite for the first useful release candidate.

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
