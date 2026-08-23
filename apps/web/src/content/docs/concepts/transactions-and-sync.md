---
title: Transactions and sync
description: 'How Inkfinite validates edits, records history, and merges peer changes.'
section: Concepts
group: Concepts
order: 14
---

Inkfinite groups related operations into transactions, validates them against the current document,
and records accepted changes in Automerge history.

## Transactions

A transaction has an ID, an actor, optional preconditions, and one or more operations. Operations
create, patch, move, or delete records. Grouping a coherent edit in one transaction keeps
validation, history, and review tied to the user's request.

Preconditions can require specific document heads or record versions. Inkfinite rejects the whole
transaction when those expectations are stale, when a selector is ambiguous, or when an operation
would cross a shape or layer lock. A rejected transaction does not partially modify the canonical
file. Permissioned integrations can apply caller policy before submitting a valid transaction.
`agent_editable` is not a document-engine lock.

## Undo and redo

The editor records transactions in its history. Undo applies the inverse of an accepted local edit.
Redo reapplies an edit that was undone. Because history belongs to the document model, both the web
and desktop editors use the same behavior.

An edit may become impossible to undo after later changes remove or replace the records it depended
on. Inkfinite reports the conflict instead of reconstructing an uncertain result.

## Proposal review

A desktop session can hold an agent transaction as a proposal against known document heads. The
review panel lists affected objects, metadata, and relationships, while the canvas previews added,
changed, moved, and removed content. Reviewers can accept all or part of a proposal or reject it.
Accepting and rejecting both clear the preview. Stale proposals must be refreshed against the
current document before acceptance.

## Synchronization

Automerge assigns document heads to the current causal state. Two peers can make changes from a
shared base and merge them without choosing one entire file over the other.

The CLI includes the heads returned by `inspect` and `query` as transaction preconditions. If a
human or another agent edits the document first, the stale transaction fails. Inspect the new
heads, query the affected records again, and rebuild the intended change from current state.

The current local file and desktop proposal workflows provide this concurrency model without
claiming a hosted synchronization service. A live desktop proposal can also become stale while it
waits for review. Review the refreshed preview before accepting it.
