//! Serializable contracts shared by desktop commands, IPC, and the CLI.

use std::collections::BTreeMap;

use crate::graph_layout::GraphLayoutOptions;
use crate::{
    ActorId, AssetId, AssetRecord, BindingId, BindingRecord, ChangeHash, ContainerLayout, DocumentId, DocumentSnapshot,
    LayerId, LayerRecord, Opacity, Origin, PageId, PageRecord, RecordVersion, SemanticMetadata, ShapeId, ShapeParent,
    ShapeProperties, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Stable identifier for the Inkfinite protocol contract.
pub const PROTOCOL_ID: &str = "inkfinite.protocol";

/// Current transport-independent protocol version.
pub const PROTOCOL_VERSION: u32 = 9;

/// Stable identifier for a transaction.
#[derive(Clone, Debug, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(transparent)]
pub struct TransactionId(pub String);

/// Stable identifier for an open document session.
#[derive(Clone, Debug, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(transparent)]
pub struct SessionId(pub String);

/// Stable identifier for a transaction proposal awaiting user review.
#[derive(Clone, Debug, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(transparent)]
pub struct ProposalId(pub String);

/// Cross-platform serialized document path used at file-service boundaries.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(transparent)]
pub struct DocumentPath(pub String);

/// One durable edit submitted to the transaction engine.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct TransactionDraft {
    /// Stable transaction identifier.
    pub id: TransactionId,
    /// Actor responsible for the transaction.
    pub actor_id: ActorId,
    /// Path by which the transaction entered the engine.
    pub origin: Origin,
    /// Causal heads inspected by the caller.
    pub base_heads: Vec<ChangeHash>,
    /// Human-readable explanation retained in history.
    pub description: String,
    /// Ordered operations committed as one CRDT change.
    pub operations: Vec<Operation>,
    /// Client-recorded transaction time.
    pub timestamp: Timestamp,
}

/// Policy for children of a deleted non-empty layer.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "kind", content = "destination_layer_id")]
pub enum LayerContentsDisposition {
    /// Move root shapes to the specified layer while preserving their order.
    MoveTo(LayerId),
    /// Delete every descendant explicitly.
    Delete,
}

/// Mutable layer fields.
#[derive(Clone, Debug, Default, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct LayerPatch {
    /// Replacement display name.
    pub name: Option<String>,
    /// Replacement visibility.
    pub visible: Option<bool>,
    /// Replacement locked state.
    pub locked: Option<bool>,
    /// Replacement inherited opacity.
    pub opacity: Option<Opacity>,
}

/// Mutable shape fields. `Some(None)` clears an optional field.
#[derive(Clone, Debug, Default, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct ShapePatch {
    /// Replacement relative transform.
    pub transform: Option<Transform>,
    /// Replacement kind-specific properties.
    #[ts(type = "ShapeProperties | null")]
    pub properties: Option<ShapeProperties>,
    /// Replacement semantic metadata.
    pub metadata: Option<SemanticMetadata>,
    /// Replacement common style.
    pub style: Option<ShapeStyle>,
    /// Replacement or removal of container layout.
    pub layout: Option<Option<ContainerLayout>>,
}

/// Mutable asset fields.
#[derive(Clone, Debug, Default, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct AssetPatch {
    /// Replacement display name.
    pub name: Option<String>,
    /// Replacement attribution source label.
    pub provenance_source: Option<Option<String>>,
}

/// Axis used by alignment and distribution operations.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum LayoutAxis {
    /// Horizontal document axis.
    Horizontal,
    /// Vertical document axis.
    Vertical,
}

/// Edge or center line used to align a group of shapes.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ShapeAlignment {
    /// Align left bounds.
    Left,
    /// Align horizontal centers.
    Center,
    /// Align right bounds.
    Right,
    /// Align top bounds.
    Top,
    /// Align vertical centers.
    Middle,
    /// Align bottom bounds.
    Bottom,
}

