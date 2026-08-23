//! MCP access policy, visibility filtering, and mutation authorization.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use inkfinite_core::proto::{Operation, QueryRecord, RecordId};
use inkfinite_core::{DocumentSnapshot, ShapeId, ShapeParent, SiblingAnchor};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Environment variable containing a JSON-encoded MCP policy.
pub const POLICY_ENV: &str = "INKFINITE_MCP_POLICY";

/// Permissions granted to one MCP document source.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize)]
pub struct McpPermissions {
    /// Whether metadata and records may be inspected or queried.
    #[serde(default = "default_read")]
    pub read: bool,
    /// Whether new pages, layers, shapes, relationships, or assets may be proposed or applied.
    #[serde(default)]
    pub create: bool,
    /// Whether existing records may be changed or moved.
    #[serde(default)]
    pub modify: bool,
    /// Whether records may be removed.
    #[serde(default)]
    pub delete: bool,
    /// Whether shared layout operations may be proposed or applied.
    #[serde(default)]
    pub layout: bool,
    /// Whether transactions may be submitted for desktop review.
    #[serde(default)]
    pub propose: bool,
}

impl Default for McpPermissions {
    fn default() -> Self {
        Self { read: true, create: false, modify: false, delete: false, layout: false, propose: false }
    }
}

impl McpPermissions {
    /// Returns a read-only permission set.
    #[must_use]
    pub const fn read_only() -> Self {
        Self { read: true, create: false, modify: false, delete: false, layout: false, propose: false }
    }

    /// Returns a permission set with every MCP scope enabled.
    #[must_use]
    pub const fn all() -> Self {
        Self { read: true, create: true, modify: true, delete: true, layout: true, propose: true }
    }
}

/// Controls whether records in invisible document layers are exposed to MCP.
#[derive(Clone, Copy, Debug, Default, Eq, JsonSchema, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HiddenLayerPolicy {
    /// Omit hidden layers and their descendants from reads and mutations.
    #[default]
    Deny,
    /// Expose hidden layers to this MCP source.
    Allow,
}

/// Permissions and visibility rules for one document source.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize)]
pub struct McpDocumentPolicy {
    /// Permission scopes for this source.
    #[serde(default)]
    pub permissions: McpPermissions,
    /// Whether records in invisible layers can be read or changed.
    #[serde(default)]
    pub hidden_layers: HiddenLayerPolicy,
    /// Whether existing shapes must opt in through `agent_editable`.
    #[serde(default = "default_require_agent_editable")]
    pub require_agent_editable: bool,
}

impl Default for McpDocumentPolicy {
    fn default() -> Self {
        Self {
            permissions: McpPermissions::default(),
            hidden_layers: HiddenLayerPolicy::default(),
            require_agent_editable: true,
        }
    }
}

impl McpDocumentPolicy {
    /// Returns an unrestricted policy for a trusted local source.
    #[must_use]
    pub const fn all() -> Self {
        Self {
            permissions: McpPermissions::all(),
            hidden_layers: HiddenLayerPolicy::Allow,
            require_agent_editable: true,
        }
    }
}

/// Default and source-specific MCP access rules.
#[derive(Clone, Debug, Default, Eq, JsonSchema, PartialEq, Serialize, Deserialize)]
pub struct McpPolicy {
    /// Policy used when no source-specific rule matches.
    #[serde(default)]
    pub default: McpDocumentPolicy,
    /// Rules keyed by canonical document path.
    #[serde(default)]
    pub documents: BTreeMap<String, McpDocumentPolicy>,
    /// Rules keyed by desktop session identifier.
    #[serde(default)]
    pub sessions: BTreeMap<String, McpDocumentPolicy>,
}

impl McpPolicy {
    /// Returns a policy with every scope enabled by default.
    #[must_use]
    pub fn all() -> Self {
        Self { default: McpDocumentPolicy::all(), documents: BTreeMap::new(), sessions: BTreeMap::new() }
    }

