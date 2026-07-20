# Inkfinite implementation tickets

These tickets implement [ROADMAP.md](ROADMAP.md).

Tickets appear in dependency order. Their IDs stay stable when the sequence
changes.

## Milestone 1: Architecture gate

Exit when the initial baseline is reproducible and the CRDT decision has measured
evidence.

### V2-01: Freeze baseline fixtures and measurements

Captured representative web and desktop documents, invalid documents, rendering
examples, and a generated 10,000-shape board before the durable model changes.

### V2-02: Prove the CRDT boundary

Implemented a disposable Automerge proof through an
Inkfinite-owned interface. Compare Yjs/Yrs only if Automerge misses a gate.

## Milestone 2: Rust document authority

Exit when Rust can create, edit, merge, validate, persist, and expose the current
document independently of Tauri and Svelte.

### V2-03: Scaffold the vNext project structure

Created the target Cargo and pnpm workspace layout as a compileable shell
before moving behavior or defining the current model.

### V2-04: Define the Rust document and protocol contracts

Added typed document records, project-owned CRDT traits, and protocol records without UI,
Tauri, transport, or CLI parsing dependencies.

### V2-05: Implement validated CRDT transactions

Applies every durable operation through one engine transaction and
one CRDT change, returning patches, heads, inverse metadata, affected IDs, and
warnings.

### V2-06: Generate schemas and TypeScript bindings

Generates document, transaction, and protocol bindings from Rust and prove the Rust and
TypeScript shape registries agree.

### V2-07: Persist documents safely

Persist canonical `.inkfinite` CRDT files, export stable JSON projections, and
recover from interrupted writes.

## Milestone 3: Desktop vertical slice

Exit when a desktop gesture commits through Rust, redraws from a returned patch,
survives reopen, and can be undone. The web and desktop composition roots must
render the same `@inkfinite/ui/editor` module while keeping Dexie and Tauri in
their respective application adapters. Do not create a second editor component
tree or theme.

### V2-08: Make Tauri own document sessions

Replaced frontend-owned desktop documents with a Rust session service and typed Tauri
commands.

### V2-09: Extract the editor runtime and transaction drafts

Split the large Svelte canvas controller into a framework-neutral editor runtime and a
thin Svelte adapter, with ephemeral gesture previews and durable transaction drafts.

## Milestone 4: Editor structure and scale

Exit when input remains correct through viewport changes and the 10,000-shape
budget passes with measured optimizations.

### V2-10: Fix cursor mapping across viewport changes

Implemented current-bound coordinate mapping, reactive viewport invalidation, and
pointer-capture cleanup across resize, scrolling, and device-pixel-ratio changes.

### V2-11: Meet the 10,000-shape rendering budget

Optimized measured rendering and hit testing while retaining a simple Canvas 2D design.

## Milestone 5: Layers, styles, and stencils

Exit when imported and new documents expose predictable layer behavior and
opacity without regressing existing stencils.

### V2-12: Ship layers through model, renderer, interaction, and UI

Shipped ordered layers with visibility, locking, active-layer state, opacity,
and a complete Svelte panel.

### V2-13: Add shape opacity and finish active-layer stencils

Exposed fill and stroke opacity, completed the curated built-in stencil set, and
made stencil insertion obey active-layer rules.

## Milestone 6: CLI and headless rendering

Exit when scripts and agents can inspect, safely change, validate, and render a
closed document without desktop code.

### V2-14: Render deterministic SVG

Added headless SVG rendering for all built-in shapes, layers, bindings, transforms,
opacity, text, and Markdown.

### V2-15: Ship read-only and schema CLI commands

Implemented `new`, `inspect`, `query`, `validate`, `schema`, and `capabilities`
in file mode with stable human and machine output, global output controls, and
task-oriented help.

### V2-16: Ship mutating CLI commands and SVG output

Added generic apply plus structured shape, connection, layout, and
render commands, all through the transaction engine.

## Milestone 7: Live control and CRDT sync

Exit when a running desktop app can be inspected and changed safely and two
offline app replicas converge after reconnecting.

### V2-17: Add authenticated local IPC

Hosts a versioned local-socket server in Tauri and connect the CLI
for status, inspect, query, and focus.

### V2-18: Add reviewable agent proposals and explicit apply

Lets the live CLI propose a transaction for ghost-preview review or
apply it only with explicit authorization.

### V2-19: Sync two offline replicas

What to build: Wired the selected CRDT sync protocol through a transport-neutral
peer layer and prove desktop-to-desktop convergence.

## Milestone 8: Agent and release readiness

Exit when a clean installation supports a complete human-and-agent wireframing
session, every CLI, proposal, recovery, and sync acceptance path passes, useful
predecessor coverage has native replacements, and no unreleased predecessor
model remains in the product or codebase.

### V2-20: Bundle the Inkfinite agent skill