/// Durable document operation. Ordered insertions use sibling anchors only.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Operation {
    /// Insert a page into the document's ordered page list.
    CreatePage {
        /// Complete new page record.
        page: PageRecord,
        /// Placement relative to an existing page.
        anchor: SiblingAnchor<PageId>,
    },
    /// Rename a page.
    RenamePage {
        /// Page to rename.
        page_id: PageId,
        /// Replacement name.
        name: String,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Delete a page and its owned records.
    DeletePage {
        /// Page to delete.
        page_id: PageId,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Insert a layer into a page's ordered layer list.
    CreateLayer {
        /// Complete new layer record.
        layer: LayerRecord,
        /// Placement relative to an existing layer.
        anchor: SiblingAnchor<LayerId>,
    },
    /// Change mutable layer fields.
    PatchLayer {
        /// Layer to change.
        layer_id: LayerId,
        /// Requested field replacements.
        patch: LayerPatch,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Move a layer within its page.
    ReorderLayer {
        /// Layer to move.
        layer_id: LayerId,
        /// New placement relative to a sibling layer.
        anchor: SiblingAnchor<LayerId>,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Delete a layer using an explicit child disposition.
    DeleteLayer {
        /// Layer to delete.
        layer_id: LayerId,
        /// Required handling for existing shapes.
        contents: LayerContentsDisposition,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Insert a shape into its parent's ordered child list.
    CreateShape {
        /// Complete new shape record.
        shape: ShapeRecord,
        /// Placement relative to an existing shape child.
        anchor: SiblingAnchor<ShapeId>,
    },
    /// Change mutable shape fields without moving it.
    PatchShape {
        /// Shape to change.
        shape_id: ShapeId,
        /// Requested field replacements.
        patch: ShapePatch,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Move a shape to another layer or container and place it by sibling anchor.
    ReparentShape {
        /// Shape to move.
        shape_id: ShapeId,
        /// Replacement parent.
        parent: ShapeParent,
        /// Placement relative to a child of the replacement parent.
        anchor: SiblingAnchor<ShapeId>,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Change a shape's registry kind and kind-specific properties.
    ///
    /// Transform, common style, semantic metadata, hierarchy, and stable ID
    /// remain attached to the existing shape record.
    ConvertShape {
        /// Shape to convert.
        shape_id: ShapeId,
        /// Replacement registry kind.
        kind: String,
        /// Replacement kind-specific properties.
        #[ts(type = "ShapeProperties")]
        properties: ShapeProperties,
        /// Optional replacement common style.
        style: Option<ShapeStyle>,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Delete a shape and its owned descendants.
    DeleteShape {
        /// Shape to delete.
        shape_id: ShapeId,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Create a relationship between two shapes.
    CreateBinding {
        /// Complete new binding record.
        binding: BindingRecord,
    },
    /// Delete a binding.
    DeleteBinding {
        /// Binding to delete.
        binding_id: BindingId,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Add an asset to the document.
    CreateAsset {
        /// Complete new asset record.
        asset: AssetRecord,
    },
    /// Change mutable asset metadata.
    PatchAsset {
        /// Asset to change.
        asset_id: AssetId,
        /// Requested field replacements.
        patch: AssetPatch,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Delete an asset that is no longer referenced.
    DeleteAsset {
        /// Asset to delete.
        asset_id: AssetId,
        /// Optional optimistic record version.
        expected_version: Option<RecordVersion>,
    },
    /// Align two or more shapes using their materialized bounds.
    AlignShapes {
        /// Shapes to align.
        shape_ids: Vec<ShapeId>,
        /// Alignment line shared by the shapes.
        alignment: ShapeAlignment,
        /// Optional optimistic versions keyed by shape ID.
        expected_versions: BTreeMap<ShapeId, RecordVersion>,
    },
    /// Distribute three or more shapes with equal gaps between their bounds.
    DistributeShapes {
        /// Shapes to distribute.
        shape_ids: Vec<ShapeId>,
        /// Axis on which to distribute the shapes.
        axis: LayoutAxis,
        /// Optional optimistic versions keyed by shape ID.
        expected_versions: BTreeMap<ShapeId, RecordVersion>,
    },
    /// Stack two or more shapes along one axis with a shared cross-axis center.
    StackShapes {
        /// Shapes to stack.
        shape_ids: Vec<ShapeId>,
        /// Axis on which to stack the shapes.
        axis: LayoutAxis,
        /// Space between adjacent shape bounds.
        gap: f64,
        /// Optional optimistic versions keyed by shape ID.
        expected_versions: BTreeMap<ShapeId, RecordVersion>,
    },
    /// Arrange two or more shapes in a deterministic row-major grid.
    GridShapes {
        /// Shapes to arrange.
        shape_ids: Vec<ShapeId>,
        /// Number of columns in the grid.
        columns: u32,
        /// Horizontal space between grid columns.
        column_gap: f64,
        /// Vertical space between grid rows.
        row_gap: f64,
        /// Optional optimistic versions keyed by shape ID.
        expected_versions: BTreeMap<ShapeId, RecordVersion>,
    },
    /// Tidy two or more shapes into a balanced row-major grid.
    TidyShapes {
        /// Shapes to tidy.
        shape_ids: Vec<ShapeId>,
        /// Space between grid cells.
        gap: f64,
        /// Optional optimistic versions keyed by shape ID.
        expected_versions: BTreeMap<ShapeId, RecordVersion>,
    },
    /// Arrange selected shapes from their structured connections.
    GraphLayout {
        /// Shapes to arrange.
        shape_ids: Vec<ShapeId>,
        /// Graph algorithm and spacing options.
        layout: GraphLayoutOptions,
        /// Optional optimistic versions keyed by shape ID.
        expected_versions: BTreeMap<ShapeId, RecordVersion>,
    },
}

/// Identifies a record touched by a commit or proposal.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "kind", content = "id")]
pub enum RecordId {
    /// Page record.
    Page(PageId),
    /// Layer record.
    Layer(LayerId),
    /// Shape record.
    Shape(ShapeId),
    /// Binding record.
    Binding(BindingId),
    /// Asset record.
    Asset(AssetId),
}

/// Complete materialized record returned by a detailed query.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "kind", content = "record")]
pub enum QueryRecord {
    /// Page record.
    Page(Box<PageRecord>),
    /// Layer record.
    Layer(Box<LayerRecord>),
    /// Shape record.
    Shape(Box<ShapeRecord>),
    /// Binding record.
    Binding(Box<BindingRecord>),
    /// Asset record.
    Asset(Box<AssetRecord>),
}

/// Materialized patch returned after a successful commit.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct DocumentPatch {
    /// Records created by the commit.
    pub created: Vec<RecordId>,
    /// Records changed by the commit.
    pub changed: Vec<RecordId>,
    /// Records deleted by the commit.
    pub deleted: Vec<RecordId>,
}

/// Axis-aligned bounds in document coordinates.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct Bounds {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Non-negative width.
    pub width: f64,
    /// Non-negative height.
    pub height: f64,
}

/// Camera state reported by or requested from the desktop editor.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct CameraState {
    /// World-space horizontal coordinate at the viewport center.
    pub x: f64,
    /// World-space vertical coordinate at the viewport center.
    pub y: f64,
    /// Screen pixels per world-space unit.
    pub zoom: f64,
}

/// Region that a renderer should consider dirty after a transaction.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct AffectedRegion {
    /// Page containing the changed visual content.
    pub page_id: PageId,
    /// Union of the record's bounds before and after the change.
    pub bounds: Bounds,
}

/// Operations needed to compensate a committed transaction.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct InverseMetadata {
    /// Actor whose history owns this inverse.
    pub actor_id: ActorId,
    /// Field-scoped compensating operations.
    pub operations: Vec<Operation>,
}

/// Non-fatal repair or normalization performed during a commit or merge.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct Warning {
    /// Stable machine-readable warning code.
    pub code: String,
    /// Human-readable warning detail.
    pub message: String,
    /// Related records, if known.
    pub record_ids: Vec<RecordId>,
}

/// Successful result from a durable transaction.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct CommitResult {
    /// Transaction that was committed.
    pub transaction_id: TransactionId,
    /// Causal heads after the commit.
    pub heads: Vec<ChangeHash>,
    /// Materialized mirror update.
    pub patch: DocumentPatch,
    /// All records affected directly or through repairs.
    pub affected_ids: Vec<RecordId>,
    /// Visual regions invalidated by the commit.
    pub affected_regions: Vec<AffectedRegion>,
    /// Metadata retained for actor-scoped undo.
    pub inverse: InverseMetadata,
    /// Non-fatal repairs and normalization notes.
    pub warnings: Vec<Warning>,
}

/// Optional semantic filters for a document query.
#[derive(Clone, Debug, Default, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct Query {
    /// Match one exact record ID, regardless of record kind.
    pub id: Option<String>,
    /// Match a page, layer, shape, or asset display name.
    pub name: Option<String>,
    /// Match one exact semantic role.
    pub role: Option<String>,
    /// Match one exact tag.
    pub tag: Option<String>,
    /// Match one exact semantic relationship type.
    pub relation_type: Option<String>,
    /// Restrict relationship records to those incoming to this shape.
    pub incoming_to: Option<ShapeId>,
    /// Restrict relationship records to those outgoing from this shape.
    pub outgoing_from: Option<ShapeId>,
    /// Match one exact shape registry key.
    pub shape_kind: Option<String>,
    /// Restrict the query to one page.
    pub page_id: Option<PageId>,
    /// Restrict the query to one layer.
    pub layer_id: Option<LayerId>,
    /// Restrict shapes to one direct parent.
    pub parent_id: Option<String>,
    /// Restrict shapes to those intersecting these document bounds.
    pub bounds: Option<Bounds>,
    /// Include complete matching records in the response.
    #[serde(default)]
    pub include_records: bool,
    /// Return at most this many matches after deterministic sorting.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Materialized query result suitable for machine clients.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct QueryResult {
    /// Causal heads inspected by the query.
    pub heads: Vec<ChangeHash>,
    /// Matching records in deterministic order.
    pub records: Vec<RecordId>,
    /// Bounds for matching shapes, in the same order as their shape records.
    pub bounds: BTreeMap<ShapeId, Bounds>,
    /// Complete records when the query requested them.
    #[serde(default)]
    pub details: Vec<QueryRecord>,
    /// Number of matches before applying the requested limit.
    #[serde(default)]
    pub total: usize,
    /// Whether the result omitted matches because of the requested limit.
    #[serde(default)]
    pub truncated: bool,
}

/// Result of saving an open document session.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct SaveResult {
    /// Path written by the file service.
    pub path: DocumentPath,
    /// Heads persisted by this save.
    pub heads: Vec<ChangeHash>,
}

/// Validated transaction held for explicit user review.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct Proposal {
    /// Stable proposal identifier.
    pub id: ProposalId,
    /// Transaction validated against the listed heads.
    pub transaction: TransactionDraft,
    /// Preview patch shown by the UI.
    pub preview: DocumentPatch,
    /// Document-coordinate regions affected by the proposed geometry.
    pub affected_regions: Vec<AffectedRegion>,
    /// Human-readable, independently selectable operation previews.
    pub operation_previews: Vec<ProposalOperationPreview>,
    /// Record-level before/after data used to render the proposal on the canvas.
    pub object_previews: Vec<ProposalObjectPreview>,
    /// Validation or repair warnings shown before acceptance.
    pub warnings: Vec<Warning>,
    /// Wall-clock expiry retained for clients and diagnostics.
    pub expires_at: Timestamp,
}