    /// Normalizes document rule keys so relative policy paths match the file allowlist.
    #[must_use]
    pub fn normalize_document_paths(mut self) -> Self {
        self.documents = self
            .documents
            .into_iter()
            .map(|(path, policy)| (normalize_path(Path::new(&path)), policy))
            .collect();
        self
    }

    /// Returns the rule for a desktop session.
    #[must_use]
    pub fn for_session(&self, session_id: &str) -> McpDocumentPolicy {
        self.sessions
            .get(session_id)
            .cloned()
            .unwrap_or_else(|| self.default.clone())
    }

    /// Returns the rule for a configured document path.
    #[must_use]
    pub fn for_document(&self, path: &Path) -> McpDocumentPolicy {
        self.documents
            .get(&normalize_path(path))
            .cloned()
            .unwrap_or_else(|| self.default.clone())
    }

    /// Parses the optional policy environment variable, defaulting to read-only access.
    #[must_use]
    pub fn from_environment() -> Self {
        std::env::var(POLICY_ENV)
            .ok()
            .and_then(|value| serde_json::from_str::<Self>(&value).ok())
            .unwrap_or_default()
            .normalize_document_paths()
    }
}

/// Permission category required by one core operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MutationPermission {
    /// Permission to create records.
    Create,
    /// Permission to change existing records.
    Modify,
    /// Permission to remove records.
    Delete,
    /// Permission to rearrange geometry through a layout operation.
    Layout,
}

impl MutationPermission {
    /// Returns the public scope name used in authorization errors.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Modify => "modify",
            Self::Delete => "delete",
            Self::Layout => "layout",
        }
    }

    fn enabled(self, permissions: &McpPermissions) -> bool {
        match self {
            Self::Create => permissions.create,
            Self::Modify => permissions.modify,
            Self::Delete => permissions.delete,
            Self::Layout => permissions.layout,
        }
    }
}

/// Details for an MCP policy rejection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyViolation {
    /// Permission scope that was missing.
    pub permission: &'static str,
    /// Core operation rejected by the policy.
    pub operation: &'static str,
    /// Record that caused a visibility or editability rejection, when known.
    pub record_id: Option<String>,
    /// Reason for the rejection.
    pub reason: &'static str,
}

/// Checks every operation against scopes, hidden-layer visibility, and shape opt-in.
pub fn authorize_operations(
    snapshot: &DocumentSnapshot, operations: &[Operation], policy: &McpDocumentPolicy,
) -> Result<(), PolicyViolation> {
    for operation in operations {
        let permission = operation_permission(operation);
        if !permission.enabled(&policy.permissions) {
            return Err(PolicyViolation {
                permission: permission.as_str(),
                operation: operation_name(operation),
                record_id: None,
                reason: "permission scope is not granted",
            });
        }
        let (shape_ids, layer_ids) = touched_records(snapshot, operation);
        if policy.hidden_layers == HiddenLayerPolicy::Deny {
            if let Some(record_id) = layer_ids.iter().find(|layer_id| {
                snapshot
                    .document
                    .layers
                    .get(*layer_id)
                    .is_some_and(|layer| !layer.visible)
            }) {
                return Err(PolicyViolation {
                    permission: "read",
                    operation: operation_name(operation),
                    record_id: Some(record_id.to_string()),
                    reason: "hidden layer is not exposed to this source",
                });
            }
            if let Some(record_id) = shape_ids.iter().find(|shape_id| !shape_visible(snapshot, shape_id)) {
                return Err(PolicyViolation {
                    permission: "read",
                    operation: operation_name(operation),
                    record_id: Some(record_id.to_string()),
                    reason: "shape is in a hidden layer that is not exposed to this source",
                });
            }
        }
        if policy.require_agent_editable
            && let Some(record_id) = shape_ids.iter().find(|shape_id| {
                snapshot
                    .document
                    .shapes
                    .get(*shape_id)
                    .is_some_and(|shape| !shape.metadata.agent_editable)
            })
        {
            return Err(PolicyViolation {
                permission: "modify",
                operation: operation_name(operation),
                record_id: Some(record_id.to_string()),
                reason: "shape does not opt in through agent_editable",
            });
        }
    }
    Ok(())
}

