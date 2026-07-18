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

/// Recoverable rejection from transaction, merge, validation, or query processing.
#[derive(Debug, Error)]
pub enum EngineError {
    /// The CRDT adapter could not complete an operation.
    #[error(transparent)]
    Crdt(#[from] CrdtError),
    /// The transaction's serialized contract is structurally invalid.
    #[error("schema validation failed: {0}")]
    Schema(String),
    /// The caller inspected different causal heads than the current document.
    #[error("stale document heads")]
    StaleHeads,
    /// A record-version or existence precondition failed.
    #[error("precondition failed: {0}")]
    Precondition(String),
    /// The actor is not allowed to perform the operation.
    #[error("permission denied: {0}")]
    Permission(String),
    /// Applying the operation would violate the document model.
    #[error("document invariant failed: {0}")]
    Invariant(String),
    /// No eligible actor-scoped history entry exists.
    #[error("no {action} history exists for actor {actor_id}")]
    EmptyHistory {
        /// Requested history action.
        action: &'static str,
        /// Actor whose history was inspected.
        actor_id: ActorId,
    },
}

#[derive(Clone)]
struct HistoryEntry {
    operations: Vec<Operation>,
    expected: ExpectedRecords,
}

#[derive(Clone, Default)]
struct ExpectedRecords {
    pages: BTreeMap<PageId, crate::PageRecord>,
    layers: BTreeMap<LayerId, crate::LayerRecord>,
    shapes: BTreeMap<ShapeId, ShapeRecord>,
    bindings: BTreeMap<BindingId, crate::BindingRecord>,
    assets: BTreeMap<AssetId, crate::AssetRecord>,
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
        validate_transaction_schema(&transaction)?;
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

fn validate_transaction_schema(transaction: &TransactionDraft) -> Result<(), EngineError> {
    if transaction.id.0.trim().is_empty() {
        return Err(EngineError::Schema("transaction ID is empty".into()));
    }
    if transaction.actor_id.as_str().trim().is_empty() {
        return Err(EngineError::Schema("actor ID is empty".into()));
    }
    if transaction.description.trim().is_empty() {
        return Err(EngineError::Schema("description is empty".into()));
    }
    if transaction.operations.is_empty() {
        return Err(EngineError::Schema("operations are empty".into()));
    }
    Ok(())
}

fn validate_permissions(document: &Document, operation: &Operation, origin: &Origin) -> Result<(), EngineError> {
    let mut shape_ids = operation_shape_ids(operation);
    match operation {
        Operation::DeletePage { page_id, .. } => {
            if let Some(page) = document.pages.get(page_id) {
                shape_ids.extend(
                    page.layer_ids
                        .iter()
                        .flat_map(|layer_id| descendant_ids_for_layer(document, layer_id)),
                );
            }
        }
        Operation::DeleteLayer { layer_id, .. } => {
            shape_ids.extend(descendant_ids_for_layer(document, layer_id));
        }
        Operation::DeleteShape { shape_id, .. } => {
            shape_ids.extend(descendant_ids_for_shape(document, shape_id));
        }
        _ => {}
    }
    shape_ids.sort();
    shape_ids.dedup();
    for shape_id in shape_ids {
        let Some(shape) = document.shapes.get(&shape_id) else {
            continue;
        };
        if shape.metadata.locked {
            return Err(EngineError::Permission(format!("shape {shape_id} is locked")));
        }
        if matches!(origin, Origin::Agent) && !shape.metadata.agent_editable {
            return Err(EngineError::Permission(format!(
                "shape {shape_id} is not agent-editable"
            )));
        }
        if let Some(layer) = containing_layer(document, shape)
            && layer.locked
        {
            return Err(EngineError::Permission(format!("layer {} is locked", layer.id)));
        }
    }
    if let Some(layer_id) = operation_layer_id(operation)
        && document.layers.get(&layer_id).is_some_and(|layer| layer.locked)
    {
        return Err(EngineError::Permission(format!("layer {layer_id} is locked")));
    }
    Ok(())
}

fn refresh_inverse_preconditions(operations: &mut [Operation], document: &Document) {
    for operation in operations {
        match operation {
            Operation::RenamePage { page_id, expected_version, .. }
            | Operation::DeletePage { page_id, expected_version } => {
                *expected_version = document.pages.get(page_id).map(|record| record.version);
            }
            Operation::PatchLayer { layer_id, expected_version, .. }
            | Operation::ReorderLayer { layer_id, expected_version, .. }
            | Operation::DeleteLayer { layer_id, expected_version, .. } => {
                *expected_version = document.layers.get(layer_id).map(|record| record.version);
            }
            Operation::PatchShape { shape_id, expected_version, .. }
            | Operation::ReparentShape { shape_id, expected_version, .. }
            | Operation::DeleteShape { shape_id, expected_version } => {
                *expected_version = document.shapes.get(shape_id).map(|record| record.version);
            }
            Operation::DeleteBinding { binding_id, expected_version } => {
                *expected_version = document.bindings.get(binding_id).map(|record| record.version);
            }
            Operation::PatchAsset { asset_id, expected_version, .. }
            | Operation::DeleteAsset { asset_id, expected_version } => {
                *expected_version = document.assets.get(asset_id).map(|record| record.version);
            }
            Operation::AlignShapes { shape_ids, expected_versions, .. }
            | Operation::DistributeShapes { shape_ids, expected_versions, .. } => {
                expected_versions.clear();
                expected_versions.extend(shape_ids.iter().filter_map(|shape_id| {
                    document
                        .shapes
                        .get(shape_id)
                        .map(|record| (shape_id.clone(), record.version))
                }));
            }
            Operation::CreatePage { .. }
            | Operation::CreateLayer { .. }
            | Operation::CreateShape { .. }
            | Operation::CreateBinding { .. }
            | Operation::CreateAsset { .. } => {}
        }
    }
}

fn capture_expected_records(operations: &[Operation], document: &Document) -> ExpectedRecords {
    let mut expected = ExpectedRecords::default();
    for operation in operations {
        match operation {
            Operation::RenamePage { page_id, .. } | Operation::DeletePage { page_id, .. } => {
                if let Some(record) = document.pages.get(page_id) {
                    expected.pages.insert(page_id.clone(), record.clone());
                }
            }
            Operation::PatchLayer { layer_id, .. }
            | Operation::ReorderLayer { layer_id, .. }
            | Operation::DeleteLayer { layer_id, .. } => {
                if let Some(record) = document.layers.get(layer_id) {
                    expected.layers.insert(layer_id.clone(), record.clone());
                }
            }
            Operation::PatchShape { shape_id, .. }
            | Operation::ReparentShape { shape_id, .. }
            | Operation::DeleteShape { shape_id, .. } => {
                if let Some(record) = document.shapes.get(shape_id) {
                    expected.shapes.insert(shape_id.clone(), record.clone());
                }
            }
            Operation::DeleteBinding { binding_id, .. } => {
                if let Some(record) = document.bindings.get(binding_id) {
                    expected.bindings.insert(binding_id.clone(), record.clone());
                }
            }
            Operation::PatchAsset { asset_id, .. } | Operation::DeleteAsset { asset_id, .. } => {
                if let Some(record) = document.assets.get(asset_id) {
                    expected.assets.insert(asset_id.clone(), record.clone());
                }
            }
            Operation::AlignShapes { shape_ids, .. } | Operation::DistributeShapes { shape_ids, .. } => {
                for shape_id in shape_ids {
                    if let Some(record) = document.shapes.get(shape_id) {
                        expected.shapes.insert(shape_id.clone(), record.clone());
                    }
                }
            }
            Operation::CreatePage { .. }
            | Operation::CreateLayer { .. }
            | Operation::CreateShape { .. }
            | Operation::CreateBinding { .. }
            | Operation::CreateAsset { .. } => {}
        }
    }
    expected
}

#[allow(clippy::too_many_lines)]
fn prepare_compensation(entry: &HistoryEntry, current: &Document) -> Result<Vec<Operation>, EngineError> {
    let mut operations = entry.operations.clone();
    for operation in &mut operations {
        match operation {
            Operation::RenamePage { page_id, name, expected_version } => {
                let expected = entry
                    .expected
                    .pages
                    .get(page_id)
                    .ok_or_else(|| history_conflict(format!("page {page_id} no longer has the expected state")))?;
                let current = current
                    .pages
                    .get(page_id)
                    .ok_or_else(|| history_conflict(format!("page {page_id} was removed concurrently")))?;
                *name = merge_history_value(name, &expected.name, &current.name, "page name")?;
                *expected_version = None;
            }
            Operation::PatchLayer { layer_id, patch, expected_version } => {
                let expected =
                    entry.expected.layers.get(layer_id).ok_or_else(|| {
                        history_conflict(format!("layer {layer_id} no longer has the expected state"))
                    })?;
                let current = current
                    .layers
                    .get(layer_id)
                    .ok_or_else(|| history_conflict(format!("layer {layer_id} was removed concurrently")))?;
                if let Some(before) = &patch.name {
                    patch.name = Some(merge_history_value(
                        before,
                        &expected.name,
                        &current.name,
                        "layer name",
                    )?);
                }
                if let Some(before) = patch.visible {
                    patch.visible = Some(merge_history_value(
                        &before,
                        &expected.visible,
                        &current.visible,
                        "layer visibility",
                    )?);
                }
                if let Some(before) = patch.locked {
                    patch.locked = Some(merge_history_value(
                        &before,
                        &expected.locked,
                        &current.locked,
                        "layer lock",
                    )?);
                }
                if let Some(before) = patch.opacity {
                    patch.opacity = Some(merge_history_value(
                        &before,
                        &expected.opacity,
                        &current.opacity,
                        "layer opacity",
                    )?);
                }
                *expected_version = None;
            }
            Operation::PatchShape { shape_id, patch, expected_version } => {
                let expected =
                    entry.expected.shapes.get(shape_id).ok_or_else(|| {
                        history_conflict(format!("shape {shape_id} no longer has the expected state"))
                    })?;
                let current = current
                    .shapes
                    .get(shape_id)
                    .ok_or_else(|| history_conflict(format!("shape {shape_id} was removed concurrently")))?;
                merge_shape_compensation(patch, expected, current)?;
                *expected_version = None;
            }
            Operation::ReparentShape { shape_id, parent, expected_version, .. } => {
                let expected =
                    entry.expected.shapes.get(shape_id).ok_or_else(|| {
                        history_conflict(format!("shape {shape_id} no longer has the expected state"))
                    })?;
                let current = current
                    .shapes
                    .get(shape_id)
                    .ok_or_else(|| history_conflict(format!("shape {shape_id} was removed concurrently")))?;
                *parent = merge_history_value(parent, &expected.parent, &current.parent, "shape parent")?;
                *expected_version = None;
            }
            Operation::PatchAsset { asset_id, patch, expected_version } => {
                let expected =
                    entry.expected.assets.get(asset_id).ok_or_else(|| {
                        history_conflict(format!("asset {asset_id} no longer has the expected state"))
                    })?;
                let current = current
                    .assets
                    .get(asset_id)
                    .ok_or_else(|| history_conflict(format!("asset {asset_id} was removed concurrently")))?;
                if let Some(before) = &patch.name {
                    patch.name = Some(merge_history_value(
                        before,
                        &expected.name,
                        &current.name,
                        "asset name",
                    )?);
                }
                if let Some(before) = &patch.provenance_source {
                    patch.provenance_source = Some(merge_history_value(
                        before,
                        &expected.provenance.source,
                        &current.provenance.source,
                        "asset provenance source",
                    )?);
                }
                *expected_version = None;
            }
            Operation::DeletePage { page_id, expected_version } => {
                guard_existing_record(
                    entry.expected.pages.get(page_id),
                    current.pages.get(page_id),
                    "page",
                    page_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteLayer { layer_id, expected_version, .. }
            | Operation::ReorderLayer { layer_id, expected_version, .. } => {
                guard_existing_record(
                    entry.expected.layers.get(layer_id),
                    current.layers.get(layer_id),
                    "layer",
                    layer_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteShape { shape_id, expected_version } => {
                guard_existing_record(
                    entry.expected.shapes.get(shape_id),
                    current.shapes.get(shape_id),
                    "shape",
                    shape_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteBinding { binding_id, expected_version } => {
                guard_existing_record(
                    entry.expected.bindings.get(binding_id),
                    current.bindings.get(binding_id),
                    "binding",
                    binding_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteAsset { asset_id, expected_version } => {
                guard_existing_record(
                    entry.expected.assets.get(asset_id),
                    current.assets.get(asset_id),
                    "asset",
                    asset_id,
                )?;
                *expected_version = None;
            }
            Operation::CreatePage { page, .. } => {
                guard_absent_record(&entry.expected.pages, &current.pages, &page.id, "page")?;
            }
            Operation::CreateLayer { layer, .. } => {
                guard_absent_record(&entry.expected.layers, &current.layers, &layer.id, "layer")?;
            }
            Operation::CreateShape { shape, .. } => {
                guard_absent_record(&entry.expected.shapes, &current.shapes, &shape.id, "shape")?;
            }
            Operation::CreateBinding { binding } => {
                guard_absent_record(&entry.expected.bindings, &current.bindings, &binding.id, "binding")?;
            }
            Operation::CreateAsset { asset } => {
                guard_absent_record(&entry.expected.assets, &current.assets, &asset.id, "asset")?;
            }
            Operation::AlignShapes { .. } | Operation::DistributeShapes { .. } => {
                return Err(history_conflict(
                    "history contains an unsupported aggregate layout operation",
                ));
            }
        }
    }
    Ok(operations)
}

#[allow(clippy::too_many_lines)]
fn merge_shape_compensation(
    patch: &mut ShapePatch, expected: &ShapeRecord, current: &ShapeRecord,
) -> Result<(), EngineError> {
    if let Some(before) = patch.transform {
        patch.transform = Some(crate::Transform {
            translation: crate::Vec2 {
                x: merge_history_value(
                    &before.translation.x,
                    &expected.transform.translation.x,
                    &current.transform.translation.x,
                    "shape translation x",
                )?,
                y: merge_history_value(
                    &before.translation.y,
                    &expected.transform.translation.y,
                    &current.transform.translation.y,
                    "shape translation y",
                )?,
            },
            rotation: merge_history_value(
                &before.rotation,
                &expected.transform.rotation,
                &current.transform.rotation,
                "shape rotation",
            )?,
            scale_x: merge_history_value(
                &before.scale_x,
                &expected.transform.scale_x,
                &current.transform.scale_x,
                "shape horizontal scale",
            )?,
            scale_y: merge_history_value(
                &before.scale_y,
                &expected.transform.scale_y,
                &current.transform.scale_y,
                "shape vertical scale",
            )?,
        });
    }
    if let Some(before) = &patch.properties {
        patch.properties = Some(merge_history_map(
            before,
            &expected.properties,
            &current.properties,
            "shape property",
        )?);
    }
    if let Some(before) = &patch.metadata {
        let mut merged = current.metadata.clone();
        merged.name = merge_history_value(
            &before.name,
            &expected.metadata.name,
            &current.metadata.name,
            "shape name",
        )?;
        merged.role = merge_history_value(
            &before.role,
            &expected.metadata.role,
            &current.metadata.role,
            "shape role",
        )?;
        merged.description = merge_history_value(
            &before.description,
            &expected.metadata.description,
            &current.metadata.description,
            "shape description",
        )?;
        merged.tags = merge_history_value(
            &before.tags,
            &expected.metadata.tags,
            &current.metadata.tags,
            "shape tags",
        )?;
        merged.locked = merge_history_value(
            &before.locked,
            &expected.metadata.locked,
            &current.metadata.locked,
            "shape lock",
        )?;
        merged.agent_editable = merge_history_value(
            &before.agent_editable,
            &expected.metadata.agent_editable,
            &current.metadata.agent_editable,
            "shape agent permission",
        )?;
        merged.provenance = merge_history_value(
            &before.provenance,
            &expected.metadata.provenance,
            &current.metadata.provenance,
            "shape provenance",
        )?;
        patch.metadata = Some(merged);
    }
    if let Some(before) = patch.style {
        patch.style = Some(crate::ShapeStyle {
            opacity: merge_history_value(
                &before.opacity,
                &expected.style.opacity,
                &current.style.opacity,
                "shape opacity",
            )?,
            fill_opacity: merge_history_value(
                &before.fill_opacity,
                &expected.style.fill_opacity,
                &current.style.fill_opacity,
                "shape fill opacity",
            )?,
            stroke_opacity: merge_history_value(
                &before.stroke_opacity,
                &expected.style.stroke_opacity,
                &current.style.stroke_opacity,
                "shape stroke opacity",
            )?,
        });
    }
    if let Some(before) = &patch.layout {
        patch.layout = Some(merge_history_value(
            before,
            &expected.layout,
            &current.layout,
            "shape layout",
        )?);
    }
    Ok(())
}

fn merge_history_map(
    before: &ShapeProperties, expected: &ShapeProperties, current: &ShapeProperties, label: &str,
) -> Result<ShapeProperties, EngineError> {
    let keys: BTreeSet<_> = before
        .keys()
        .chain(expected.keys())
        .chain(current.keys())
        .cloned()
        .collect();
    let mut merged = current.clone();
    for key in keys {
        if before.get(&key) == expected.get(&key) {
            continue;
        }
        if current.get(&key) != expected.get(&key) {
            return Err(history_conflict(format!("{label} {key} changed concurrently")));
        }
        if let Some(value) = before.get(&key) {
            merged.insert(key, value.clone());
        } else {
            merged.remove(&key);
        }
    }
    Ok(merged)
}

fn merge_history_value<T: Clone + PartialEq>(
    before: &T, expected: &T, current: &T, label: &str,
) -> Result<T, EngineError> {
    if before == expected {
        return Ok(current.clone());
    }
    if current == expected {
        return Ok(before.clone());
    }
    Err(history_conflict(format!("{label} changed concurrently")))
}

fn guard_existing_record<T: PartialEq, Id: std::fmt::Display>(
    expected: Option<&T>, current: Option<&T>, kind: &str, id: &Id,
) -> Result<(), EngineError> {
    if expected.is_some() && expected == current {
        Ok(())
    } else {
        Err(history_conflict(format!("{kind} {id} changed concurrently")))
    }
}

fn guard_absent_record<Id: Ord + std::fmt::Display, T>(
    expected: &BTreeMap<Id, T>, current: &BTreeMap<Id, T>, id: &Id, kind: &str,
) -> Result<(), EngineError> {
    if !expected.contains_key(id) && !current.contains_key(id) {
        Ok(())
    } else {
        Err(history_conflict(format!("{kind} {id} was recreated concurrently")))
    }
}

fn history_conflict(message: impl Into<String>) -> EngineError {
    EngineError::Precondition(format!("history conflict: {}", message.into()))
}

#[allow(clippy::too_many_lines)]
fn apply_operation(document: &mut Document, operation: &Operation) -> Result<Vec<Operation>, EngineError> {
    match operation {
        Operation::CreatePage { page, anchor } => {
            ensure_absent(document.pages.contains_key(&page.id), "page", &page.id)?;
            ensure_version_one(page.version, "new page")?;
            if !page.layer_ids.is_empty() {
                return Err(EngineError::Schema(
                    "new page layer_ids must be empty; create layers separately".into(),
                ));
            }
            insert_anchored(&mut document.page_ids, page.id.clone(), anchor)?;
            document.pages.insert(page.id.clone(), page.clone());
            Ok(vec![Operation::DeletePage {
                page_id: page.id.clone(),
                expected_version: Some(page.version),
            }])
        }
        Operation::RenamePage { page_id, name, expected_version } => {
            if name.trim().is_empty() {
                return Err(EngineError::Schema("page name is empty".into()));
            }
            let page = page_mut(document, page_id, *expected_version)?;
            let old = page.name.clone();
            page.name.clone_from(name);
            page.version = next_version(page.version)?;
            Ok(vec![Operation::RenamePage {
                page_id: page_id.clone(),
                name: old,
                expected_version: Some(page.version),
            }])
        }
        Operation::DeletePage { page_id, expected_version } => delete_page(document, page_id, *expected_version),
        Operation::CreateLayer { layer, anchor } => {
            ensure_absent(document.layers.contains_key(&layer.id), "layer", &layer.id)?;
            ensure_version_one(layer.version, "new layer")?;
            if !layer.shape_ids.is_empty() {
                return Err(EngineError::Schema(
                    "new layer shape_ids must be empty; create or reparent shapes separately".into(),
                ));
            }
            let page = page_mut(document, &layer.page_id, None)?;
            insert_anchored(&mut page.layer_ids, layer.id.clone(), anchor)?;
            page.version = next_version(page.version)?;
            document.layers.insert(layer.id.clone(), layer.clone());
            Ok(vec![Operation::DeleteLayer {
                layer_id: layer.id.clone(),
                contents: LayerContentsDisposition::Delete,
                expected_version: Some(layer.version),
            }])
        }
        Operation::PatchLayer { layer_id, patch, expected_version } => {
            patch_layer(document, layer_id, patch, *expected_version)
        }
        Operation::ReorderLayer { layer_id, anchor, expected_version } => {
            reorder_layer(document, layer_id, anchor, *expected_version)
        }
        Operation::DeleteLayer { layer_id, contents, expected_version } => {
            delete_layer(document, layer_id, contents, *expected_version)
        }
        Operation::CreateShape { shape, anchor } => {
            ensure_absent(document.shapes.contains_key(&shape.id), "shape", &shape.id)?;
            ensure_version_one(shape.version, "new shape")?;
            if !shape.child_ids.is_empty() {
                return Err(EngineError::Schema(
                    "new shape child_ids must be empty; create children separately".into(),
                ));
            }
            insert_shape_child(document, &shape.parent, shape.id.clone(), anchor)?;
            document.shapes.insert(shape.id.clone(), shape.clone());
            Ok(vec![Operation::DeleteShape {
                shape_id: shape.id.clone(),
                expected_version: Some(shape.version),
            }])
        }
        Operation::PatchShape { shape_id, patch, expected_version } => {
            patch_shape(document, shape_id, patch, *expected_version)
        }
        Operation::ReparentShape { shape_id, parent, anchor, expected_version } => {
            reparent_shape(document, shape_id, parent, anchor, *expected_version)
        }
        Operation::DeleteShape { shape_id, expected_version } => delete_shape(document, shape_id, *expected_version),
        Operation::CreateBinding { binding } => {
            ensure_absent(document.bindings.contains_key(&binding.id), "binding", &binding.id)?;
            ensure_version_one(binding.version, "new binding")?;
            ensure_binding_endpoints(document, binding)?;
            document.bindings.insert(binding.id.clone(), binding.clone());
            Ok(vec![Operation::DeleteBinding {
                binding_id: binding.id.clone(),
                expected_version: Some(binding.version),
            }])
        }
        Operation::DeleteBinding { binding_id, expected_version } => {
            let binding = crate::BindingRecord {
                version: RecordVersion(1),
                ..binding(document, binding_id, *expected_version)?.clone()
            };
            document.bindings.remove(binding_id);
            Ok(vec![Operation::CreateBinding { binding }])
        }
        Operation::CreateAsset { asset } => {
            ensure_absent(document.assets.contains_key(&asset.id), "asset", &asset.id)?;
            ensure_version_one(asset.version, "new asset")?;
            document.assets.insert(asset.id.clone(), asset.clone());
            Ok(vec![Operation::DeleteAsset {
                asset_id: asset.id.clone(),
                expected_version: Some(asset.version),
            }])
        }
        Operation::PatchAsset { asset_id, patch, expected_version } => {
            patch_asset(document, asset_id, patch, *expected_version)
        }
        Operation::DeleteAsset { asset_id, expected_version } => {
            let asset = crate::AssetRecord {
                version: RecordVersion(1),
                ..asset(document, asset_id, *expected_version)?.clone()
            };
            if asset_is_referenced(document, asset_id) {
                return Err(EngineError::Invariant(format!("asset {asset_id} is still referenced")));
            }
            document.assets.remove(asset_id);
            Ok(vec![Operation::CreateAsset { asset }])
        }
        Operation::AlignShapes { shape_ids, alignment, expected_versions } => {
            align_shapes(document, shape_ids, *alignment, expected_versions)
        }
        Operation::DistributeShapes { shape_ids, axis, expected_versions } => {
            distribute_shapes(document, shape_ids, *axis, expected_versions)
        }
    }
}

fn patch_layer(
    document: &mut Document, layer_id: &LayerId, patch: &LayerPatch, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let layer = layer_mut(document, layer_id, expected)?;
    let inverse = LayerPatch {
        name: patch.name.as_ref().map(|_| layer.name.clone()),
        visible: patch.visible.map(|_| layer.visible),
        locked: patch.locked.map(|_| layer.locked),
        opacity: patch.opacity.map(|_| layer.opacity),
    };
    if let Some(value) = &patch.name {
        if value.trim().is_empty() {
            return Err(EngineError::Schema("layer name is empty".into()));
        }
        layer.name.clone_from(value);
    }
    if let Some(value) = patch.visible {
        layer.visible = value;
    }
    if let Some(value) = patch.locked {
        layer.locked = value;
    }
    if let Some(value) = patch.opacity {
        layer.opacity = value;
    }
    layer.version = next_version(layer.version)?;
    Ok(vec![Operation::PatchLayer {
        layer_id: layer_id.clone(),
        patch: inverse,
        expected_version: Some(layer.version),
    }])
}

fn patch_shape(
    document: &mut Document, shape_id: &ShapeId, patch: &ShapePatch, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let shape = shape_mut(document, shape_id, expected)?;
    let inverse = ShapePatch {
        transform: patch.transform.map(|_| shape.transform),
        properties: patch.properties.as_ref().map(|_| shape.properties.clone()),
        metadata: patch.metadata.as_ref().map(|_| shape.metadata.clone()),
        style: patch.style.map(|_| shape.style),
        layout: patch.layout.as_ref().map(|_| shape.layout.clone()),
    };
    if let Some(value) = patch.transform {
        shape.transform = value;
    }
    if let Some(value) = &patch.properties {
        shape.properties.clone_from(value);
    }
    if let Some(value) = &patch.metadata {
        shape.metadata.clone_from(value);
    }
    if let Some(value) = patch.style {
        shape.style = value;
    }
    if let Some(value) = &patch.layout {
        shape.layout.clone_from(value);
    }
    shape.version = next_version(shape.version)?;
    Ok(vec![Operation::PatchShape {
        shape_id: shape_id.clone(),
        patch: inverse,
        expected_version: Some(shape.version),
    }])
}

fn patch_asset(
    document: &mut Document, asset_id: &AssetId, patch: &AssetPatch, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let asset = asset_mut(document, asset_id, expected)?;
    let inverse = AssetPatch {
        name: patch.name.as_ref().map(|_| asset.name.clone()),
        provenance_source: patch
            .provenance_source
            .as_ref()
            .map(|_| asset.provenance.source.clone()),
    };
    if let Some(value) = &patch.name {
        if value.trim().is_empty() {
            return Err(EngineError::Schema("asset name is empty".into()));
        }
        asset.name.clone_from(value);
    }
    if let Some(value) = &patch.provenance_source {
        asset.provenance.source.clone_from(value);
    }
    asset.version = next_version(asset.version)?;
    Ok(vec![Operation::PatchAsset {
        asset_id: asset_id.clone(),
        patch: inverse,
        expected_version: Some(asset.version),
    }])
}

fn reorder_layer(
    document: &mut Document, layer_id: &LayerId, anchor: &SiblingAnchor<LayerId>, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let layer = layer(document, layer_id, expected)?.clone();
    let page = document
        .pages
        .get_mut(&layer.page_id)
        .ok_or_else(|| EngineError::Invariant(format!("missing page {}", layer.page_id)))?;
    let old_anchor = anchor_for(&page.layer_ids, layer_id)?;
    move_anchored(&mut page.layer_ids, layer_id, anchor)?;
    page.version = next_version(page.version)?;
    let layer = document
        .layers
        .get_mut(layer_id)
        .ok_or_else(|| EngineError::Invariant(format!("layer {layer_id} disappeared during reorder")))?;
    layer.version = next_version(layer.version)?;
    Ok(vec![Operation::ReorderLayer {
        layer_id: layer_id.clone(),
        anchor: old_anchor,
        expected_version: Some(layer.version),
    }])
}

fn reparent_shape(
    document: &mut Document, shape_id: &ShapeId, parent: &ShapeParent, anchor: &SiblingAnchor<ShapeId>,
    expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let shape = shape(document, shape_id, expected)?.clone();
    if parent == &ShapeParent::Shape(shape_id.clone()) || is_descendant(document, shape_id, parent) {
        return Err(EngineError::Invariant(format!(
            "reparenting {shape_id} would create a cycle"
        )));
    }
    let old_siblings = shape_siblings(document, &shape.parent)?;
    let old_anchor = anchor_for(old_siblings, shape_id)?;
    remove_shape_child(document, &shape.parent, shape_id)?;
    insert_shape_child(document, parent, shape_id.clone(), anchor)?;
    let changed = document
        .shapes
        .get_mut(shape_id)
        .ok_or_else(|| EngineError::Invariant(format!("shape {shape_id} disappeared during reparent")))?;
    changed.parent = parent.clone();
    changed.version = next_version(changed.version)?;
    Ok(vec![Operation::ReparentShape {
        shape_id: shape_id.clone(),
        parent: shape.parent,
        anchor: old_anchor,
        expected_version: Some(changed.version),
    }])
}

fn delete_page(
    document: &mut Document, page_id: &PageId, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let page = page(document, page_id, expected)?.clone();
    let anchor = anchor_for(&document.page_ids, page_id)?;
    let layer_ids = page.layer_ids.clone();
    let shape_ids: BTreeSet<_> = layer_ids
        .iter()
        .flat_map(|layer_id| descendant_ids_for_layer(document, layer_id))
        .collect();
    let mut inverse = vec![Operation::CreatePage {
        page: crate::PageRecord { layer_ids: Vec::new(), version: RecordVersion(1), ..page.clone() },
        anchor,
    }];
    for layer_id in &layer_ids {
        let mut layer = document
            .layers
            .get(layer_id)
            .cloned()
            .ok_or_else(|| EngineError::Invariant(format!("page {page_id} owns missing layer {layer_id}")))?;
        layer.shape_ids.clear();
        layer.version = RecordVersion(1);
        inverse.push(Operation::CreateLayer { layer, anchor: SiblingAnchor::Last });
    }
    append_shape_restoration(document, &shape_ids, &mut inverse);
    append_binding_restoration(document, &shape_ids, &mut inverse);
    document.page_ids.retain(|id| id != page_id);
    for binding_id in bindings_touching(document, &shape_ids) {
        document.bindings.remove(&binding_id);
    }
    for shape_id in &shape_ids {
        document.shapes.remove(shape_id);
    }
    for layer_id in layer_ids {
        document.layers.remove(&layer_id);
    }
    document.pages.remove(page_id);
    Ok(inverse)
}

fn delete_layer(
    document: &mut Document, layer_id: &LayerId, contents: &LayerContentsDisposition, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let layer = layer(document, layer_id, expected)?.clone();
    let page = document
        .pages
        .get(&layer.page_id)
        .ok_or_else(|| EngineError::Invariant(format!("layer {layer_id} owns missing page {}", layer.page_id)))?;
    let anchor = anchor_for(&page.layer_ids, layer_id)?;
    let shape_ids: BTreeSet<_> = descendant_ids_for_layer(document, layer_id).collect();
    match contents {
        LayerContentsDisposition::MoveTo(destination) => {
            if destination == layer_id {
                return Err(EngineError::Precondition(
                    "layer contents destination is the deleted layer".into(),
                ));
            }
            let destination_layer = document
                .layers
                .get(destination)
                .ok_or_else(|| EngineError::Precondition(format!("destination layer {destination} is missing")))?;
            if destination_layer.page_id != layer.page_id {
                return Err(EngineError::Invariant(
                    "layer contents must stay on the same page".into(),
                ));
            }
            let root_ids = layer.shape_ids.clone();
            let mut inverse = vec![Operation::CreateLayer {
                layer: crate::LayerRecord { shape_ids: Vec::new(), version: RecordVersion(1), ..layer.clone() },
                anchor,
            }];
            for shape_id in &root_ids {
                inverse.push(Operation::ReparentShape {
                    shape_id: shape_id.clone(),
                    parent: ShapeParent::Layer(layer_id.clone()),
                    anchor: SiblingAnchor::Last,
                    expected_version: None,
                });
            }
            for shape_id in root_ids {
                insert_shape_child(
                    document,
                    &ShapeParent::Layer(destination.clone()),
                    shape_id.clone(),
                    &SiblingAnchor::Last,
                )?;
                let shape = document
                    .shapes
                    .get_mut(&shape_id)
                    .ok_or_else(|| EngineError::Invariant(format!("missing root shape {shape_id}")))?;
                shape.parent = ShapeParent::Layer(destination.clone());
                shape.version = next_version(shape.version)?;
            }
            remove_layer_record(document, &layer)?;
            Ok(inverse)
        }
        LayerContentsDisposition::Delete => {
            let mut inverse = vec![Operation::CreateLayer {
                layer: crate::LayerRecord { shape_ids: Vec::new(), version: RecordVersion(1), ..layer.clone() },
                anchor,
            }];
            append_shape_restoration(document, &shape_ids, &mut inverse);
            append_binding_restoration(document, &shape_ids, &mut inverse);
            for binding_id in bindings_touching(document, &shape_ids) {
                document.bindings.remove(&binding_id);
            }
            for shape_id in shape_ids {
                document.shapes.remove(&shape_id);
            }
            remove_layer_record(document, &layer)?;
            Ok(inverse)
        }
    }
}

fn remove_layer_record(document: &mut Document, layer: &crate::LayerRecord) -> Result<(), EngineError> {
    let page = document
        .pages
        .get_mut(&layer.page_id)
        .ok_or_else(|| EngineError::Invariant(format!("missing page {}", layer.page_id)))?;
    page.layer_ids.retain(|id| id != &layer.id);
    page.version = next_version(page.version)?;
    document.layers.remove(&layer.id);
    Ok(())
}

fn delete_shape(
    document: &mut Document, shape_id: &ShapeId, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let root = shape(document, shape_id, expected)?.clone();
    let shape_ids: BTreeSet<_> = std::iter::once(shape_id.clone())
        .chain(descendant_ids_for_shape(document, shape_id))
        .collect();
    let mut inverse = Vec::new();
    append_shape_restoration(document, &shape_ids, &mut inverse);
    append_binding_restoration(document, &shape_ids, &mut inverse);
    remove_shape_child(document, &root.parent, shape_id)?;
    for binding_id in bindings_touching(document, &shape_ids) {
        document.bindings.remove(&binding_id);
    }
    for id in shape_ids {
        document.shapes.remove(&id);
    }
    Ok(inverse)
}

fn append_shape_restoration(document: &Document, shape_ids: &BTreeSet<ShapeId>, operations: &mut Vec<Operation>) {
    let mut remaining = shape_ids.clone();
    while !remaining.is_empty() {
        let ready: Vec<_> = remaining
            .iter()
            .filter(|id| {
                document.shapes.get(*id).is_some_and(|shape| match &shape.parent {
                    ShapeParent::Layer(_) => true,
                    ShapeParent::Shape(parent_id) => !remaining.contains(parent_id),
                })
            })
            .cloned()
            .collect();
        if ready.is_empty() {
            break;
        }
        for id in ready {
            if let Some(shape) = document.shapes.get(&id) {
                let mut shape = shape.clone();
                shape.child_ids.clear();
                shape.version = RecordVersion(1);
                operations.push(Operation::CreateShape { shape, anchor: SiblingAnchor::Last });
            }
            remaining.remove(&id);
        }
    }
}

fn append_binding_restoration(document: &Document, shape_ids: &BTreeSet<ShapeId>, operations: &mut Vec<Operation>) {
    for binding in document.bindings.values() {
        if shape_ids.contains(&binding.source_shape_id) || shape_ids.contains(&binding.target_shape_id) {
            operations.push(Operation::CreateBinding {
                binding: crate::BindingRecord { version: RecordVersion(1), ..binding.clone() },
            });
        }
    }
}

fn align_shapes(
    document: &mut Document, shape_ids: &[ShapeId], alignment: ShapeAlignment,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    require_distinct_shapes(document, shape_ids, 2, expected_versions)?;
    require_common_parent(document, shape_ids)?;
    let bounds: Vec<_> = shape_ids
        .iter()
        .map(|id| {
            document
                .shapes
                .get(id)
                .map(local_shape_bounds)
                .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))
        })
        .collect::<Result<_, _>>()?;
    let target = match alignment {
        ShapeAlignment::Left => bounds.iter().map(|bounds| bounds.x).fold(f64::INFINITY, f64::min),
        ShapeAlignment::Center => bounds.iter().map(center_x).sum::<f64>() / count_as_f64(bounds.len())?,
        ShapeAlignment::Right => bounds.iter().map(right).fold(f64::NEG_INFINITY, f64::max),
        ShapeAlignment::Top => bounds.iter().map(|bounds| bounds.y).fold(f64::INFINITY, f64::min),
        ShapeAlignment::Middle => bounds.iter().map(center_y).sum::<f64>() / count_as_f64(bounds.len())?,
        ShapeAlignment::Bottom => bounds.iter().map(bottom).fold(f64::NEG_INFINITY, f64::max),
    };
    let deltas = shape_ids
        .iter()
        .zip(&bounds)
        .map(|(id, bounds)| {
            let delta = match alignment {
                ShapeAlignment::Left => (target - bounds.x, 0.0),
                ShapeAlignment::Center => (target - center_x(bounds), 0.0),
                ShapeAlignment::Right => (target - right(bounds), 0.0),
                ShapeAlignment::Top => (0.0, target - bounds.y),
                ShapeAlignment::Middle => (0.0, target - center_y(bounds)),
                ShapeAlignment::Bottom => (0.0, target - bottom(bounds)),
            };
            (id.clone(), delta)
        })
        .collect();
    apply_layout_translations(document, shape_ids, &deltas)
}

fn distribute_shapes(
    document: &mut Document, shape_ids: &[ShapeId], axis: LayoutAxis,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    require_distinct_shapes(document, shape_ids, 3, expected_versions)?;
    require_common_parent(document, shape_ids)?;
    let mut ordered: Vec<_> = shape_ids
        .iter()
        .map(|id| {
            document
                .shapes
                .get(id)
                .map(|shape| (id.clone(), local_shape_bounds(shape)))
                .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))
        })
        .collect::<Result<_, _>>()?;
    ordered.sort_by(|left, right| {
        let left_position = match axis {
            LayoutAxis::Horizontal => left.1.x,
            LayoutAxis::Vertical => left.1.y,
        };
        let right_position = match axis {
            LayoutAxis::Horizontal => right.1.x,
            LayoutAxis::Vertical => right.1.y,
        };
        left_position
            .total_cmp(&right_position)
            .then_with(|| left.0.cmp(&right.0))
    });
    let first = ordered
        .first()
        .ok_or_else(|| EngineError::Schema("distribution selection is empty".into()))?;
    let last = ordered
        .last()
        .ok_or_else(|| EngineError::Schema("distribution selection is empty".into()))?;
    let start = match axis {
        LayoutAxis::Horizontal => first.1.x,
        LayoutAxis::Vertical => first.1.y,
    };
    let end = match axis {
        LayoutAxis::Horizontal => right(&last.1),
        LayoutAxis::Vertical => bottom(&last.1),
    };
    let total_size: f64 = ordered
        .iter()
        .map(|(_, bounds)| match axis {
            LayoutAxis::Horizontal => bounds.width,
            LayoutAxis::Vertical => bounds.height,
        })
        .sum();
    let gap = (end - start - total_size) / count_as_f64(ordered.len() - 1)?;
    let mut cursor = start;
    let mut deltas = BTreeMap::new();
    for (id, bounds) in &ordered {
        let position = match axis {
            LayoutAxis::Horizontal => bounds.x,
            LayoutAxis::Vertical => bounds.y,
        };
        let delta = cursor - position;
        deltas.insert(
            id.clone(),
            match axis {
                LayoutAxis::Horizontal => (delta, 0.0),
                LayoutAxis::Vertical => (0.0, delta),
            },
        );
        cursor += match axis {
            LayoutAxis::Horizontal => bounds.width,
            LayoutAxis::Vertical => bounds.height,
        } + gap;
    }
    apply_layout_translations(document, shape_ids, &deltas)
}

fn apply_layout_translations(
    document: &mut Document, shape_ids: &[ShapeId], deltas: &BTreeMap<ShapeId, (f64, f64)>,
) -> Result<Vec<Operation>, EngineError> {
    let mut inverse = Vec::new();
    for shape_id in shape_ids {
        let shape = document
            .shapes
            .get_mut(shape_id)
            .ok_or_else(|| EngineError::Precondition(format!("shape {shape_id} is missing")))?;
        let old_transform = shape.transform;
        let (x, y) = deltas
            .get(shape_id)
            .copied()
            .ok_or_else(|| EngineError::Invariant(format!("shape {shape_id} has no layout delta")))?;
        shape.transform.translation.x += x;
        shape.transform.translation.y += y;
        shape.version = next_version(shape.version)?;
        inverse.push(Operation::PatchShape {
            shape_id: shape_id.clone(),
            patch: ShapePatch { transform: Some(old_transform), ..ShapePatch::default() },
            expected_version: Some(shape.version),
        });
    }
    Ok(inverse)
}

fn require_distinct_shapes(
    document: &Document, shape_ids: &[ShapeId], minimum: usize, expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<(), EngineError> {
    let unique: BTreeSet<_> = shape_ids.iter().collect();
    if unique.len() != shape_ids.len() || shape_ids.len() < minimum {
        return Err(EngineError::Schema(format!(
            "layout operation requires at least {minimum} distinct shapes"
        )));
    }
    for shape_id in shape_ids {
        shape(document, shape_id, expected_versions.get(shape_id).copied())?;
    }
    Ok(())
}

fn require_common_parent(document: &Document, shape_ids: &[ShapeId]) -> Result<(), EngineError> {
    let first = &document
        .shapes
        .get(
            shape_ids
                .first()
                .ok_or_else(|| EngineError::Schema("layout operation selection is empty".into()))?,
        )
        .ok_or_else(|| EngineError::Precondition("layout shape is missing".into()))?
        .parent;
    for id in shape_ids.iter().skip(1) {
        let shape = document
            .shapes
            .get(id)
            .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))?;
        if &shape.parent != first {
            return Err(EngineError::Invariant(
                "alignment and distribution require a common parent".into(),
            ));
        }
    }
    Ok(())
}

/// Validates normalized document ownership, references, geometry, and layout.
///
/// # Errors
///
/// Returns [`EngineError::Invariant`] or [`EngineError::Schema`] with the first
/// invalid ownership, reference, geometry, or layout condition.
pub fn validate_document(document: &Document) -> Result<(), EngineError> {
    if document.pages.is_empty() || document.page_ids.is_empty() {
        return Err(EngineError::Invariant("document must contain at least one page".into()));
    }
    ensure_unique_and_complete(&document.page_ids, document.pages.keys().cloned(), "page")?;
    let mut listed_layers = BTreeSet::new();
    for page in document.pages.values() {
        if page.name.trim().is_empty() || page.layer_ids.is_empty() {
            return Err(EngineError::Invariant(format!(
                "page {} needs a name and at least one layer",
                page.id
            )));
        }
        for layer_id in &page.layer_ids {
            if !listed_layers.insert(layer_id.clone()) {
                return Err(EngineError::Invariant(format!(
                    "layer {layer_id} is listed more than once"
                )));
            }
            let layer = document.layers.get(layer_id).ok_or_else(|| {
                EngineError::Invariant(format!("page {} refers to missing layer {layer_id}", page.id))
            })?;
            if layer.page_id != page.id {
                return Err(EngineError::Invariant(format!(
                    "layer {layer_id} has inconsistent page ownership"
                )));
            }
        }
    }
    if listed_layers.len() != document.layers.len() {
        return Err(EngineError::Invariant("one or more layers are unlisted".into()));
    }
    let mut listed_shapes = BTreeSet::new();
    for layer in document.layers.values() {
        if layer.name.trim().is_empty() {
            return Err(EngineError::Invariant(format!("layer {} has an empty name", layer.id)));
        }
        for shape_id in &layer.shape_ids {
            validate_child(
                document,
                &mut listed_shapes,
                shape_id,
                &ShapeParent::Layer(layer.id.clone()),
            )?;
        }
    }
    for shape in document.shapes.values() {
        validate_shape_schema(shape)?;
        for child_id in &shape.child_ids {
            validate_child(
                document,
                &mut listed_shapes,
                child_id,
                &ShapeParent::Shape(shape.id.clone()),
            )?;
        }
        ensure_acyclic(document, &shape.id)?;
    }
    if listed_shapes.len() != document.shapes.len() {
        return Err(EngineError::Invariant("one or more shapes are unlisted".into()));
    }
    for binding in document.bindings.values() {
        ensure_binding_endpoints(document, binding)?;
    }
    Ok(())
}

fn validate_shape_schema(shape: &ShapeRecord) -> Result<(), EngineError> {
    crate::validate_shape_properties(shape.kind.as_str(), &shape.properties)
        .map_err(|error| EngineError::Schema(format!("shape {}: {error}", shape.id)))?;
    if shape.kind.as_str() != crate::CONTAINER_KIND && (!shape.child_ids.is_empty() || shape.layout.is_some()) {
        return Err(EngineError::Schema(format!(
            "non-container shape {} owns children or layout",
            shape.id
        )));
    }
    let transform = shape.transform;
    if ![
        transform.translation.x,
        transform.translation.y,
        transform.rotation,
        transform.scale_x,
        transform.scale_y,
    ]
    .into_iter()
    .all(f64::is_finite)
        || transform.scale_x == 0.0
        || transform.scale_y == 0.0
    {
        return Err(EngineError::Schema(format!(
            "shape {} has an invalid transform",
            shape.id
        )));
    }
    if let Some(layout) = &shape.layout {
        match layout {
            ContainerLayout::Free => {}
            ContainerLayout::Stack { gap, padding, .. } => {
                validate_layout_numbers(shape, *gap, padding)?;
            }
            ContainerLayout::Grid { columns, column_gap, row_gap, padding, .. } => {
                if *columns == 0 {
                    return Err(EngineError::Schema(format!("shape {} grid has no columns", shape.id)));
                }
                validate_layout_numbers(shape, *column_gap, padding)?;
                if !row_gap.is_finite() || *row_gap < 0.0 {
                    return Err(EngineError::Schema(format!("shape {} has invalid row gap", shape.id)));
                }
            }
        }
    }
    Ok(())
}

fn validate_layout_numbers(shape: &ShapeRecord, gap: f64, padding: &crate::Insets) -> Result<(), EngineError> {
    if ![gap, padding.top, padding.right, padding.bottom, padding.left]
        .into_iter()
        .all(|value| value.is_finite() && value >= 0.0)
    {
        return Err(EngineError::Schema(format!(
            "shape {} has invalid layout spacing",
            shape.id
        )));
    }
    Ok(())
}

/// Repairs merge-created hierarchy damage using stable IDs and sorted order.
///
/// # Errors
///
/// Returns an error when the document has no page or when deterministic repair
/// cannot produce a valid normalized document.
#[allow(clippy::too_many_lines)]
pub fn repair_document(document: &mut Document) -> Result<Vec<Warning>, EngineError> {
    let original = document.clone();
    let mut warnings = Vec::new();
    if document.pages.is_empty() {
        return Err(EngineError::Invariant("cannot repair a document with no pages".into()));
    }
    document.page_ids.retain(|id| document.pages.contains_key(id));
    document.page_ids.sort();
    document.page_ids.dedup();
    for page_id in document.pages.keys() {
        if !document.page_ids.contains(page_id) {
            document.page_ids.push(page_id.clone());
        }
    }
    document.page_ids.sort();

    let page_ids: Vec<_> = document.page_ids.clone();
    for page_id in page_ids {
        let page = document
            .pages
            .get(&page_id)
            .ok_or_else(|| EngineError::Invariant(format!("page {page_id} disappeared")))?;
        let valid_layers: Vec<_> = page
            .layer_ids
            .iter()
            .filter(|layer_id| {
                document
                    .layers
                    .get(*layer_id)
                    .is_some_and(|layer| layer.page_id == page_id)
            })
            .cloned()
            .collect();
        let mut layers = valid_layers;
        layers.sort();
        layers.dedup();
        if layers.is_empty() {
            let layer_id = LayerId::new(format!("layer:recovered:{}", page_id.as_str()));
            document
                .layers
                .entry(layer_id.clone())
                .or_insert_with(|| crate::LayerRecord {
                    id: layer_id.clone(),
                    page_id: page_id.clone(),
                    name: "Recovered".into(),
                    shape_ids: Vec::new(),
                    visible: true,
                    locked: false,
                    opacity: crate::Opacity::OPAQUE,
                    version: RecordVersion(1),
                });
            layers.push(layer_id.clone());
            warnings.push(warning(
                "recovered_layer",
                format!("created {layer_id}"),
                vec![RecordId::Layer(layer_id)],
            ));
        }
        let page = document
            .pages
            .get_mut(&page_id)
            .ok_or_else(|| EngineError::Invariant(format!("page {page_id} disappeared")))?;
        page.layer_ids = layers;
    }
    let owned_layers: BTreeSet<_> = document
        .pages
        .values()
        .flat_map(|page| page.layer_ids.iter().cloned())
        .collect();
    document.layers.retain(|id, _| owned_layers.contains(id));
    let fallback = document
        .pages
        .values()
        .flat_map(|page| page.layer_ids.iter())
        .min()
        .cloned()
        .ok_or_else(|| EngineError::Invariant("repair produced no recovery layer".into()))?;

    let valid_shapes: BTreeSet<_> = document.shapes.keys().cloned().collect();
    for shape in document.shapes.values_mut() {
        let valid_parent = match &shape.parent {
            ShapeParent::Layer(id) => document.layers.contains_key(id),
            ShapeParent::Shape(id) => valid_shapes.contains(id) && id != &shape.id,
        };
        if !valid_parent {
            shape.parent = ShapeParent::Layer(fallback.clone());
            warnings.push(warning(
                "recovered_parent",
                format!("moved {} to {fallback}", shape.id),
                vec![RecordId::Shape(shape.id.clone())],
            ));
        }
        shape.child_ids.clear();
    }
    for layer in document.layers.values_mut() {
        layer.shape_ids.clear();
    }
    break_parent_cycles(document, &fallback, &mut warnings);
    let parents: Vec<_> = document
        .shapes
        .values()
        .map(|shape| (shape.id.clone(), shape.parent.clone()))
        .collect();
    for (shape_id, parent) in parents {
        match parent {
            ShapeParent::Layer(layer_id) => {
                let layer = document
                    .layers
                    .get_mut(&layer_id)
                    .ok_or_else(|| EngineError::Invariant(format!("repair lost parent layer {layer_id}")))?;
                layer.shape_ids.push(shape_id);
            }
            ShapeParent::Shape(parent_id) => {
                let shape = document
                    .shapes
                    .get_mut(&parent_id)
                    .ok_or_else(|| EngineError::Invariant(format!("repair lost parent shape {parent_id}")))?;
                shape.child_ids.push(shape_id);
            }
        }
    }
    for layer in document.layers.values_mut() {
        layer.shape_ids.sort();
        layer.shape_ids.dedup();
    }
    for shape in document.shapes.values_mut() {
        shape.child_ids.sort();
        shape.child_ids.dedup();
    }
    let before_bindings = document.bindings.len();
    document.bindings.retain(|_, binding| {
        valid_shapes.contains(&binding.source_shape_id) && valid_shapes.contains(&binding.target_shape_id)
    });
    if document.bindings.len() != before_bindings {
        warnings.push(warning(
            "removed_dangling_binding",
            "removed bindings with missing endpoints".into(),
            Vec::new(),
        ));
    }
    let changed_before_versions = document != &original;
    for (id, page) in &mut document.pages {
        if let Some(before) = original.pages.get(id)
            && page != before
        {
            page.version = next_version(before.version)?;
        }
    }
    for (id, layer) in &mut document.layers {
        if let Some(before) = original.layers.get(id)
            && layer != before
        {
            layer.version = next_version(before.version)?;
        }
    }
    for (id, shape) in &mut document.shapes {
        if let Some(before) = original.shapes.get(id)
            && shape != before
        {
            shape.version = next_version(before.version)?;
        }
    }
    if changed_before_versions && warnings.is_empty() {
        warnings.push(warning(
            "normalized_hierarchy",
            "normalized hierarchy after merge".into(),
            Vec::new(),
        ));
    }
    validate_document(document)?;
    Ok(warnings)
}

fn break_parent_cycles(document: &mut Document, fallback: &LayerId, warnings: &mut Vec<Warning>) {
    let shape_ids: Vec<_> = document.shapes.keys().cloned().collect();
    for start in shape_ids {
        let mut path = Vec::new();
        let mut current = start.clone();
        while let Some(shape) = document.shapes.get(&current) {
            if let Some(position) = path.iter().position(|id| id == &current) {
                let cycle = &path[position..];
                if let Some(chosen) = cycle.iter().max().cloned() {
                    if let Some(shape) = document.shapes.get_mut(&chosen) {
                        shape.parent = ShapeParent::Layer(fallback.clone());
                    }
                    warnings.push(warning(
                        "recovered_cycle",
                        format!("moved {chosen} to {fallback}"),
                        vec![RecordId::Shape(chosen)],
                    ));
                }
                break;
            }
            path.push(current.clone());
            match &shape.parent {
                ShapeParent::Shape(parent) => current = parent.clone(),
                ShapeParent::Layer(_) => break,
            }
        }
    }
}

#[allow(clippy::too_many_lines)]
fn query_document(snapshot: &DocumentSnapshot, query: &Query) -> QueryResult {
    let document = &snapshot.document;
    let mut records = Vec::new();
    let mut bounds = BTreeMap::new();
    for page in document.pages.values() {
        if matches_common(query, page.id.as_str(), Some(&page.name))
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.layer_id.is_none()
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Page(page.id.clone()));
        }
    }
    for layer in document.layers.values() {
        if matches_common(query, layer.id.as_str(), Some(&layer.name))
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.page_id.as_ref().is_none_or(|id| id == &layer.page_id)
            && query.layer_id.as_ref().is_none_or(|id| id == &layer.id)
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Layer(layer.id.clone()));
        }
    }
    for shape in document.shapes.values() {
        let shape_bounds = world_shape_bounds(document, &shape.id);
        let layer = containing_layer(document, shape).map(|layer| layer.id.clone());
        let page = layer
            .as_ref()
            .and_then(|id| document.layers.get(id))
            .map(|layer| layer.page_id.clone());
        let parent = match &shape.parent {
            ShapeParent::Layer(id) => id.as_str(),
            ShapeParent::Shape(id) => id.as_str(),
        };
        let matches = matches_common(query, shape.id.as_str(), shape.metadata.name.as_ref())
            && query
                .role
                .as_ref()
                .is_none_or(|role| shape.metadata.role.as_ref() == Some(role))
            && query.tag.as_ref().is_none_or(|tag| shape.metadata.tags.contains(tag))
            && query.shape_kind.as_ref().is_none_or(|kind| shape.kind.as_str() == kind)
            && query.page_id.as_ref().is_none_or(|id| page.as_ref() == Some(id))
            && query.layer_id.as_ref().is_none_or(|id| layer.as_ref() == Some(id))
            && query.parent_id.as_ref().is_none_or(|id| parent == id)
            && query
                .bounds
                .as_ref()
                .is_none_or(|filter| intersects(&shape_bounds, filter));
        if matches {
            records.push(RecordId::Shape(shape.id.clone()));
            bounds.insert(shape.id.clone(), shape_bounds);
        }
    }
    for binding in document.bindings.values() {
        if matches_common(query, binding.id.as_str(), None)
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.page_id.is_none()
            && query.layer_id.is_none()
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Binding(binding.id.clone()));
        }
    }
    for asset in document.assets.values() {
        if matches_common(query, asset.id.as_str(), Some(&asset.name))
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.page_id.is_none()
            && query.layer_id.is_none()
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Asset(asset.id.clone()));
        }
    }
    records.sort_by(record_id_order);
    QueryResult { heads: snapshot.heads.clone(), records, bounds }
}

