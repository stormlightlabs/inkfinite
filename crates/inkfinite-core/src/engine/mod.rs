#![forbid(unsafe_code)]

//! Validated, atomic transaction engine for Inkfinite documents.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use crate::crdt::{AutomergeDocument, CrdtError, EncodedChange};
use crate::proto::{
    AffectedRegion, AssetPatch, Bounds, DocumentPatch, InverseMetadata, LayerContentsDisposition, LayerPatch,
    LayoutAxis, Operation, Query, QueryResult, RecordId, ShapeAlignment, ShapePatch, TransactionId, Warning,
};
use crate::{
    ActorId, AssetId, BindingId, ChangeHash, ContainerLayout, Document, DocumentId, LayerId, Origin, PageId,
    RecordVersion, ShapeId, ShapeParent, ShapeProperties, ShapeRecord, SiblingAnchor,
};
use thiserror::Error;

pub use crate::DocumentSnapshot;
pub use crate::crdt::CrdtDocument;
pub use crate::proto::{CommitResult, TransactionDraft};

mod diff;
mod error;
pub mod geometry;
mod hierarchy;
mod history;
mod operations;
mod policy;
mod query;
mod repair;
mod validation;

pub use error::EngineError;
pub use repair::repair_document;
pub use validation::validate_document;

use diff::{affected_regions, diff_documents};
use hierarchy::{canonical_heads, warning};
use history::{HistoryEntry, capture_expected_records, prepare_compensation, refresh_inverse_preconditions};
use operations::apply_operation;
use policy::{validate_permissions, validate_transaction_schema};
use query::query_document;

/// Validated transaction result that has not been committed to the CRDT.
#[derive(Clone, Debug, PartialEq)]
pub struct TransactionPreview {
    /// Materialized document after applying the transaction.
    pub document: Document,
    /// Records created, changed, or deleted by the transaction.
    pub patch: DocumentPatch,
    /// Records affected directly or through hierarchy repairs.
    pub affected_ids: Vec<RecordId>,
    /// Document-coordinate regions invalidated by the transaction.
    pub affected_regions: Vec<AffectedRegion>,
}

struct PreparedTransaction {
    document: Document,
    inverse: Vec<Operation>,
    patch: DocumentPatch,
    affected_ids: Vec<RecordId>,
    affected_regions: Vec<AffectedRegion>,
}

/// Rust-owned document state plus actor-scoped undo and redo metadata.
pub struct TransactionEngine {
    crdt: AutomergeDocument,
    undo: BTreeMap<ActorId, Vec<HistoryEntry>>,
    redo: BTreeMap<ActorId, Vec<HistoryEntry>>,
    history_sequence: u64,
}

impl TransactionEngine {
    /// Creates an engine around a validated normalized document.
    ///
    /// # Errors
    ///
    /// Returns an error when the initial document violates an invariant or
    /// cannot be encoded by the CRDT adapter.
    pub fn create(document_id: DocumentId, actor_id: ActorId, document: Document) -> Result<Self, EngineError> {
        validate_document(&document)?;
        Ok(Self {
            crdt: AutomergeDocument::create(document_id, actor_id, document)?,
            undo: BTreeMap::new(),
            redo: BTreeMap::new(),
            history_sequence: 0,
        })
    }

    /// Loads compact CRDT state and validates its materialized snapshot.
    ///
    /// # Errors
    ///
    /// Returns an error when the bytes or materialized document are invalid.
    pub fn load(bytes: &[u8], actor_id: ActorId) -> Result<Self, EngineError> {
        let mut crdt = AutomergeDocument::load(bytes, actor_id)?;
        validate_document(&crdt.snapshot()?.document)?;
        Ok(Self { crdt, undo: BTreeMap::new(), redo: BTreeMap::new(), history_sequence: 0 })
    }

    /// Returns the current materialized snapshot.
    ///
    /// # Errors
    ///
    /// Returns an error when the CRDT projection cannot be decoded.
    pub fn snapshot(&mut self) -> Result<DocumentSnapshot, EngineError> {
        Ok(self.crdt.snapshot()?)
    }

    /// Returns compact CRDT bytes suitable for the file boundary.
    ///
    /// # Errors
    ///
    /// Returns an error when Automerge cannot serialize the document.
    pub fn save(&mut self) -> Result<Vec<u8>, EngineError> {
        Ok(self.crdt.save()?)
    }

    /// Reports whether `actor_id` has a transaction that can be undone.
    #[must_use]
    pub fn can_undo(&self, actor_id: &ActorId) -> bool {
        self.undo.get(actor_id).is_some_and(|entries| !entries.is_empty())
    }

