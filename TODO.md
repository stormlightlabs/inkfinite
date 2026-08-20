# Inkfinite implementation tickets

These tickets implement [ROADMAP.md](ROADMAP.md).

## Completed Work

- Completed work is logged in the [changelog](CHANGELOG.md)
    - CLI and headless rendering
    - Live control and CRDT sync
    - Agent and release readiness
    - Bundled Inkfinite agent skill
    - Collapse to one native Inkfinite model

## Parking Lot

- The web app could be made into a PWA.
    1. add webmanifest
    2. add a _kit_ service worker
    3. make it offline-first

### Fixtures

- Fixtures should live in an unpublished fixtures crate (sort of like lectito),
  that acts as an executable performance corpus

### Features

- SVG Editing
- MCP (see below)

### Bundling/Packaging

- How should this work?
    - CLI & core to crates.io
    - Applications to GH releases

### Skill

- Does the skill really need fixtures? Could those live in the above mentioned
  fixture crate?
- Can/should the skill be split up?
- If/when SVG editing is added, we maybe should make multiple skills for drawing,
  wireframing, svg editing, etc. Pixijs, Remotion, and Cloudflare do a good job
  of separating skills.

### MCP

- The CLI should probably be more permissive and permissioned usage should
  stick with the MCP. That would give a developer more flexibility to choose
  how an agent interacts with documents.
    - Permissions pollute the CLI's signature and make its scriptability tedious

### QA
