---
title: Testing
description: 'How Inkfinite uses shared fixtures and tests to protect document and interchange behavior.'
section: Internals
group: Internals
order: 13
---

Inkfinite keeps correctness checks close to the Rust document model and the
interchange boundaries they protect. Shared fixtures make parser, geometry,
rendering, and serialization behavior reproducible without a network request.

## SVG import fixture corpus

`fixtures/svg-import/` contains the checked-in inputs used by the Rust SVG
import integration tests. Icon and logo inputs are derived from the Catppuccin,
Simple Icons, Skill Icons, and Devicon Plain Iconify sets. The corpus also
covers nested group transforms, compound even-odd paths, unsupported features
and active content, and malformed XML, numbers, paths, and transforms.

The fixture tests check native node counts, source retention, `currentColor`,
path validation, fill rules, warning coverage, and typed failures. Add a
minimized fixture when a real SVG exposes an importer regression.

Run the focused suite with:

```sh
cargo test -p inkfinite-core --test svg_import_fixtures
```

The source and licenses for the Iconify-derived inputs are listed in the
repository's `fixtures/svg-import/README.md`.