/// Returns whether a materialized record is exposed under a policy.
#[must_use]
pub fn record_visible(snapshot: &DocumentSnapshot, record_id: &RecordId, policy: HiddenLayerPolicy) -> bool {
    match record_id {
        RecordId::Page(_) | RecordId::Asset(_) => true,
        RecordId::Layer(layer_id) => snapshot
            .document
            .layers
            .get(layer_id)
            .is_some_and(|layer| policy == HiddenLayerPolicy::Allow || layer.visible),
        RecordId::Shape(shape_id) => policy == HiddenLayerPolicy::Allow || shape_visible(snapshot, shape_id),
        RecordId::Binding(binding_id) => snapshot.document.bindings.get(binding_id).is_some_and(|binding| {
            policy == HiddenLayerPolicy::Allow
                || (shape_visible(snapshot, &binding.source_shape_id)
                    && shape_visible(snapshot, &binding.target_shape_id))
        }),
    }
}

/// Removes hidden records from a core query result and applies its requested limit.
pub fn filter_query_result(
    mut result: inkfinite_core::proto::QueryResult, snapshot: &DocumentSnapshot, policy: HiddenLayerPolicy,
    limit: Option<u32>,
) -> inkfinite_core::proto::QueryResult {
    let visible_records = result
        .records
        .into_iter()
        .filter(|record_id| record_visible(snapshot, record_id, policy))
        .collect::<Vec<_>>();
    let visible_total = visible_records.len();
    let limit = limit
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(usize::MAX);
    let records = visible_records.into_iter().take(limit).collect::<Vec<_>>();
    result
        .bounds
        .retain(|shape_id, _| records.iter().any(|id| id == &RecordId::Shape(shape_id.clone())));
    result
        .details
        .retain(|detail| records.iter().any(|id| id == &query_record_id(detail)));
    result.total = visible_total;
    result.truncated = visible_total > records.len();
    result.records = records;
    result
}

fn query_record_id(record: &QueryRecord) -> RecordId {
    match record {
        QueryRecord::Page(page) => RecordId::Page(page.id.clone()),
        QueryRecord::Layer(layer) => RecordId::Layer(layer.id.clone()),
        QueryRecord::Shape(shape) => RecordId::Shape(shape.id.clone()),
        QueryRecord::Binding(binding) => RecordId::Binding(binding.id.clone()),
        QueryRecord::Asset(asset) => RecordId::Asset(asset.id.clone()),
    }
}

fn operation_permission(operation: &Operation) -> MutationPermission {
    match operation {
        Operation::CreatePage { .. }
        | Operation::CreateLayer { .. }
        | Operation::CreateShape { .. }
        | Operation::CreateBinding { .. }
        | Operation::CreateAsset { .. } => MutationPermission::Create,
        Operation::DeletePage { .. }
        | Operation::DeleteLayer { .. }
        | Operation::DeleteShape { .. }
        | Operation::DeleteBinding { .. }
        | Operation::DeleteAsset { .. } => MutationPermission::Delete,
        Operation::AlignShapes { .. }
        | Operation::DistributeShapes { .. }
        | Operation::StackShapes { .. }
        | Operation::GridShapes { .. }
        | Operation::TidyShapes { .. }
        | Operation::GraphLayout { .. } => MutationPermission::Layout,
        _ => MutationPermission::Modify,
    }
}