What to build: Package a concise `SKILL.md` and worked fixtures around the stable
CLI, schemas, and proposal workflow.

Blocked by: V2-16, V2-18

Acceptance criteria:

- [x] The skill teaches inspect heads → narrow query → minimal transaction →
      dry-run → resolve → apply/propose → validate → render.
- [x] Rules cover locks, `agent_editable`, semantic selectors, layout operations,
      manual-file-edit prohibition, and explicit authorization for direct apply.
- [x] CLI help and generated schemas remain the command reference; the skill does
      not duplicate every option.
- [x] Worked examples create, patch, connect, lay out, propose, partially accept,
      and recover from a head conflict.
- [x] At least one clean agent run completes each example without UI automation.

Verification:

- Installed `skills/inkfinite` into a temporary fixture directory and ran its
  help, capability, schema, file-mode, proposal, partial-acceptance, and
  head-conflict examples with `scripts/verify-examples.sh`. The live examples
  used the real CLI framing and an authenticated Unix-socket fixture server;
  no UI automation or canonical-file byte edits were used.

### V2-22: Collapse to one native Inkfinite model — complete

The current document model and file flow are the only supported
Inkfinite model. Removed the temporary predecessor/current split, retained only
explicit file, schema, and protocol version fields, and converted useful
coverage to native fixtures and tests.

### V2-23: Complete a human-and-Codex desktop wireframing session

What to build: Run and record a realistic QA session in which a user and Codex
co-design a desktop application wireframe through the packaged Inkfinite skill,
the live CLI, and the desktop proposal review surface.

Blocked by: V2-20, V2-22

Acceptance criteria:

- [ ] Start from a clean desktop build and a fresh Codex context with only the
      packaged skill installed. After launch, disconnect the network; the rest
      of the session requires no account, server, browser automation, raw
      document edit, or unbundled repository instruction.
- [ ] The user creates or selects a local `.inkfinite` document and gives Codex
      a short desktop-application brief. The target wireframe exercises named
      semantic roles, text, connections, at least two layers, and one locked or
      `agent_editable: false` element.
- [ ] Codex discovers the open session, inspects its heads, queries only the
      relevant records, and describes a small first change before proposing it.
      The first durable agent action uses `app propose`, not direct apply.
- [ ] The user rejects one proposal and confirms that the snapshot and heads do
      not change, then requests a revision and reviews its ghost preview and
      created, changed, and deleted IDs.
- [ ] The user partially accepts a proposal whose operations can remain valid
      independently. Inkfinite commits only the selected operations once and
      Codex re-inspects the result before continuing.
- [ ] The user makes an intervening canvas edit while a later proposal is open.
      Accepting the stale proposal produces a refreshed review or a clear
      conflict; it never commits silently against old heads or loses the human edit.
- [ ] Codex completes the wireframe with reviewed proposals while respecting
      locked layers, `agent_editable`, and semantic selectors. The user can also
      continue editing with normal desktop tools between proposals.
- [ ] Save and close the document while still offline. File-mode `validate` and
      deterministic SVG rendering pass; after reopen, the canvas and
      `app inspect` agree with those artifacts and undo/redo remains coherent
      across accepted work.
- [ ] Record the brief, Inkfinite and skill versions, platform, commands, review
      decisions, final `.inkfinite` file, SVG, screenshots, and any defects. A
      failed step gets a focused follow-up ticket and the sequence is rerun after
      its fix.

Verification:

- Build and launch the desktop release candidate, install the V2-20 skill in a
  clean Codex environment, disable networking, and complete the sequence above
  without UI automation. Attach the command transcript and artifacts to the
  release evidence.

### V2-21: Run the vNext release matrix

What to build: Assemble release evidence and close every roadmap success
criterion against the native release candidate without adding new architecture.

Blocked by: V2-11, V2-12, V2-13, V2-14, V2-16, V2-18, V2-19, V2-20, V2-22,
V2-23

Acceptance criteria:

- [ ] All Rust, TypeScript, browser, shared-fixture, generated-artifact, CLI, IPC,
      convergence, recovery, accessibility, and visual tests pass against the
      native model.
- [ ] The recorded 10,000-shape frame, query, memory, open, save, and sync budgets
      pass on reference hardware with results attached.
- [ ] Backup restoration and rollback are rehearsed with native files; malformed,
      interrupted, and conflicting writes preserve the last valid document.
- [ ] Human review signs off layers, proposal UX, the V2-23 collaborative
      wireframe, render parity, recovery prompts, and permission failures on
      supported desktop platforms.
- [ ] File-format and release documentation describe exactly the native model
      and behavior under evaluation.

## Parking Lot

- How should bundling/packaging work?

### QA

- We don't expose agent editable in the UI
- Save As doesn't work
- We don't expose dirty when creating a new board
- Saving doesn't work