    /// Reports whether `actor_id` has a compensated transaction that can be
    /// redone.
    #[must_use]
    pub fn can_redo(&self, actor_id: &ActorId) -> bool {
        self.redo.get(actor_id).is_some_and(|entries| !entries.is_empty())
    }

    /// Applies one transaction atomically as one CRDT change.
    ///
    /// Validation and mutation run against a cloned candidate. Live state and
    /// history remain unchanged if any stage fails.
    ///
    /// # Errors
    ///
    /// Returns a typed rejection when schema, heads, preconditions,
    /// permissions, invariants, or CRDT persistence checks fail.
    pub fn commit(&mut self, transaction: TransactionDraft) -> Result<CommitResult, EngineError> {
        self.commit_internal(transaction, true)
    }

    /// Validates a transaction and returns its materialized geometry without
    /// changing the CRDT or either history stack.
    ///
    /// # Errors
    ///
    /// Returns the same schema, head, permission, precondition, and invariant
    /// failures as [`Self::commit`].
    pub fn preview(&mut self, transaction: &TransactionDraft) -> Result<TransactionPreview, EngineError> {
        let PreparedTransaction { document, patch, affected_ids, affected_regions, .. } =
            self.prepare_transaction(transaction)?;
        Ok(TransactionPreview { document, patch, affected_ids, affected_regions })
    }

    /// Compensates the latest eligible transaction from `actor_id`.
    ///
    /// Changes to unrelated fields remain intact. An intervening edit to the
    /// same field causes a precondition error.
    ///
    /// # Errors
    ///
    /// Returns [`EngineError::EmptyHistory`] when the actor has nothing to undo,
    /// or another typed rejection when the compensating transaction is stale.
    pub fn undo(&mut self, actor_id: &ActorId) -> Result<CommitResult, EngineError> {
        let entry = self
            .undo
            .get_mut(actor_id)
            .and_then(Vec::pop)
            .ok_or_else(|| EngineError::EmptyHistory { action: "undo", actor_id: actor_id.clone() })?;
        let operations = match self
            .crdt
            .snapshot()
            .map_err(EngineError::from)
            .and_then(|snapshot| prepare_compensation(&entry, &snapshot.document))
        {
            Ok(operations) => operations,
            Err(error) => {
                self.undo.entry(actor_id.clone()).or_default().push(entry);
                return Err(error);
            }
        };
        let transaction = self.history_transaction(actor_id, "undo", operations);
        match self.commit_internal(transaction, false) {
            Ok(result) => {
                self.redo.entry(actor_id.clone()).or_default().push(HistoryEntry {
                    operations: result.inverse.operations.clone(),
                    expected: capture_expected_records(&result.inverse.operations, &self.crdt.snapshot()?.document),
                });
                Ok(result)
            }
            Err(error) => {
                self.undo.entry(actor_id.clone()).or_default().push(entry);
                Err(error)
            }
        }
    }

    /// Reapplies the latest transaction compensated by `actor_id`.
    ///
    /// # Errors
    ///
    /// Returns [`EngineError::EmptyHistory`] when the actor has nothing to redo,
    /// or another typed rejection when the compensating transaction is stale.
    pub fn redo(&mut self, actor_id: &ActorId) -> Result<CommitResult, EngineError> {
        let entry = self
            .redo
            .get_mut(actor_id)
            .and_then(Vec::pop)
            .ok_or_else(|| EngineError::EmptyHistory { action: "redo", actor_id: actor_id.clone() })?;
        let operations = match self
            .crdt
            .snapshot()
            .map_err(EngineError::from)
            .and_then(|snapshot| prepare_compensation(&entry, &snapshot.document))
        {
            Ok(operations) => operations,
            Err(error) => {
                self.redo.entry(actor_id.clone()).or_default().push(entry);
                return Err(error);
            }
        };
        let transaction = self.history_transaction(actor_id, "redo", operations);
        match self.commit_internal(transaction, false) {
            Ok(result) => {
                self.undo.entry(actor_id.clone()).or_default().push(HistoryEntry {
                    operations: result.inverse.operations.clone(),
                    expected: capture_expected_records(&result.inverse.operations, &self.crdt.snapshot()?.document),
                });
                Ok(result)
            }
            Err(error) => {
                self.redo.entry(actor_id.clone()).or_default().push(entry);
                Err(error)
            }
        }
    }