/// Visual classification for one record-level proposal change.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ProposalChangeKind {
    /// A record exists only after the proposal.
    Added,
    /// A record exists before and after with non-positional changes.
    Modified,
    /// A shape's transform or parent changes between snapshots.
    Moved,
    /// A record exists only before the proposal.
    Removed,
}

/// Before/after data for one record affected by a proposal.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct ProposalObjectPreview {
    /// Record identified by this preview.
    pub record_id: RecordId,
    /// Visual classification used by review clients.
    pub change: ProposalChangeKind,
    /// Complete record before the proposal, when it existed.
    pub before: Option<QueryRecord>,
    /// Complete record after the proposal, when it exists.
    pub after: Option<QueryRecord>,
    /// World-space shape bounds before the proposal, when applicable.
    pub before_bounds: Option<Bounds>,
    /// World-space shape bounds after the proposal, when applicable.
    pub after_bounds: Option<Bounds>,
    /// Transaction operation positions that directly name this record.
    pub operation_positions: Vec<u32>,
    /// Changed record fields, including nested metadata and relationship fields.
    pub changed_fields: Vec<String>,
}

/// Review metadata for one operation in a proposal.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct ProposalOperationPreview {
    /// Zero-based position used by partial acceptance.
    pub position: u32,
    /// Stable human-readable operation label.
    pub label: String,
    /// Records named directly by this operation.
    pub record_ids: Vec<RecordId>,
    /// Geometry attributable to this operation before or after the proposal.
    pub bounds: Vec<Bounds>,
}

