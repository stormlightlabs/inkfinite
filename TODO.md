# Inkfinite TODO

## SVG round-trip

Run representative native and fallback SVG fixtures through each complete
document workflow. Compare normalized structure where representation matters
and rendered output where visual fidelity matters.

- [ ] Test import through save/reopen, edit/export, undo/redo, and CRDT merge
- [ ] Test imported shapes through CLI inspect, query, and mutation
- [ ] Verify native vectors export without rasterization
- [ ] Verify nested transforms export deterministically
- [ ] Verify compound fill rules survive import and export
- [ ] Verify opaque fallback content remains visually stable
- [ ] Add deterministic round-trip fixtures for these workflows

## Editor interaction and visual system

### Application chrome

Separate persistent application actions from drawing tools and
selection-specific controls.

- [x] Split the current editor toolbar into tool, application, and contextual
      control surfaces
- [x] Keep the primary tool dock limited to tool selection and active-tool
      controls
- [x] Move import and export into file/application chrome
- [x] Move layout, arrange, group, lock, and related commands into selection
      context
- [x] Move stencils into an insert/library surface
- [x] Remove the Stormlight Labs tagline and other non-editor content from the
      primary drawing controls
- [x] Preserve compact layouts for narrower viewports and coarse pointers
- [x] Verify floating controls do not obscure selection handles, dialogs, or
      proposal review UI

### Contextual selection controls

Expose only controls that apply to the active tool or current selection.

- [ ] Define contextual controls from shape capabilities rather than one shared
      selection panel
- [ ] Show fill, stroke, opacity, and shape-specific controls only when
      applicable
- [ ] Give arrows a focused stroke, endpoint, and connection control surface
- [ ] Give text and Markdown selections focused typography controls
- [ ] Give multi-selection a focused align, distribute, group, and arrange
      surface
- [ ] Preserve mixed-value states when selected shapes do not share a property
- [ ] Keep contextual controls keyboard accessible and return focus correctly
      when popovers close
- [ ] Add interaction tests for contextual controls across representative
      selection types

### Theme and component consistency

Use one visual system across editor chrome, menus, dialogs, popovers, and
selection UI.

- [ ] Keep one primary Inkfinite accent family across light and dark themes
- [ ] Tune accent luminance and contrast independently for each theme
- [ ] Audit `editor/styles.css` and remove or migrate legacy theme, typography,
      reset, and token rules
- [ ] Use the shared `--ink-*` tokens for editor components instead of local
      color or spacing systems
- [ ] Standardize panel borders, elevation, radii, and focus treatment
- [ ] Reserve irregular radii and hard offset shadows for deliberate
      canvas-oriented accents rather than every control
- [ ] Remove duplicate and contradictory toolbar/menu CSS declarations
- [ ] Verify text, controls, selection states, and focus indicators meet
      contrast requirements in both themes

### Color controls

Keep fast color selection compact while preserving the full Reasonable Colors
palette.

- [ ] Reduce the default color picker surface to a compact quick palette
- [ ] Keep recent colors visible in the primary picker surface
- [ ] Move full family shades and custom hex entry behind a secondary
      `Custom…` action
- [ ] Add an explicit none/transparent option for properties that support it
- [ ] Use consistent swatch geometry and selected-state treatment
- [ ] Preserve keyboard navigation, focus restoration, and coarse-pointer hit
      targets
- [ ] Test color selection, recent colors, custom values, invalid values, and
      transparent values

### Agent review UI

Make model-proposed edits visually distinct from ordinary user editing.

- [ ] Define dedicated visual tokens for proposed additions, modifications, and
      removals
- [ ] Keep proposal visuals distinct from the ordinary selection accent
- [ ] Consolidate proposal metadata, change count, accept, and reject actions
      into one review surface
- [ ] Keep proposal review controls visible without covering the affected
      content
- [ ] Show agent editability in selection context rather than the primary tool
      strip
- [ ] Verify accepted and rejected proposals leave no stale ghost or review
      state
- [ ] Add interaction tests for proposal preview, accept, reject, and
      non-editable selections

### Interaction pass

Apply the same behavior to equivalent controls throughout the editor.

- [ ] Standardize hover, pressed, selected, disabled, busy, and focus-visible
      states
- [ ] Standardize menu and popover placement, dismissal, and focus restoration
- [ ] Standardize control heights, icon sizes, spacing, and minimum pointer
      targets
- [ ] Remove controls whose hover state is visually indistinguishable from
      idle
- [ ] Verify menus and popovers remain inside the viewport at editor edges
- [ ] Verify tool changes, selection changes, and viewport actions do not cause
      unintended layout jumps
- [ ] Add Storybook coverage for important component states and combinations

## Permissioned MCP

### Server and discovery

- [x] Add `inkfinite-mcp` crate with `rmcp` and its macros
- [x] Start with stdio transport and expose Inkfinite capability metadata
- [x] Reuse core query and transaction APIs rather than shelling out to the CLI
- [x] Discover open sessions and accessible files
- [x] Inspect document metadata and causal heads
- [x] Query records by role, kind, parent, and bounds

### Mutations

- [ ] Create, patch, move, reparent, and delete shapes
- [ ] Create and patch layers and containers
- [ ] Apply layout operations and manage connections
- [ ] Import SVG where appropriate
- [ ] Return affected IDs and heads from every mutation
- [ ] Expose dry-run or preview behavior where useful

### Permissions

- [ ] Define read, create, modify, delete, and layout permissions
- [ ] Define per-document and per-session policy
- [ ] Apply `agent_editable` at the MCP boundary
- [ ] Decide hidden-layer visibility policy
- [ ] Decide how ordinary locks interact with MCP permissions
- [ ] Decide whether proposal/review belongs in MCP
- [ ] Return authorization errors separately from validation errors

### Verification and guidance

- [ ] Test read-only and restricted-write sessions
- [ ] Test denied mutations, `agent_editable`, and locks
- [ ] Test stale heads and invalid transactions
- [ ] Update or split the Inkfinite skills for CLI and MCP usage

## Performance profiling

### Corpus and method

- [ ] Build executable small, medium, large, and 10,000-shape fixtures
- [ ] Add vector-heavy, deeply nested, imported-SVG, and connection-heavy
      fixtures
- [ ] Record reference hardware and benchmark methodology

### Measure

- [ ] Profile open, save, Automerge load, and materialization
- [ ] Profile validation, commit, undo/redo, merge, queries, and memory
- [ ] Profile Canvas frames, culling, hit testing, nested transforms, and path
      rendering
- [ ] Profile selection overlays and vector-edit previews
- [ ] Profile SVG parse/import/export and common CLI operations
- [ ] Profile local IPC and MCP startup, queries, and mutations

### Optimize from evidence

- [ ] Record baselines, dominant costs, and regression budgets
- [ ] Evaluate spatial indexes, path/render caches, incremental materialization,
      or alternate renderers only when a measured bottleneck supports the
      change

## Backlog

- [ ] Add boolean paths, gradient editing, clip/mask/filter editing,
      variable-width strokes, and text on path
- [ ] Add a web manifest, service worker, PWA installation, and stronger
      offline behavior
- [ ] Decide crates.io and desktop release packaging; automate release
      artifacts
- [ ] Revisit skill organization after SVG and MCP workflows stabilize
- [ ] Export SVG as copyable code
- [ ] Export PNG to clipboard
- [ ] Add a move handle to the layer pane