fn matches_common(query: &Query, id: &str, name: Option<&String>) -> bool {
    query.id.as_ref().is_none_or(|expected| expected == id)
        && query
            .name
            .as_ref()
            .is_none_or(|expected| name.is_some_and(|name| name == expected))
}

fn record_id_order(left: &RecordId, right: &RecordId) -> Ordering {
    record_sort_key(left).cmp(&record_sort_key(right))
}

fn record_sort_key(record: &RecordId) -> (u8, &str) {
    match record {
        RecordId::Page(id) => (0, id.as_str()),
        RecordId::Layer(id) => (1, id.as_str()),
        RecordId::Shape(id) => (2, id.as_str()),
        RecordId::Binding(id) => (3, id.as_str()),
        RecordId::Asset(id) => (4, id.as_str()),
    }
}

fn diff_documents(before: &Document, after: &Document) -> (DocumentPatch, Vec<RecordId>) {
    let mut created = Vec::new();
    let mut changed = Vec::new();
    let mut deleted = Vec::new();
    diff_map(
        &before.pages,
        &after.pages,
        RecordId::Page,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.layers,
        &after.layers,
        RecordId::Layer,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.shapes,
        &after.shapes,
        RecordId::Shape,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.bindings,
        &after.bindings,
        RecordId::Binding,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.assets,
        &after.assets,
        RecordId::Asset,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    let mut affected = created
        .iter()
        .chain(&changed)
        .chain(&deleted)
        .cloned()
        .collect::<Vec<_>>();
    affected.sort_by(record_id_order);
    (DocumentPatch { created, changed, deleted }, affected)
}

fn diff_map<K, V, F>(
    before: &BTreeMap<K, V>, after: &BTreeMap<K, V>, wrap: F, created: &mut Vec<RecordId>, changed: &mut Vec<RecordId>,
    deleted: &mut Vec<RecordId>,
) where
    K: Ord + Clone,
    V: PartialEq,
    F: Fn(K) -> RecordId,
{
    for (id, value) in after {
        match before.get(id) {
            None => created.push(wrap(id.clone())),
            Some(old) if old != value => changed.push(wrap(id.clone())),
            Some(_) => {}
        }
    }
    for id in before.keys() {
        if !after.contains_key(id) {
            deleted.push(wrap(id.clone()));
        }
    }
}

fn affected_regions(before: &Document, after: &Document, ids: &[RecordId]) -> Vec<AffectedRegion> {
    let mut regions: BTreeMap<PageId, Bounds> = BTreeMap::new();
    for id in ids {
        let mut shape_ids = visual_shape_ids(before, id);
        shape_ids.extend(visual_shape_ids(after, id));
        for shape_id in shape_ids {
            for document in [before, after] {
                let Some(shape) = document.shapes.get(&shape_id) else {
                    continue;
                };
                let Some(page_id) = containing_layer(document, shape).map(|layer| layer.page_id.clone()) else {
                    continue;
                };
                let bounds = world_shape_bounds(document, &shape_id);
                regions
                    .entry(page_id)
                    .and_modify(|current| *current = union(*current, bounds))
                    .or_insert(bounds);
            }
        }
    }
    regions
        .into_iter()
        .map(|(page_id, bounds)| AffectedRegion { page_id, bounds })
        .collect()
}

fn visual_shape_ids(document: &Document, id: &RecordId) -> BTreeSet<ShapeId> {
    match id {
        RecordId::Shape(shape_id) => document
            .shapes
            .contains_key(shape_id)
            .then(|| shape_id.clone())
            .into_iter()
            .collect(),
        RecordId::Layer(layer_id) => descendant_ids_for_layer(document, layer_id).collect(),
        RecordId::Page(page_id) => document
            .pages
            .get(page_id)
            .into_iter()
            .flat_map(|page| &page.layer_ids)
            .flat_map(|layer_id| descendant_ids_for_layer(document, layer_id))
            .collect(),
        RecordId::Binding(binding_id) => document
            .bindings
            .get(binding_id)
            .into_iter()
            .flat_map(|binding| [binding.source_shape_id.clone(), binding.target_shape_id.clone()])
            .collect(),
        RecordId::Asset(_) => BTreeSet::new(),
    }
}

fn local_shape_bounds(shape: &ShapeRecord) -> Bounds {
    let width = numeric_property(shape, "width").unwrap_or(0.0).abs();
    let height = numeric_property(shape, "height").unwrap_or(0.0).abs();
    transformed_bounds(width, height, shape.transform)
}

fn world_shape_bounds(document: &Document, shape_id: &ShapeId) -> Bounds {
    let Some(shape) = document.shapes.get(shape_id) else {
        return Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
    };
    let mut bounds = local_shape_bounds(shape);
    let mut parent = shape.parent.clone();
    while let ShapeParent::Shape(parent_id) = parent {
        let Some(parent_shape) = document.shapes.get(&parent_id) else {
            break;
        };
        bounds.x += parent_shape.transform.translation.x;
        bounds.y += parent_shape.transform.translation.y;
        parent = parent_shape.parent.clone();
    }
    bounds
}

fn transformed_bounds(width: f64, height: f64, transform: crate::Transform) -> Bounds {
    let cos = transform.rotation.cos();
    let sin = transform.rotation.sin();
    let points = [(0.0, 0.0), (width, 0.0), (0.0, height), (width, height)].map(|(x, y)| {
        let x = x * transform.scale_x;
        let y = y * transform.scale_y;
        (
            transform.translation.x + x * cos - y * sin,
            transform.translation.y + x * sin + y * cos,
        )
    });
    let min_x = points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let max_x = points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let max_y = points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    Bounds { x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y }
}

fn numeric_property(shape: &ShapeRecord, name: &str) -> Option<f64> {
    shape
        .properties
        .get(name)
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
}
fn count_as_f64(count: usize) -> Result<f64, EngineError> {
    let count = u32::try_from(count).map_err(|_| EngineError::Invariant("layout selection is too large".into()))?;
    Ok(f64::from(count))
}
fn center_x(bounds: &Bounds) -> f64 {
    bounds.x + bounds.width / 2.0
}
fn center_y(bounds: &Bounds) -> f64 {
    bounds.y + bounds.height / 2.0
}
fn right(bounds: &Bounds) -> f64 {
    bounds.x + bounds.width
}
fn bottom(bounds: &Bounds) -> f64 {
    bounds.y + bounds.height
}
fn intersects(left: &Bounds, right_bounds: &Bounds) -> bool {
    left.x <= right(right_bounds)
        && right(left) >= right_bounds.x
        && left.y <= bottom(right_bounds)
        && bottom(left) >= right_bounds.y
}
fn union(left: Bounds, right_bounds: Bounds) -> Bounds {
    let x = left.x.min(right_bounds.x);
    let y = left.y.min(right_bounds.y);
    Bounds {
        x,
        y,
        width: right(&left).max(right(&right_bounds)) - x,
        height: bottom(&left).max(bottom(&right_bounds)) - y,
    }
}

fn ensure_unique_and_complete<'a, I>(listed: &[I::Item], keys: I, name: &str) -> Result<(), EngineError>
where
    I: Iterator,
    I::Item: Ord + Clone + std::fmt::Display + 'a,
{
    let listed_set: BTreeSet<_> = listed.iter().cloned().collect();
    if listed_set.len() != listed.len() {
        return Err(EngineError::Invariant(format!("duplicate {name} ordering entry")));
    }
    let keys_set: BTreeSet<_> = keys.collect();
    if listed_set != keys_set {
        return Err(EngineError::Invariant(format!(
            "{name} ordering does not match records"
        )));
    }
    Ok(())
}

fn validate_child(
    document: &Document, seen: &mut BTreeSet<ShapeId>, child_id: &ShapeId, expected_parent: &ShapeParent,
) -> Result<(), EngineError> {
    if !seen.insert(child_id.clone()) {
        return Err(EngineError::Invariant(format!(
            "shape {child_id} is listed more than once"
        )));
    }
    let child = document
        .shapes
        .get(child_id)
        .ok_or_else(|| EngineError::Invariant(format!("missing child shape {child_id}")))?;
    if &child.parent != expected_parent {
        return Err(EngineError::Invariant(format!(
            "shape {child_id} has inconsistent parent"
        )));
    }
    Ok(())
}

fn ensure_acyclic(document: &Document, start: &ShapeId) -> Result<(), EngineError> {
    let mut seen = BTreeSet::new();
    let mut current = start.clone();
    while let Some(shape) = document.shapes.get(&current) {
        if !seen.insert(current.clone()) {
            return Err(EngineError::Invariant(format!(
                "shape hierarchy contains a cycle at {current}"
            )));
        }
        match &shape.parent {
            ShapeParent::Shape(parent) => current = parent.clone(),
            ShapeParent::Layer(_) => return Ok(()),
        }
    }
    Ok(())
}

fn ensure_binding_endpoints(document: &Document, binding: &crate::BindingRecord) -> Result<(), EngineError> {
    if !document.shapes.contains_key(&binding.source_shape_id)
        || !document.shapes.contains_key(&binding.target_shape_id)
    {
        return Err(EngineError::Invariant(format!(
            "binding {} has a missing endpoint",
            binding.id
        )));
    }
    Ok(())
}

fn ensure_absent<Id: std::fmt::Display>(exists: bool, name: &str, id: &Id) -> Result<(), EngineError> {
    if exists { Err(EngineError::Precondition(format!("{name} {id} already exists"))) } else { Ok(()) }
}
fn ensure_version_one(version: RecordVersion, context: &str) -> Result<(), EngineError> {
    if version == RecordVersion(1) {
        Ok(())
    } else {
        Err(EngineError::Schema(format!("{context} must start at record version 1")))
    }
}
fn next_version(version: RecordVersion) -> Result<RecordVersion, EngineError> {
    version
        .0
        .checked_add(1)
        .map(RecordVersion)
        .ok_or_else(|| EngineError::Invariant("record version overflow".into()))
}
fn check_version(actual: RecordVersion, expected: Option<RecordVersion>, name: &str) -> Result<(), EngineError> {
    if expected.is_some_and(|value| value != actual) {
        Err(EngineError::Precondition(format!("{name} version is stale")))
    } else {
        Ok(())
    }
}

fn page<'a>(
    document: &'a Document, id: &PageId, expected: Option<RecordVersion>,
) -> Result<&'a crate::PageRecord, EngineError> {
    let value = document
        .pages
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("page {id} is missing")))?;
    check_version(value.version, expected, "page")?;
    Ok(value)
}
fn page_mut<'a>(
    document: &'a mut Document, id: &PageId, expected: Option<RecordVersion>,
) -> Result<&'a mut crate::PageRecord, EngineError> {
    let value = document
        .pages
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("page {id} is missing")))?;
    check_version(value.version, expected, "page")?;
    Ok(value)
}
fn layer<'a>(
    document: &'a Document, id: &LayerId, expected: Option<RecordVersion>,
) -> Result<&'a crate::LayerRecord, EngineError> {
    let value = document
        .layers
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("layer {id} is missing")))?;
    check_version(value.version, expected, "layer")?;
    Ok(value)
}
fn layer_mut<'a>(
    document: &'a mut Document, id: &LayerId, expected: Option<RecordVersion>,
) -> Result<&'a mut crate::LayerRecord, EngineError> {
    let value = document
        .layers
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("layer {id} is missing")))?;
    check_version(value.version, expected, "layer")?;
    Ok(value)
}
fn shape<'a>(
    document: &'a Document, id: &ShapeId, expected: Option<RecordVersion>,
) -> Result<&'a ShapeRecord, EngineError> {
    let value = document
        .shapes
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))?;
    check_version(value.version, expected, "shape")?;
    Ok(value)
}
fn shape_mut<'a>(
    document: &'a mut Document, id: &ShapeId, expected: Option<RecordVersion>,
) -> Result<&'a mut ShapeRecord, EngineError> {
    let value = document
        .shapes
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))?;
    check_version(value.version, expected, "shape")?;
    Ok(value)
}
fn binding<'a>(
    document: &'a Document, id: &BindingId, expected: Option<RecordVersion>,
) -> Result<&'a crate::BindingRecord, EngineError> {
    let value = document
        .bindings
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("binding {id} is missing")))?;
    check_version(value.version, expected, "binding")?;
    Ok(value)
}
fn asset<'a>(
    document: &'a Document, id: &AssetId, expected: Option<RecordVersion>,
) -> Result<&'a crate::AssetRecord, EngineError> {
    let value = document
        .assets
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("asset {id} is missing")))?;
    check_version(value.version, expected, "asset")?;
    Ok(value)
}
fn asset_mut<'a>(
    document: &'a mut Document, id: &AssetId, expected: Option<RecordVersion>,
) -> Result<&'a mut crate::AssetRecord, EngineError> {
    let value = document
        .assets
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("asset {id} is missing")))?;
    check_version(value.version, expected, "asset")?;
    Ok(value)
}

