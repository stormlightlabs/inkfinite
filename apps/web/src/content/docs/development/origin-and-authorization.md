---
title: Origin and authorization
description: How transaction provenance differs from document locks and integration permissions.
section: Development
group: Development
order: 22
---

Inkfinite records the source of each transaction separately from the rules that decide whether an
operation is valid or authorized. Keeping those concerns separate prevents caller-supplied history
metadata from becoming a permission credential.

## Transaction origin

`Origin` is defined in `crates/inkfinite-core/src/lib.rs` and serialized as one of four values:

- `human` for edits made through the editor
- `agent` for edits submitted through agent-oriented CLI and IPC paths
- `sync` for changes received from a peer
- `system` for deterministic repair and other internal changes

Origin is provenance metadata. Code can retain it in transaction history, diagnostics, and
attribution UI, but must not use it to grant or deny access. In particular, changing a transaction
from `origin: agent` to `origin: human` must never give the caller more capability.

## Validation and authorization

The transaction engine applies document correctness rules to every origin. These include schema
validation, causal-head and record-version checks, atomic commit, document validation, and
ordinary shape and layer locks.

Authorization belongs at an interface that can identify the caller and its granted permissions.
The general CLI is a capability interface: people, scripts, and agents can invoke it or construct a
raw transaction draft. A permissioned integration such as MCP can enforce read, create, modify,
delete, and layout permissions before passing a valid transaction to the engine.

`agent_editable` remains document metadata for permissioned integrations. It is not a document
invariant, and the core engine should not infer a caller's authority from transaction provenance.

## Relevant code

The current implementation spans these paths:

| Path                                                   | Responsibility                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `crates/inkfinite-core/src/lib.rs`                     | Defines `Origin`, provenance, and document metadata                      |
| `crates/inkfinite-core/src/engine/policy.rs`           | Applies transaction schema checks and ordinary document locks            |
| `crates/inkfinite-core/src/engine/query.rs`            | Queries records independently of layer visibility and transaction origin |
| `crates/inkfinite-core/src/session.rs`                 | Validates live proposals and applies                                     |
| `crates/inkfinite-core/src/ipc`                        | Carries live transactions between CLI and desktop sessions               |
| `crates/inkfinite-cli/src/cli`                         | Constructs agent-originated shape, mutation, and SVG import transactions |
| `packages/core/src/persistence/canonical.ts`           | Maps `agent_editable` between native records and editor state            |
| `packages/ui/src/lib/editor/components/Toolbar.svelte` | Lets people set `agent_editable` on selected shapes                      |

Generated document, transaction, and protocol schemas also expose `Origin` and `agent_editable`.
Regenerate them after changing either serialized type.

## Current behavior

The transaction engine does not branch on `Origin`. Direct CLI transactions can query and mutate
records in invisible layers and records whose `agent_editable` value is false. Shape and layer locks
still reject edits for every origin, including edits reached through a locked ancestor or a layer
delete.

`session.rs` requires agent origin at live proposal and apply entry points as a protocol-shape
check, not as authorization. Proposal size, description length, stale-head handling, transaction
validation, and atomic commit do not depend on origin. Live applies do not require a desktop access
mode.

Committed transactions retain their origin. Causal heads, record versions, schema validation,
document validation, and atomic commit apply to every caller. Permissioned integrations must check
caller permissions before passing a transaction to the engine rather than trusting provenance in
the transaction body.
