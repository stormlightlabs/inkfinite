//! Durable, transport-independent records for Inkfinite v2 documents.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Stable format identifier for an Inkfinite v2 document snapshot.
pub const INKFINITE_FORMAT_ID: &str = "inkfinite.document";

/// First version of the Rust-owned Inkfinite document contract.
pub const INKFINITE_FORMAT_VERSION: u32 = 2;

/// Built-in rectangle shape kind.
pub const RECTANGLE_KIND: &str = "rect";
/// Built-in ellipse shape kind.
pub const ELLIPSE_KIND: &str = "ellipse";
/// Built-in line shape kind.
pub const LINE_KIND: &str = "line";
/// Built-in arrow shape kind.
pub const ARROW_KIND: &str = "arrow";
/// Built-in plain-text shape kind.
pub const TEXT_KIND: &str = "text";
/// Built-in freehand stroke shape kind.
pub const STROKE_KIND: &str = "stroke";
/// Built-in Markdown shape kind.
pub const MARKDOWN_KIND: &str = "markdown";
/// Built-in container shape kind.
pub const CONTAINER_KIND: &str = "container";

macro_rules! string_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// Creates an identifier from its stable serialized value.
            #[must_use]
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            /// Returns the stable serialized value.
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }
    };
}

string_id!(DocumentId, "Stable identifier for a document.");
string_id!(PageId, "Stable identifier for a page.");
string_id!(LayerId, "Stable identifier for a layer.");
string_id!(ShapeId, "Stable identifier for a shape.");
string_id!(BindingId, "Stable identifier for a binding.");
string_id!(
    AssetId,
    "Stable identifier for an embedded or linked asset."
);
string_id!(
    ActorId,
    "Stable identifier for a human, agent, or system actor."
);
string_id!(
    ChangeHash,
    "Opaque causal hash supplied by the CRDT implementation."
);
string_id!(FormatId, "Stable identifier for a serialized contract.");
string_id!(ShapeKind, "Registry key for a shape definition.");
string_id!(BindingKind, "Registry key for a binding definition.");

/// Milliseconds since the Unix epoch.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp(pub i64);

/// Monotonic version of a durable record within the document history.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RecordVersion(pub u64);

/// Opacity constrained to the inclusive range from zero to one.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "f32", into = "f32")]
pub struct Opacity(f32);

impl Opacity {
    /// Fully transparent opacity.
    pub const TRANSPARENT: Self = Self(0.0);
    /// Fully opaque opacity.
    pub const OPAQUE: Self = Self(1.0);

    /// Creates an opacity when `value` is finite and inside `0.0..=1.0`.
    ///
    /// # Errors
    ///
    /// Returns [`InvalidOpacity`] when the value is non-finite or outside the
    /// supported range.
    pub fn new(value: f32) -> Result<Self, InvalidOpacity> {
        if value.is_finite() && (0.0..=1.0).contains(&value) {
            Ok(Self(value))
        } else {
            Err(InvalidOpacity(value))
        }
    }

    /// Returns the numeric opacity.
    #[must_use]
    pub const fn get(self) -> f32 {
        self.0
    }
}

impl From<Opacity> for f32 {
    fn from(value: Opacity) -> Self {
        value.0
    }
}

impl TryFrom<f32> for Opacity {
    type Error = InvalidOpacity;

    fn try_from(value: f32) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

/// Error returned when an opacity is non-finite or outside `0.0..=1.0`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InvalidOpacity(pub f32);

impl fmt::Display for InvalidOpacity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "opacity must be finite and between 0 and 1, got {}",
            self.0
        )
    }
}

impl std::error::Error for InvalidOpacity {}

/// Anchor used to place an item in an ordered child list without numeric indexes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "position", content = "sibling_id")]
pub enum SiblingAnchor<Id> {
    /// Place the item before every existing sibling.
    First,
    /// Place the item after every existing sibling.
    Last,
    /// Place the item immediately before the identified sibling.
    Before(Id),
    /// Place the item immediately after the identified sibling.
    After(Id),
}

/// Two-dimensional point or vector in document coordinates.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    /// Horizontal component.
    pub x: f64,
    /// Vertical component.
    pub y: f64,
}

/// Transform relative to a shape's parent container or layer.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    /// Translation in parent coordinates.
    pub translation: Vec2,
    /// Clockwise rotation in radians.
    pub rotation: f64,
    /// Horizontal scale.
    pub scale_x: f64,
    /// Vertical scale.
    pub scale_y: f64,
}

/// Origin of a durable record or transaction.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// Direct edit made by a person.
    Human,
    /// Edit proposed or applied by an agent.
    Agent,
    /// Record created while importing another format.
    Import,
    /// Change received from a trusted peer.
    Sync,
    /// Deterministic repair or other internal change.
    System,
}

/// Attribution retained with durable content.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Provenance {
    /// Actor responsible for the record's current form.
    pub actor_id: ActorId,
    /// Path by which the record entered the document.
    pub origin: Origin,
    /// Time at which this provenance entry was recorded.
    pub timestamp: Timestamp,
    /// Optional source identifier, such as an imported filename or proposal ID.
    pub source: Option<String>,
}