fn insert_anchored<Id: Clone + Eq + std::fmt::Display>(
    items: &mut Vec<Id>, id: Id, anchor: &SiblingAnchor<Id>,
) -> Result<(), EngineError> {
    if items.contains(&id) {
        return Err(EngineError::Precondition(format!("ordered item {id} already exists")));
    }
    let index = anchor_index(items, anchor)?;
    items.insert(index, id);
    Ok(())
}
fn move_anchored<Id: Clone + Eq + std::fmt::Display>(
    items: &mut Vec<Id>, id: &Id, anchor: &SiblingAnchor<Id>,
) -> Result<(), EngineError> {
    let position = items
        .iter()
        .position(|item| item == id)
        .ok_or_else(|| EngineError::Invariant(format!("ordered item {id} is missing")))?;
    let item = items.remove(position);
    let index = anchor_index(items, anchor)?;
    items.insert(index, item);
    Ok(())
}
fn anchor_index<Id: Eq + std::fmt::Display>(items: &[Id], anchor: &SiblingAnchor<Id>) -> Result<usize, EngineError> {
    match anchor {
        SiblingAnchor::First => Ok(0),
        SiblingAnchor::Last => Ok(items.len()),
        SiblingAnchor::Before(id) => items
            .iter()
            .position(|item| item == id)
            .ok_or_else(|| EngineError::Precondition(format!("anchor sibling {id} is missing"))),
        SiblingAnchor::After(id) => items
            .iter()
            .position(|item| item == id)
            .map(|index| index + 1)
            .ok_or_else(|| EngineError::Precondition(format!("anchor sibling {id} is missing"))),
    }
}
fn anchor_for<Id: Clone + Eq + std::fmt::Display>(items: &[Id], id: &Id) -> Result<SiblingAnchor<Id>, EngineError> {
    let index = items
        .iter()
        .position(|item| item == id)
        .ok_or_else(|| EngineError::Invariant(format!("ordered item {id} is missing")))?;
    Ok(if index == 0 { SiblingAnchor::First } else { SiblingAnchor::After(items[index - 1].clone()) })
}