    /// Merges remote changes on a fork, repairs deterministic merge damage, and
    /// adopts the candidate only after final validation.
    ///
    /// # Errors
    ///
    /// Returns an error when changes are malformed or the merged candidate
    /// cannot be repaired and validated.
    pub fn merge_changes(&mut self, changes: &[EncodedChange]) -> Result<Vec<Warning>, EngineError> {
        let mut candidate = self.crdt.clone();
        candidate.apply_changes(changes)?;
        let mut snapshot = candidate.snapshot()?;
        if validate_document(&snapshot.document).is_ok() {
            self.crdt = candidate;
            return Ok(Vec::new());
        }
        let original = snapshot.document.clone();
        let mut warnings = repair_document(&mut snapshot.document)?;
        validate_document(&snapshot.document)?;
        if snapshot.document != original {
            if warnings.is_empty() {
                warnings.push(warning(
                    "normalized_hierarchy",
                    "normalized hierarchy after merge".into(),
                    Vec::new(),
                ));
            }
            candidate.commit_document(&snapshot.document, "deterministic merge repair")?;
            validate_document(&candidate.snapshot()?.document)?;
        }
        self.crdt = candidate;
        Ok(warnings)
    }

    /// Returns changes after a caller's inspected heads.
    ///
    /// # Errors
    ///
    /// Returns an error when a supplied head is malformed or unknown.
    pub fn changes_since(&mut self, heads: &[ChangeHash]) -> Result<Vec<EncodedChange>, EngineError> {
        Ok(self.crdt.changes_since(heads)?)
    }

    /// Queries records deterministically against one materialized snapshot.
    ///
    /// # Errors
    ///
    /// Returns an error when the CRDT snapshot cannot be materialized.
    pub fn query(&mut self, query: &Query) -> Result<QueryResult, EngineError> {
        let snapshot = self.crdt.snapshot()?;
        Ok(query_document(&snapshot, query))
    }

    fn commit_internal(
        &mut self, transaction: TransactionDraft, track_history: bool,
    ) -> Result<CommitResult, EngineError> {
        let PreparedTransaction { document: candidate, inverse, patch, affected_ids, affected_regions } =
            self.prepare_transaction(&transaction)?;
        let mut fork = self.crdt.clone();
        fork.set_actor(&transaction.actor_id);
        let outcome = fork.commit_document(&candidate, &transaction.description)?;
        validate_document(&fork.snapshot()?.document)?;
        self.crdt = fork;

        let inverse_metadata = InverseMetadata { actor_id: transaction.actor_id.clone(), operations: inverse };
        if track_history {
            self.undo
                .entry(transaction.actor_id.clone())
                .or_default()
                .push(HistoryEntry {
                    operations: inverse_metadata.operations.clone(),
                    expected: capture_expected_records(&inverse_metadata.operations, &candidate),
                });
            self.redo.remove(&transaction.actor_id);
        }

        Ok(CommitResult {
            transaction_id: transaction.id,
            heads: outcome.heads,
            patch,
            affected_ids,
            affected_regions,
            inverse: inverse_metadata,
            warnings: Vec::new(),
        })
    }

    fn prepare_transaction(&mut self, transaction: &TransactionDraft) -> Result<PreparedTransaction, EngineError> {
        validate_transaction_schema(transaction)?;
        let current_heads = self.crdt.heads();
        if canonical_heads(&transaction.base_heads) != canonical_heads(&current_heads) {
            return Err(EngineError::StaleHeads);
        }

        let before = self.crdt.snapshot()?.document;
        let mut candidate = before.clone();
        let mut inverse = Vec::new();
        for operation in &transaction.operations {
            validate_permissions(&candidate, operation, &transaction.origin)?;
            let operation_inverse = apply_operation(&mut candidate, operation)?;
            inverse.splice(0..0, operation_inverse);
        }
        validate_document(&candidate)?;
        refresh_inverse_preconditions(&mut inverse, &candidate);

        let (patch, affected_ids) = diff_documents(&before, &candidate);
        if affected_ids.is_empty() {
            return Err(EngineError::Schema("transaction must produce a durable change".into()));
        }
        let affected_regions = affected_regions(&before, &candidate, &affected_ids);
        Ok(PreparedTransaction { document: candidate, inverse, patch, affected_ids, affected_regions })
    }

    fn history_transaction(
        &mut self, actor_id: &ActorId, action: &str, operations: Vec<Operation>,
    ) -> TransactionDraft {
        self.history_sequence += 1;
        TransactionDraft {
            id: TransactionId(format!(
                "history:{action}:{}:{}",
                actor_id.as_str(),
                self.history_sequence
            )),
            actor_id: actor_id.clone(),
            origin: Origin::System,
            base_heads: self.crdt.heads(),
            description: format!("{action} actor transaction"),
            operations,
            timestamp: crate::Timestamp(self.history_sequence.cast_signed()),
        }
    }
}

#[cfg(test)]
mod tests;