fn operation_name(operation: &Operation) -> &'static str {
    match operation {
        Operation::CreatePage { .. } => "create_page",
        Operation::RenamePage { .. } => "rename_page",
        Operation::DeletePage { .. } => "delete_page",
        Operation::CreateLayer { .. } => "create_layer",
        Operation::PatchLayer { .. } => "patch_layer",
        Operation::ReorderLayer { .. } => "reorder_layer",
        Operation::DeleteLayer { .. } => "delete_layer",
        Operation::CreateShape { .. } => "create_shape",
        Operation::PatchShape { .. } => "patch_shape",
        Operation::ReparentShape { .. } => "reparent_shape",
        Operation::ConvertShape { .. } => "convert_shape",
        Operation::DeleteShape { .. } => "delete_shape",
        Operation::CreateBinding { .. } => "create_binding",
        Operation::DeleteBinding { .. } => "delete_binding",
        Operation::CreateAsset { .. } => "create_asset",
        Operation::PatchAsset { .. } => "patch_asset",
        Operation::DeleteAsset { .. } => "delete_asset",
        Operation::AlignShapes { .. } => "align_shapes",
        Operation::DistributeShapes { .. } => "distribute_shapes",
        Operation::StackShapes { .. } => "stack_shapes",
        Operation::GridShapes { .. } => "grid_shapes",
        Operation::TidyShapes { .. } => "tidy_shapes",
        Operation::GraphLayout { .. } => "graph_layout",
    }
}

fn touched_records(
    snapshot: &DocumentSnapshot, operation: &Operation,
) -> (BTreeSet<ShapeId>, BTreeSet<inkfinite_core::LayerId>) {
    let mut shapes = BTreeSet::new();
    let mut layers = BTreeSet::new();
    match operation {
        Operation::CreateLayer { anchor, .. } => add_layer_anchor(anchor, &mut layers),
        Operation::PatchLayer { layer_id, .. } => {
            layers.insert(layer_id.clone());
        }
        Operation::ReorderLayer { layer_id, anchor, .. } => {
            layers.insert(layer_id.clone());
            add_layer_anchor(anchor, &mut layers);
        }
        Operation::DeleteLayer { layer_id, contents, .. } => {
            layers.insert(layer_id.clone());
            if let inkfinite_core::proto::LayerContentsDisposition::MoveTo(destination) = contents {
                layers.insert(destination.clone());
            }
            if let Some(layer) = snapshot.document.layers.get(layer_id) {
                layer
                    .shape_ids
                    .iter()
                    .for_each(|shape_id| add_existing_shape_tree(snapshot, shape_id, &mut shapes));
            }
        }
        Operation::CreateShape { shape, anchor } => {
            match &shape.parent {
                ShapeParent::Layer(layer_id) => {
                    layers.insert(layer_id.clone());
                }
                ShapeParent::Shape(parent_id) => add_existing_shape(snapshot, parent_id, &mut shapes),
            }
            add_shape_anchor(anchor, &mut shapes);
        }
        Operation::PatchShape { shape_id, .. }
        | Operation::ReparentShape { shape_id, .. }
        | Operation::ConvertShape { shape_id, .. }
        | Operation::DeleteShape { shape_id, .. } => {
            if matches!(operation, Operation::DeleteShape { .. }) {
                add_existing_shape_tree(snapshot, shape_id, &mut shapes);
            } else {
                add_existing_shape(snapshot, shape_id, &mut shapes);
            }
            if matches!(
                operation,
                Operation::ReparentShape { .. } | Operation::DeleteShape { .. }
            ) && let Some(shape) = snapshot.document.shapes.get(shape_id)
                && let ShapeParent::Shape(parent_id) = &shape.parent
            {
                shapes.insert(parent_id.clone());
            }
            if let Operation::ReparentShape { parent, anchor, .. } = operation {
                if let ShapeParent::Layer(layer_id) = parent {
                    layers.insert(layer_id.clone());
                } else if let ShapeParent::Shape(parent_id) = parent {
                    add_existing_shape(snapshot, parent_id, &mut shapes);
                }
                add_shape_anchor(anchor, &mut shapes);
            }
        }
        Operation::CreateBinding { binding } => {
            add_existing_shape(snapshot, &binding.source_shape_id, &mut shapes);
            add_existing_shape(snapshot, &binding.target_shape_id, &mut shapes);
        }
        Operation::DeleteBinding { binding_id, .. } => {
            if let Some(binding) = snapshot.document.bindings.get(binding_id) {
                add_existing_shape(snapshot, &binding.source_shape_id, &mut shapes);
                add_existing_shape(snapshot, &binding.target_shape_id, &mut shapes);
            }
        }
        Operation::DeletePage { page_id, .. } => {
            if let Some(page) = snapshot.document.pages.get(page_id) {
                for layer_id in &page.layer_ids {
                    layers.insert(layer_id.clone());
                    if let Some(layer) = snapshot.document.layers.get(layer_id) {
                        layer
                            .shape_ids
                            .iter()
                            .for_each(|shape_id| add_existing_shape_tree(snapshot, shape_id, &mut shapes));
                    }
                }
            }
        }
        Operation::AlignShapes { shape_ids, .. }
        | Operation::DistributeShapes { shape_ids, .. }
        | Operation::StackShapes { shape_ids, .. }
        | Operation::GridShapes { shape_ids, .. }
        | Operation::TidyShapes { shape_ids, .. }
        | Operation::GraphLayout { shape_ids, .. } => shape_ids
            .iter()
            .for_each(|shape_id| add_existing_shape(snapshot, shape_id, &mut shapes)),
        Operation::CreatePage { .. }
        | Operation::RenamePage { .. }
        | Operation::CreateAsset { .. }
        | Operation::PatchAsset { .. }
        | Operation::DeleteAsset { .. } => {}
    }
    (shapes, layers)
}