fn shape_siblings<'a>(document: &'a Document, parent: &ShapeParent) -> Result<&'a Vec<ShapeId>, EngineError> {
    match parent {
        ShapeParent::Layer(id) => document
            .layers
            .get(id)
            .map(|layer| &layer.shape_ids)
            .ok_or_else(|| EngineError::Precondition(format!("parent layer {id} is missing"))),
        ShapeParent::Shape(id) => document
            .shapes
            .get(id)
            .map(|shape| &shape.child_ids)
            .ok_or_else(|| EngineError::Precondition(format!("parent shape {id} is missing"))),
    }
}
fn insert_shape_child(
    document: &mut Document, parent: &ShapeParent, id: ShapeId, anchor: &SiblingAnchor<ShapeId>,
) -> Result<(), EngineError> {
    match parent {
        ShapeParent::Layer(parent_id) => {
            let layer = document
                .layers
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Precondition(format!("parent layer {parent_id} is missing")))?;
            insert_anchored(&mut layer.shape_ids, id, anchor)?;
            layer.version = next_version(layer.version)?;
        }
        ShapeParent::Shape(parent_id) => {
            let shape = document
                .shapes
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Precondition(format!("parent shape {parent_id} is missing")))?;
            insert_anchored(&mut shape.child_ids, id, anchor)?;
            shape.version = next_version(shape.version)?;
        }
    }
    Ok(())
}
fn remove_shape_child(document: &mut Document, parent: &ShapeParent, id: &ShapeId) -> Result<(), EngineError> {
    match parent {
        ShapeParent::Layer(parent_id) => {
            let layer = document
                .layers
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Invariant(format!("parent layer {parent_id} is missing")))?;
            layer.shape_ids.retain(|child| child != id);
            layer.version = next_version(layer.version)?;
        }
        ShapeParent::Shape(parent_id) => {
            let shape = document
                .shapes
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Invariant(format!("parent shape {parent_id} is missing")))?;
            shape.child_ids.retain(|child| child != id);
            shape.version = next_version(shape.version)?;
        }
    }
    Ok(())
}

