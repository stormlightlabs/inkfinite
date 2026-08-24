# SVG import fixtures

- `icons/` contains the Bootstrap `filetype-svg` regression icon, one Catppuccin
  icon, and one Simple Icons logo.
- `logos/` contains Skill Icons and Devicon Plain logos. Both use the
  `currentColor` paint form used by many SVG icon packages.
- `nested-groups/` checks group-local transforms, inherited paint, and opacity.
- `compound-paths/` checks repeated subpaths, elliptical arcs, and even-odd
  fill rules.
- `gradients/` checks transformed linear gradients, radial gradients, inherited
  stops, spread behavior, and stop opacity.
- `unsupported/` checks warnings for omitted features and active content.
- `malformed/` checks that invalid XML, numbers, paths, and transforms fail
  before a partial import is returned.

The icon bodies are derived from the Iconify icon sets repository:

- [Catppuccin](https://github.com/iconify/icon-sets/blob/master/json/catppuccin.json)
- [Simple Icons](https://github.com/iconify/icon-sets/blob/master/json/simple-icons.json)
- [Skill Icons](https://github.com/iconify/icon-sets/blob/master/json/skill-icons.json)
- [Devicon Plain](https://github.com/iconify/icon-sets/blob/master/json/devicon-plain.json)

Those sets provide MIT-licensed source material. The Bootstrap fixture comes
from the [Bootstrap Icons filetype-svg page](https://icons.getbootstrap.com/icons/filetype-svg/).
The fixture wrappers keep the source view boxes and retain the original SVG
input so importer behavior can be reproduced without a network request.