fn add_existing_shape(snapshot: &DocumentSnapshot, shape_id: &ShapeId, shapes: &mut BTreeSet<ShapeId>) {
    if snapshot.document.shapes.contains_key(shape_id) {
        shapes.insert(shape_id.clone());
    }
}

fn add_existing_shape_tree(snapshot: &DocumentSnapshot, shape_id: &ShapeId, shapes: &mut BTreeSet<ShapeId>) {
    if snapshot.document.shapes.contains_key(shape_id) {
        add_shape_tree(snapshot, shape_id, shapes);
    }
}

fn add_shape_tree(snapshot: &DocumentSnapshot, shape_id: &ShapeId, shapes: &mut BTreeSet<ShapeId>) {
    if !shapes.insert(shape_id.clone()) {
        return;
    }
    if let Some(shape) = snapshot.document.shapes.get(shape_id) {
        for child_id in &shape.child_ids {
            add_shape_tree(snapshot, child_id, shapes);
        }
    }
}

fn add_shape_anchor(anchor: &SiblingAnchor<ShapeId>, shapes: &mut BTreeSet<ShapeId>) {
    match anchor {
        SiblingAnchor::Before(shape_id) | SiblingAnchor::After(shape_id) => {
            shapes.insert(shape_id.clone());
        }
        SiblingAnchor::First | SiblingAnchor::Last => {}
    }
}

fn add_layer_anchor(anchor: &SiblingAnchor<inkfinite_core::LayerId>, layers: &mut BTreeSet<inkfinite_core::LayerId>) {
    match anchor {
        SiblingAnchor::Before(layer_id) | SiblingAnchor::After(layer_id) => {
            layers.insert(layer_id.clone());
        }
        SiblingAnchor::First | SiblingAnchor::Last => {}
    }
}

fn shape_visible(snapshot: &DocumentSnapshot, shape_id: &ShapeId) -> bool {
    let mut current = Some(shape_id);
    while let Some(id) = current {
        let Some(shape) = snapshot.document.shapes.get(id) else { return false };
        current = match &shape.parent {
            ShapeParent::Layer(layer_id) => {
                return snapshot
                    .document
                    .layers
                    .get(layer_id)
                    .is_some_and(|layer| layer.visible);
            }
            ShapeParent::Shape(parent_id) => Some(parent_id),
        };
    }
    false
}

fn default_read() -> bool {
    true
}