fn containing_layer<'a>(document: &'a Document, shape: &ShapeRecord) -> Option<&'a crate::LayerRecord> {
    let mut parent = shape.parent.clone();
    loop {
        match parent {
            ShapeParent::Layer(id) => return document.layers.get(&id),
            ShapeParent::Shape(id) => parent = document.shapes.get(&id)?.parent.clone(),
        }
    }
}
fn is_descendant(document: &Document, shape_id: &ShapeId, parent: &ShapeParent) -> bool {
    let ShapeParent::Shape(mut current) = parent.clone() else {
        return false;
    };
    loop {
        if &current == shape_id {
            return true;
        }
        let Some(shape) = document.shapes.get(&current) else {
            return false;
        };
        match &shape.parent {
            ShapeParent::Shape(next) => current = next.clone(),
            ShapeParent::Layer(_) => return false,
        }
    }
}
fn descendant_ids_for_layer<'a>(document: &'a Document, layer_id: &'a LayerId) -> impl Iterator<Item = ShapeId> + 'a {
    document
        .layers
        .get(layer_id)
        .into_iter()
        .flat_map(|layer| layer.shape_ids.iter())
        .flat_map(|id| std::iter::once(id.clone()).chain(descendant_ids_for_shape(document, id)))
}
fn descendant_ids_for_shape<'a>(
    document: &'a Document, shape_id: &'a ShapeId,
) -> Box<dyn Iterator<Item = ShapeId> + 'a> {
    Box::new(
        document
            .shapes
            .get(shape_id)
            .into_iter()
            .flat_map(|shape| shape.child_ids.iter())
            .flat_map(|id| std::iter::once(id.clone()).chain(descendant_ids_for_shape(document, id))),
    )
}
fn bindings_touching(document: &Document, shapes: &BTreeSet<ShapeId>) -> Vec<BindingId> {
    document
        .bindings
        .values()
        .filter(|binding| shapes.contains(&binding.source_shape_id) || shapes.contains(&binding.target_shape_id))
        .map(|binding| binding.id.clone())
        .collect()
}
fn asset_is_referenced(document: &Document, asset_id: &AssetId) -> bool {
    document.shapes.values().any(|shape| {
        shape
            .properties
            .values()
            .any(|value| value.as_str() == Some(asset_id.as_str()))
    })
}