/// Transport-independent request accepted by desktop commands, IPC, or CLI adapters.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Request {
    /// Create a new document session.
    CreateDocument {
        /// Stable identity for the new document.
        document_id: DocumentId,
        /// Actor that will own the session's local changes.
        actor_id: ActorId,
    },
    /// Open a canonical document in a new session.
    OpenDocument {
        /// File to open.
        path: DocumentPath,
        /// Actor that will own the session's local changes.
        actor_id: ActorId,
    },
    /// Fetch the current materialized snapshot.
    Snapshot {
        /// Open session to inspect.
        session_id: SessionId,
    },
    /// Commit a transaction to an open session.
    Commit {
        /// Open session to change.
        session_id: SessionId,
        /// Transaction to validate and apply.
        transaction: TransactionDraft,
    },
    /// Validate and hold a transaction for user review without changing the document.
    Propose {
        /// Open session against which to validate.
        session_id: SessionId,
        /// Transaction to preview.
        transaction: TransactionDraft,
    },
    /// Validate and apply a transaction to an open session.
    Apply {
        /// Open session to change.
        session_id: SessionId,
        /// Transaction to validate and apply.
        transaction: TransactionDraft,
    },
    /// Accept all or selected operations from a proposal and revalidate at current heads.
    AcceptProposal {
        /// Open session to change.
        session_id: SessionId,
        /// Proposal to accept.
        proposal_id: ProposalId,
        /// Zero-based operation positions to accept, or all operations when absent.
        operation_positions: Option<Vec<u32>>,
    },
    /// Reject a proposal without changing the document.
    RejectProposal {
        /// Open session that owns the proposal.
        session_id: SessionId,
        /// Proposal to discard.
        proposal_id: ProposalId,
    },
    /// Undo the latest eligible transaction for one actor.
    Undo {
        /// Open session to change.
        session_id: SessionId,
        /// Actor whose transaction should be compensated.
        actor_id: ActorId,
    },
    /// Persist the session to its current path.
    Save {
        /// Open session to persist.
        session_id: SessionId,
        /// Heads the caller expects to save.
        expected_heads: Vec<ChangeHash>,
    },
    /// Persist the session to a replacement path.
    SaveAs {
        /// Open session to persist.
        session_id: SessionId,
        /// Replacement path.
        path: DocumentPath,
        /// Heads the caller expects to save.
        expected_heads: Vec<ChangeHash>,
    },
    /// Query records by semantic metadata and containment.
    Query {
        /// Open session to inspect.
        session_id: SessionId,
        /// Filters to apply.
        query: Query,
    },
    /// Redo the latest eligible compensated transaction for one actor.
    Redo {
        /// Open session to change.
        session_id: SessionId,
        /// Actor whose transaction should be restored.
        actor_id: ActorId,
    },
    /// Validate the current session state without changing it.
    Validate {
        /// Open session to validate.
        session_id: SessionId,
    },
    /// Close an open session.
    Close {
        /// Session to close.
        session_id: SessionId,
    },
}

