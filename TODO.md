# Inkfinite TODO

## Release and distribution

- [ ] Decide which Rust crates are public API and which remain workspace-only
- [ ] Define crates.io package metadata and publication order for publishable
      crates
- [ ] Decide whether CLI and MCP ship from one crate with multiple binaries or
      independent packages
- [ ] Define the desktop release matrix for macOS, Linux, and Windows
- [ ] Define the CLI and MCP binary release matrix
- [ ] Add a documented manual release checklist covering version changes,
      changelog, tests, builds, packaging, checksums, tags, and publication
- [ ] Add local release scripts for repeatable desktop and CLI/MCP builds
      without requiring a fully automated release pipeline
- [ ] Publish GitHub release artifacts with checksums
- [ ] Publish intended Rust packages to crates.io
- [ ] Verify installation instructions against clean machines or containers

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