fn operation_shape_ids(operation: &Operation) -> Vec<ShapeId> {
    match operation {
        Operation::PatchShape { shape_id, .. }
        | Operation::ReparentShape { shape_id, .. }
        | Operation::DeleteShape { shape_id, .. } => vec![shape_id.clone()],
        Operation::CreateBinding { binding } => vec![binding.source_shape_id.clone(), binding.target_shape_id.clone()],
        Operation::AlignShapes { shape_ids, .. } | Operation::DistributeShapes { shape_ids, .. } => shape_ids.clone(),
        _ => Vec::new(),
    }
}
fn operation_layer_id(operation: &Operation) -> Option<LayerId> {
    match operation {
        Operation::PatchLayer { layer_id, .. }
        | Operation::ReorderLayer { layer_id, .. }
        | Operation::DeleteLayer { layer_id, .. } => Some(layer_id.clone()),
        Operation::CreateShape { shape, .. } => match &shape.parent {
            ShapeParent::Layer(id) => Some(id.clone()),
            ShapeParent::Shape(_) => None,
        },
        Operation::ReparentShape { parent: ShapeParent::Layer(id), .. } => Some(id.clone()),
        _ => None,
    }
}
fn canonical_heads(heads: &[ChangeHash]) -> BTreeSet<ChangeHash> {
    heads.iter().cloned().collect()
}
fn warning(code: &str, message: String, record_ids: Vec<RecordId>) -> Warning {
    Warning { code: code.into(), message, record_ids }
}

#[cfg(test)]
mod tests;
