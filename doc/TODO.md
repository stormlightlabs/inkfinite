# Inkfinite TODO

## Release and distribution

See [RELEASE.md](RELEASE.md) for the package decisions, target matrices, and
manual release procedure.

- [x] Decide which Rust crates are public API and which remain workspace-only
- [x] Define crates.io package metadata and publication order for publishable
      crates
- [x] Ship the CLI and MCP server as independent packages
- [x] Define the desktop release matrix for macOS, Linux, and Windows
- [x] Define the CLI and MCP binary release matrix
- [x] Document the manual release checklist
- [x] Add local desktop and CLI/MCP release commands
- [ ] Publish GitHub release artifacts with checksums
- [ ] Publish `inkfinite-core`, `inkfinite-cli`, and `inkfinite-mcp` to crates.io
- [ ] Verify installation instructions on the clean target systems

## Agent skills

- [ ] Inventory existing skills and the commands or workflows each depends on
- [ ] Remove duplicated instructions that are better represented by CLI or MCP
      capabilities
- [ ] Separate product workflows from repository-development skills
- [ ] Keep skills thin wrappers around stable Inkfinite capabilities rather
      than introducing alternative document semantics
- [ ] Add end-to-end examples for the supported agent workflows
- [ ] Document when agents should use direct CLI control versus permissioned MCP

## Stencil and library workflows

- [ ] Serialize and validate reusable selections through Rust document APIs,
      then manage local library storage and UI in TypeScript
- [ ] Add discovery, update, and removal behavior alongside the existing
      built-in stencil palette
- [ ] Preserve nested content, relationships, assets, and metadata when
      inserting user-authored entries
- [ ] Add end-to-end coverage for saving, finding, inserting, and updating a
      local library entry

## Templates and starter boards

- [ ] Add starter documents for blank canvas, system design, brainstorming,
      project planning, moodboards, research maps, and wireframes
- [ ] Build starters as Rust-validated canonical documents from standard
      primitives, roles, relationships, and libraries
- [ ] Add the starter picker and new-board workflow in TypeScript
- [ ] Verify every starter through open, edit, save, reopen, inspect, and export
- [ ] Add end-to-end tests for opening and editing each starter
