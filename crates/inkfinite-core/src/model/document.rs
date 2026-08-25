//! Canonical records, documents, snapshots, and document constructors.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::geometry::{Opacity, Provenance, SemanticMetadata, ShapeStyle, Transform};
use super::ids::{
    AssetId, BindingId, BindingKind, ChangeHash, DocumentId, FormatId, LayerId, PageId, RecordVersion, ShapeId,
    ShapeKind,
};
use super::registry::{AssetSource, BindingAnchor, ContainerLayout, ShapeParent, ShapeProperties};

/// A shape record shared by all built-in shape definitions.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct ShapeRecord {
    /// Stable record identifier.
    pub id: ShapeId,
    /// Registry key. Built-in values are exposed as `*_KIND` constants.
    pub kind: ShapeKind,
    /// Parent relation; ordering comes only from the parent's child list.
    pub parent: ShapeParent,
    /// Transform relative to `parent`.
    pub transform: Transform,
    /// Ordered children when this shape is a container. This list is the
    /// frame presentation and export order.
    pub child_ids: Vec<ShapeId>,
    /// Optional automatic layout for container shapes.
    pub layout: Option<ContainerLayout>,
    /// Kind-specific serialized properties validated by the registry.
    #[ts(type = "ShapeProperties")]
    pub properties: ShapeProperties,
    /// Human- and agent-readable semantics and permissions.
    pub metadata: SemanticMetadata,
    /// Visual properties common to all kinds.
    pub style: ShapeStyle,
    /// Version used by optimistic operation preconditions.
    pub version: RecordVersion,
}

/// A page record and its ordered layer list.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct PageRecord {
    /// Stable record identifier.
    pub id: PageId,
    /// User-visible page name.
    pub name: String,
    /// Layer IDs in back-to-front draw order.
    pub layer_ids: Vec<LayerId>,
    /// Version used by optimistic operation preconditions.
    pub version: RecordVersion,
}

/// A layer record and its ordered root-shape list.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct LayerRecord {
    /// Stable record identifier.
    pub id: LayerId,
    /// Page that owns this layer.
    pub page_id: PageId,
    /// User-visible layer name.
    pub name: String,
    /// Root shape IDs in back-to-front draw order.
    pub shape_ids: Vec<ShapeId>,
    /// Whether descendants participate in rendering and hit testing.
    pub visible: bool,
    /// Whether descendants can be selected or changed.
    pub locked: bool,
    /// Opacity inherited by descendants.
    pub opacity: Opacity,
    /// Version used by optimistic operation preconditions.
    pub version: RecordVersion,
}

/// Relationship between two shapes.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct BindingRecord {
    /// Stable record identifier.
    pub id: BindingId,
    /// Registry key describing binding behavior.
    pub kind: BindingKind,
    /// Shape that owns the binding, such as an arrow.
    pub source_shape_id: ShapeId,
    /// Shape to which the source is bound.
    pub target_shape_id: ShapeId,
    /// Named source handle, such as `start` or `end`.
    pub source_handle: String,
    /// Attachment point on the target.
    pub anchor: BindingAnchor,
    /// Optional semantic relationship type, such as `depends_on`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation_type: Option<String>,
    /// Version used by optimistic operation preconditions.
    pub version: RecordVersion,
}

/// Image, font, or other binary asset.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct AssetRecord {
    /// Stable record identifier.
    pub id: AssetId,
    /// User-visible asset name.
    pub name: String,
    /// IANA media type.
    pub media_type: String,
    /// Content digest including its algorithm prefix.
    pub digest: String,
    /// Stored or linked content.
    pub source: AssetSource,
    /// Attribution for the asset.
    pub provenance: Provenance,
    /// Version used by optimistic operation preconditions.
    pub version: RecordVersion,
}

/// Normalized, materialized Inkfinite document.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct Document {
    /// Pages indexed by their stable IDs.
    pub pages: BTreeMap<PageId, PageRecord>,
    /// Pages in user-visible order.
    pub page_ids: Vec<PageId>,
    /// Layers indexed by their stable IDs.
    pub layers: BTreeMap<LayerId, LayerRecord>,
    /// Shapes indexed by their stable IDs.
    pub shapes: BTreeMap<ShapeId, ShapeRecord>,
    /// Bindings indexed by their stable IDs.
    pub bindings: BTreeMap<BindingId, BindingRecord>,
    /// Assets indexed by their stable IDs.
    pub assets: BTreeMap<AssetId, AssetRecord>,
}

/// Materialized document plus its format and causal identity.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct DocumentSnapshot {
    /// Stable format identifier.
    pub format: FormatId,
    /// Version of the document contract.
    pub format_version: u32,
    /// Stable document identifier.
    pub document_id: DocumentId,
    /// Causal CRDT heads represented by this snapshot.
    pub heads: Vec<ChangeHash>,
    /// Normalized records.
    pub document: Document,
}

/// Creates the normalized blank document used by desktop and file-mode clients.
///
/// The first page uses `page_name` when it contains non-whitespace text. Its
/// page and layer IDs are derived from `document_id`, keeping initial records
/// stable across every adapter.
#[must_use]
pub fn blank_document(document_id: &DocumentId, page_name: Option<&str>) -> Document {
    let page_id = PageId::from(format!("page:{}:1", document_id.as_str()));
    let layer_id = LayerId::from(format!("layer:{}:1", document_id.as_str()));
    let page = PageRecord {
        id: page_id.clone(),
        name: page_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Page 1")
            .to_owned(),
        layer_ids: vec![layer_id.clone()],
        version: RecordVersion(1),
    };
    let layer = LayerRecord {
        id: layer_id.clone(),
        page_id: page_id.clone(),
        name: "Default".into(),
        shape_ids: Vec::new(),
        visible: true,
        locked: false,
        opacity: Opacity::OPAQUE,
        version: RecordVersion(1),
    };
    Document {
        pages: BTreeMap::from([(page_id.clone(), page)]),
        page_ids: vec![page_id],
        layers: BTreeMap::from([(layer_id, layer)]),
        shapes: BTreeMap::new(),
        bindings: BTreeMap::new(),
        assets: BTreeMap::new(),
    }
}