/// Successful transport-independent response.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type", content = "value")]
pub enum Response {
    /// A new session was opened.
    SessionOpened(SessionId),
    /// Current materialized document state.
    Snapshot(DocumentSnapshot),
    /// Transaction, undo, or redo result.
    Committed(CommitResult),
    /// A transaction was validated and held for user review.
    Proposed(Proposal),
    /// A proposal was rejected and removed.
    ProposalRejected,
    /// A document was persisted.
    Saved(SaveResult),
    /// Deterministic semantic query results.
    QueryResult(QueryResult),
    /// Validation completed without errors.
    Valid,
    /// A session was closed.
    Closed,
}

/// Stable protocol error returned across all adapters.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct ProtocolError {
    /// Stable machine-readable error code.
    pub code: String,
    /// Human-readable error detail.
    pub message: String,
    /// Optional structured context for machine clients.
    #[ts(type = "JsonValue | null")]
    pub details: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reorder_shape_contract_has_no_numeric_index() {
        let operation = Operation::ReparentShape {
            shape_id: ShapeId::from("shape:moved"),
            parent: ShapeParent::Layer(LayerId::from("layer:target")),
            anchor: SiblingAnchor::Before(ShapeId::from("shape:sibling")),
            expected_version: Some(RecordVersion(4)),
        };

        let json = serde_json::to_string(&operation).expect("operation should serialize");
        assert!(json.contains("sibling_id"));
        assert!(!json.contains("index"));
    }

    #[test]
    fn transaction_round_trips_without_transport_types() {
        let transaction = TransactionDraft {
            id: TransactionId("transaction:one".into()),
            actor_id: ActorId::from("actor:one"),
            origin: Origin::Agent,
            base_heads: vec![ChangeHash::from("head:one")],
            description: "Rename the architecture page".into(),
            operations: vec![Operation::RenamePage {
                page_id: PageId::from("page:one"),
                name: "Architecture".into(),
                expected_version: Some(RecordVersion(2)),
            }],
            timestamp: Timestamp(1_700_000_000_000),
        };

        let json = serde_json::to_string(&transaction).expect("transaction should serialize");
        let decoded: TransactionDraft = serde_json::from_str(&json).expect("transaction should deserialize");
        assert_eq!(decoded, transaction);
    }
}