/// Human- and agent-readable meaning attached to a shape.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SemanticMetadata {
    /// Optional display name.
    pub name: Option<String>,
    /// Optional semantic selector such as `architecture.service`.
    pub role: Option<String>,
    /// Optional longer description.
    pub description: Option<String>,
    /// Searchable, user-defined tags.
    pub tags: Vec<String>,
    /// Whether direct edits to this shape are prohibited.
    pub locked: bool,
    /// Whether an agent may propose or apply edits to this shape.
    pub agent_editable: bool,
    /// Attribution for the record.
    pub provenance: Provenance,
}

/// Common visual style shared by all shape kinds.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ShapeStyle {
    /// Opacity applied to the complete shape.
    pub opacity: Opacity,
    /// Optional opacity override for fills.
    pub fill_opacity: Option<Opacity>,
    /// Optional opacity override for strokes.
    pub stroke_opacity: Option<Opacity>,
}

/// Parent that owns a shape's sole draw-order entry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "id")]
pub enum ShapeParent {
    /// The shape is a root child of a layer.
    Layer(LayerId),
    /// The shape is a child of a container shape.
    Shape(ShapeId),
}

/// Stack direction for container layout.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StackDirection {
    /// Place children from left to right.
    Horizontal,
    /// Place children from top to bottom.
    Vertical,
}

/// Cross-axis alignment for laid-out children.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayoutAlignment {
    /// Align children to the start edge.
    Start,
    /// Center children on the cross axis.
    Center,
    /// Align children to the end edge.
    End,
    /// Stretch children across the cross axis.
    Stretch,
}

/// Padding inside a layout container.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Insets {
    /// Top inset.
    pub top: f64,
    /// Right inset.
    pub right: f64,
    /// Bottom inset.
    pub bottom: f64,
    /// Left inset.
    pub left: f64,
}

/// Optional automatic layout applied by a container shape.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ContainerLayout {
    /// Children retain their explicit transforms.
    Free,
    /// Children flow along one axis.
    Stack {
        /// Flow direction.
        direction: StackDirection,
        /// Space between adjacent children.
        gap: f64,
        /// Space between children and container edges.
        padding: Insets,
        /// Alignment on the cross axis.
        alignment: LayoutAlignment,
    },
    /// Children flow through a fixed number of columns.
    Grid {
        /// Positive number of grid columns.
        columns: u32,
        /// Horizontal gap between cells.
        column_gap: f64,
        /// Vertical gap between cells.
        row_gap: f64,
        /// Space between children and container edges.
        padding: Insets,
        /// Alignment within cells.
        alignment: LayoutAlignment,
    },
}

/// Kind-specific shape properties owned by the shape registry.
pub type ShapeProperties = BTreeMap<String, Value>;

/// Durable shape record shared by all built-in shape definitions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ShapeRecord {
    /// Stable record identifier.
    pub id: ShapeId,
    /// Registry key. Built-in values are exposed as `*_KIND` constants.
    pub kind: ShapeKind,
    /// Parent relation; ordering comes only from the parent's child list.
    pub parent: ShapeParent,
    /// Transform relative to `parent`.
    pub transform: Transform,
    /// Ordered children when this shape is a container.
    pub child_ids: Vec<ShapeId>,
    /// Optional automatic layout for container shapes.
    pub layout: Option<ContainerLayout>,
    /// Kind-specific serialized properties validated by the registry.
    pub properties: ShapeProperties,
    /// Human- and agent-readable semantics and permissions.
    pub metadata: SemanticMetadata,
    /// Visual properties common to all kinds.
    pub style: ShapeStyle,
    /// Version used by optimistic operation preconditions.
    pub version: RecordVersion,
}

/// Durable page record and its ordered layer list.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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

/// Durable layer record and its ordered root-shape list.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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

/// Attachment point on a bound shape.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum BindingAnchor {
    /// Attach to the calculated center.
    Center,
    /// Attach at normalized shape coordinates.
    Edge {
        /// Normalized horizontal coordinate.
        x: f64,
        /// Normalized vertical coordinate.
        y: f64,
    },
}

/// Durable relationship between two shapes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
    /// Version used by optimistic operation preconditions.
    pub version: RecordVersion,
}

/// Storage form for asset contents.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum AssetSource {
    /// Bytes stored inside the canonical document.
    Embedded {
        /// Raw asset bytes.
        bytes: Vec<u8>,
    },
    /// Stable external URI retained for formats that cannot embed an asset.
    External {
        /// URI used to resolve the content.
        uri: String,
    },
}

/// Durable image, font, or other binary asset.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opacity_rejects_invalid_values() {
        assert!(Opacity::new(-0.1).is_err());
        assert!(Opacity::new(1.1).is_err());
        assert!(Opacity::new(f32::NAN).is_err());
        assert_eq!(Opacity::new(0.5).map(Opacity::get), Ok(0.5));
    }

    #[test]
    fn opacity_deserialization_preserves_the_invariant() {
        let error = serde_json::from_str::<Opacity>("2.0").expect_err("invalid opacity");
        assert!(error.to_string().contains("between 0 and 1"));
    }

    #[test]
    fn sibling_anchors_serialize_ids_instead_of_indexes() {
        let anchor = SiblingAnchor::After(ShapeId::from("shape:first"));
        let value = serde_json::to_value(anchor).expect("anchor should serialize");

        assert_eq!(value["position"], "after");
        assert_eq!(value["sibling_id"], "shape:first");
    }
}