fn default_require_agent_editable() -> bool {
    true
}

fn normalize_path(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| {
            if path.is_absolute() {
                path.to_owned()
            } else {
                std::env::current_dir().map_or_else(|_| path.to_owned(), |directory| directory.join(path))
            }
        })
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use inkfinite_core::engine::TransactionEngine;
    use inkfinite_core::proto::ShapePatch;
    use inkfinite_core::{
        ActorId, DocumentId, Opacity, Origin, Provenance, RecordVersion, SemanticMetadata, ShapeKind, ShapeRecord,
        ShapeStyle, Timestamp, Transform, Vec2, blank_document,
    };
    use serde_json::json;
    use std::collections::BTreeMap;

    fn snapshot_with_shape(agent_editable: bool, visible: bool) -> DocumentSnapshot {
        let document_id = DocumentId::from("document:policy-test");
        let mut document = blank_document(&document_id, None);
        let page_id = document.page_ids[0].clone();
        let layer_id = document.pages[&page_id].layer_ids[0].clone();
        document.layers.get_mut(&layer_id).expect("layer").visible = visible;
        let shape_id = ShapeId::from("shape:policy-test");
        document
            .layers
            .get_mut(&layer_id)
            .expect("layer")
            .shape_ids
            .push(shape_id.clone());
        document.shapes.insert(
            shape_id.clone(),
            ShapeRecord {
                id: shape_id,
                kind: ShapeKind::from("rect"),
                parent: ShapeParent::Layer(layer_id),
                transform: Transform {
                    translation: Vec2 { x: 0.0, y: 0.0 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                child_ids: Vec::new(),
                layout: None,
                properties: BTreeMap::from([
                    (String::from("width"), json!(20.0)),
                    (String::from("height"), json!(20.0)),
                ]),
                metadata: SemanticMetadata {
                    name: None,
                    title: None,
                    role: None,
                    description: None,
                    body: None,
                    tags: Vec::new(),
                    source: None,
                    link: None,
                    custom_metadata: BTreeMap::new(),
                    locked: false,
                    agent_editable,
                    provenance: Provenance {
                        actor_id: ActorId::from("actor:policy-test"),
                        origin: Origin::Human,
                        timestamp: Timestamp(0),
                        source: None,
                    },
                },
                style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
                version: RecordVersion(1),
            },
        );
        let mut engine = TransactionEngine::create(document_id, ActorId::from("actor:policy-test"), document)
            .expect("policy fixture should be valid");
        engine.snapshot().expect("policy fixture should snapshot")
    }

    #[test]
    fn agent_editable_is_required_for_existing_shape_changes() {
        let snapshot = snapshot_with_shape(false, true);
        let shape_id = ShapeId::from("shape:policy-test");
        let operation =
            Operation::PatchShape { shape_id: shape_id.clone(), patch: ShapePatch::default(), expected_version: None };
        let violation = authorize_operations(&snapshot, &[operation], &McpDocumentPolicy::all())
            .expect_err("non-agent-editable shapes must be rejected");
        assert_eq!(violation.record_id, Some(shape_id.to_string()));
        assert_eq!(violation.reason, "shape does not opt in through agent_editable");
    }

    #[test]
    fn hidden_layers_are_excluded_from_policy_reads() {
        let snapshot = snapshot_with_shape(true, false);
        assert!(!record_visible(
            &snapshot,
            &RecordId::Shape(ShapeId::from("shape:policy-test")),
            HiddenLayerPolicy::Deny,
        ));
        assert!(record_visible(
            &snapshot,
            &RecordId::Shape(ShapeId::from("shape:policy-test")),
            HiddenLayerPolicy::Allow,
        ));
    }

    #[test]
    fn policy_json_defaults_to_read_only_scopes() {
        let policy: McpPolicy = serde_json::from_str("{}").expect("empty policy should decode");
        assert_eq!(policy.default.permissions, McpPermissions::read_only());
        assert!(policy.default.require_agent_editable);
    }
}
