//! Transport-independent contracts and services for Inkfinite.

#![forbid(unsafe_code)]

pub mod crdt;
pub mod engine;
pub mod file;
pub mod ipc;
pub mod proto;
pub mod render;
pub mod session;
pub mod sync;

use std::collections::BTreeMap;
use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use ts_rs::TS;

/// Stable format identifier for an Inkfinite document snapshot.
pub const INKFINITE_FORMAT_ID: &str = "inkfinite.document";

/// First version of the Rust-owned Inkfinite document contract.
pub const INKFINITE_FORMAT_VERSION: u32 = 2;

/// A built-in shape registry key.
///
/// Document records retain their string `kind` field so the registry can grow
/// without changing the serialized document contract. Use this enum whenever
/// code specifically requires one of Inkfinite's built-in kinds.
#[derive(Clone, Copy, Debug, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum BuiltinShapeKind {
    /// Rectangle shape.
    #[serde(rename = "rect")]
    #[ts(rename = "rect")]
    Rectangle,
    /// Ellipse shape.
    Ellipse,
    /// Straight line shape.
    Line,
    /// Arrow shape.
    Arrow,
    /// Plain-text shape.
    Text,
    /// Freehand stroke shape.
    Stroke,
    /// Native path geometry shape.
    Path,
    /// Markdown shape.
    Markdown,
    /// Container shape.
    Container,
}

impl BuiltinShapeKind {
    /// Built-in kinds in their stable serialized order.
    pub const ALL: [Self; 9] = [
        Self::Rectangle,
        Self::Ellipse,
        Self::Line,
        Self::Arrow,
        Self::Text,
        Self::Stroke,
        Self::Path,
        Self::Markdown,
        Self::Container,
    ];

    /// Returns the stable registry key for this kind.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Rectangle => "rect",
            Self::Ellipse => "ellipse",
            Self::Line => "line",
            Self::Arrow => "arrow",
            Self::Text => "text",
            Self::Stroke => "stroke",
            Self::Path => "path",
            Self::Markdown => "markdown",
            Self::Container => "container",
        }
    }

    /// Parses a built-in registry key.
    #[must_use]
    pub const fn parse(value: &str) -> Option<Self> {
        match value.as_bytes() {
            b"rect" => Some(Self::Rectangle),
            b"ellipse" => Some(Self::Ellipse),
            b"line" => Some(Self::Line),
            b"arrow" => Some(Self::Arrow),
            b"text" => Some(Self::Text),
            b"stroke" => Some(Self::Stroke),
            b"path" => Some(Self::Path),
            b"markdown" => Some(Self::Markdown),
            b"container" => Some(Self::Container),
            _ => None,
        }
    }
}

impl fmt::Display for BuiltinShapeKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Built-in rectangle shape kind.
pub const RECTANGLE_KIND: &str = BuiltinShapeKind::Rectangle.as_str();
/// Built-in ellipse shape kind.
pub const ELLIPSE_KIND: &str = BuiltinShapeKind::Ellipse.as_str();
/// Built-in line shape kind.
pub const LINE_KIND: &str = BuiltinShapeKind::Line.as_str();
/// Built-in arrow shape kind.
pub const ARROW_KIND: &str = BuiltinShapeKind::Arrow.as_str();
/// Built-in plain-text shape kind.
pub const TEXT_KIND: &str = BuiltinShapeKind::Text.as_str();
/// Built-in freehand stroke shape kind.
pub const STROKE_KIND: &str = BuiltinShapeKind::Stroke.as_str();
/// Built-in native path geometry shape kind.
pub const PATH_KIND: &str = BuiltinShapeKind::Path.as_str();
/// Built-in Markdown shape kind.
pub const MARKDOWN_KIND: &str = BuiltinShapeKind::Markdown.as_str();
/// Built-in container shape kind.
pub const CONTAINER_KIND: &str = BuiltinShapeKind::Container.as_str();

/// Stable order of the built-in shape kinds exposed to both registries.
pub const BUILTIN_SHAPE_KINDS: &[&str] = &[
    RECTANGLE_KIND,
    ELLIPSE_KIND,
    LINE_KIND,
    ARROW_KIND,
    TEXT_KIND,
    STROKE_KIND,
    PATH_KIND,
    MARKDOWN_KIND,
    CONTAINER_KIND,
];

/// Coordinate convention used by shape geometry implementations.
pub const GEOMETRY_COORDINATE_SYSTEM: &str = "local_origin_top_left_positive_x_right_positive_y_down";

/// Rotation convention used by shape geometry implementations.
pub const GEOMETRY_ROTATION: &str = "clockwise_radians_about_local_origin";
/// Bounds convention used by shape geometry implementations.
pub const GEOMETRY_BOUNDS: &str = "axis_aligned_enclosing_bounds";

/// Returns the built-in shape registry keys in their stable serialized order.
#[must_use]
pub const fn builtin_shape_kinds() -> &'static [&'static str] {
    BUILTIN_SHAPE_KINDS
}

/// Returns whether `kind` is one of the built-in shape registry keys.
#[must_use]
pub fn is_builtin_shape_kind(kind: &str) -> bool {
    BuiltinShapeKind::parse(kind).is_some()
}

/// Kind-specific shape properties owned by the shape registry.
pub type ShapeProperties = BTreeMap<String, Value>;

/// Storage form for asset contents.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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

/// Attachment point on a bound shape.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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

/// Error returned when a shape registry property violates a shared registry rule.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ShapePropertyError {
    /// The shape kind is not part of the built-in registry.
    #[error("unknown shape kind {kind}")]
    UnknownKind { kind: String },
    /// A dimension property was not a JSON number.
    #[error("shape kind {kind} property {property} must be a number")]
    ExpectedNumber { kind: String, property: String },
    /// A dimension property was non-finite.
    #[error("shape kind {kind} property {property} must be finite")]
    NonFiniteNumber { kind: String, property: String },
    /// A dimension property was negative.
    #[error("shape kind {kind} property {property} must not be negative")]
    NegativeNumber { kind: String, property: String },
    /// Native path properties do not decode or fail path geometry validation.
    #[error("shape kind {kind} has invalid path geometry: {message}")]
    InvalidPath { kind: String, message: String },
}

/// Anchor used to place an item in an ordered child list without numeric indexes.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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

/// Origin of a record or transaction.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// Direct edit made by a person.
    Human,
    /// Edit proposed or applied by an agent.
    Agent,
    /// Change received from a trusted peer.
    Sync,
    /// Deterministic repair or other internal change.
    System,
}

/// Parent that owns a shape's sole draw-order entry.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "kind", content = "id")]
pub enum ShapeParent {
    /// The shape is a root child of a layer.
    Layer(LayerId),
    /// The shape is a child of a container shape.
    Shape(ShapeId),
}

/// Stack direction for container layout.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StackDirection {
    /// Place children from left to right.
    Horizontal,
    /// Place children from top to bottom.
    Vertical,
}

/// Cross-axis alignment for laid-out children.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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

/// Optional automatic layout applied by a container shape.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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

macro_rules! string_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Clone, Debug, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
        #[serde(transparent)]
        #[ts(type = "string")]
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
string_id!(AssetId, "Stable identifier for an embedded or linked asset.");
string_id!(ActorId, "Stable identifier for a human, agent, or system actor.");
string_id!(ChangeHash, "Opaque causal hash supplied by the CRDT implementation.");
string_id!(FormatId, "Stable identifier for a serialized contract.");
string_id!(ShapeKind, "Registry key for a shape definition.");
string_id!(BindingKind, "Registry key for a binding definition.");

/// Milliseconds since the Unix epoch.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(type = "number")]
pub struct Timestamp(pub i64);

/// Monotonic version of a record within the document history.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(type = "number")]
pub struct RecordVersion(pub u64);

/// Opacity constrained to the inclusive range from zero to one.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(try_from = "f32", into = "f32")]
#[schemars(schema_with = "opacity_schema")]
#[ts(type = "number")]
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

fn opacity_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    let mut schema = f32::json_schema(generator);
    if let Some(object) = schema.as_object_mut() {
        object.insert("minimum".into(), 0.0.into());
        object.insert("maximum".into(), 1.0.into());
    }
    schema
}

/// Error returned when an opacity is non-finite or outside `0.0..=1.0`.
#[derive(Clone, Copy, Debug, Error, PartialEq)]
#[error("opacity must be finite and between 0 and 1, got {0}")]
pub struct InvalidOpacity(pub f32);

/// Two-dimensional point or vector in document coordinates.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct Vec2 {
    /// Horizontal component.
    pub x: f64,
    /// Vertical component.
    pub y: f64,
}

/// Fill rule used to determine the interior of a compound path.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub enum PathFillRule {
    /// Fill according to the non-zero winding number rule.
    #[serde(rename = "nonzero")]
    #[ts(rename = "nonzero")]
    NonZero,
    /// Fill alternating nested regions according to their crossing count.
    #[serde(rename = "evenodd")]
    #[ts(rename = "evenodd")]
    EvenOdd,
}

/// One normalized drawing command in a path subpath.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
pub enum PathSegment {
    /// Start a subpath at `to`.
    #[serde(rename = "move")]
    #[ts(rename = "move")]
    Move {
        /// Destination point.
        to: Vec2,
    },
    /// Draw a straight segment to `to`.
    #[serde(rename = "line")]
    #[ts(rename = "line")]
    Line {
        /// Destination point.
        to: Vec2,
    },
    /// Draw a quadratic Bézier segment.
    #[serde(rename = "quadratic")]
    #[ts(rename = "quadratic")]
    Quadratic {
        /// Quadratic control point.
        control: Vec2,
        /// Destination point.
        to: Vec2,
    },
    /// Draw a cubic Bézier segment.
    #[serde(rename = "cubic")]
    #[ts(rename = "cubic")]
    Cubic {
        /// First cubic control point.
        control_1: Vec2,
        /// Second cubic control point.
        control_2: Vec2,
        /// Destination point.
        to: Vec2,
    },
}

/// One normalized subpath. Its first segment must be a move command; later
/// segments continue from the previous segment's destination.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct PathSubpath {
    /// Ordered move, line, and Bézier segments.
    pub segments: Vec<PathSegment>,
    /// Whether the final point connects back to the subpath's move point.
    pub closed: bool,
}

/// Normalized geometry for a native path shape.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct PathGeometry {
    /// Independent subpaths in document-local coordinates.
    pub subpaths: Vec<PathSubpath>,
    /// Rule used when filling the compound path.
    pub fill_rule: PathFillRule,
}

/// Error returned when normalized path geometry violates its representation.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PathGeometryError {
    /// A path without subpaths cannot represent native geometry.
    #[error("path must contain at least one subpath")]
    Empty,
    /// A subpath must contain its initial move command.
    #[error("path subpath {subpath} must contain at least one segment")]
    EmptySubpath {
        /// Invalid subpath index.
        subpath: usize,
    },
    /// The first segment of a subpath is not a move command.
    #[error("path subpath {subpath} must begin with a move segment")]
    MissingMove {
        /// Invalid subpath index.
        subpath: usize,
    },
    /// A move command appeared after the initial move command.
    #[error("path subpath {subpath} contains a move segment at index {segment}")]
    MoveNotFirst {
        /// Invalid subpath index.
        subpath: usize,
        /// Invalid segment index.
        segment: usize,
    },
    /// A point in a path command is not finite.
    #[error("path subpath {subpath} segment {segment} has a non-finite {component} coordinate")]
    NonFiniteCoordinate {
        /// Invalid subpath index.
        subpath: usize,
        /// Invalid segment index.
        segment: usize,
        /// Invalid coordinate component.
        component: &'static str,
    },
    /// Path properties could not be decoded into the normalized representation.
    #[error("path properties could not be decoded: {0}")]
    InvalidProperties(String),
}

/// Validates normalized path geometry before it enters a shape record.
///
/// Every subpath has exactly one initial move segment. Later segments are line,
/// quadratic, or cubic commands, and every coordinate is finite.
///
/// # Errors
///
/// Returns [`PathGeometryError`] when the path is empty, has an invalid segment
/// order, or contains a non-finite coordinate.
pub fn validate_path_geometry(geometry: &PathGeometry) -> Result<(), PathGeometryError> {
    if geometry.subpaths.is_empty() {
        return Err(PathGeometryError::Empty);
    }
    for (subpath_index, subpath) in geometry.subpaths.iter().enumerate() {
        let Some(first) = subpath.segments.first() else {
            return Err(PathGeometryError::EmptySubpath { subpath: subpath_index });
        };
        if !matches!(first, PathSegment::Move { .. }) {
            return Err(PathGeometryError::MissingMove { subpath: subpath_index });
        }
        for (segment_index, segment) in subpath.segments.iter().enumerate() {
            if segment_index > 0 && matches!(segment, PathSegment::Move { .. }) {
                return Err(PathGeometryError::MoveNotFirst { subpath: subpath_index, segment: segment_index });
            }
            let points = match segment {
                PathSegment::Move { to } | PathSegment::Line { to } => [to, to, to],
                PathSegment::Quadratic { control, to } => [control, to, to],
                PathSegment::Cubic { control_1, control_2, to } => [control_1, control_2, to],
            };
            let point_count = match segment {
                PathSegment::Move { .. } | PathSegment::Line { .. } => 1,
                PathSegment::Quadratic { .. } => 2,
                PathSegment::Cubic { .. } => 3,
            };
            for point in points.into_iter().take(point_count) {
                for (value, component) in [(point.x, "x"), (point.y, "y")] {
                    if !value.is_finite() {
                        return Err(PathGeometryError::NonFiniteCoordinate {
                            subpath: subpath_index,
                            segment: segment_index,
                            component,
                        });
                    }
                }
            }
        }
    }
    Ok(())
}

/// Decodes the canonical path geometry stored in a path shape's properties.
///
/// Path properties store `subpaths` and `fill_rule` alongside any future
/// path-specific painting properties. Unknown properties are ignored here.
///
/// # Errors
///
/// Returns [`PathGeometryError::InvalidProperties`] when those fields do not
/// decode into [`PathGeometry`].
pub fn path_geometry_from_properties(properties: &ShapeProperties) -> Result<PathGeometry, PathGeometryError> {
    serde_json::from_value(Value::Object(properties.clone().into_iter().collect()))
        .map_err(|error| PathGeometryError::InvalidProperties(error.to_string()))
}

/// Transform relative to a shape's parent container or layer.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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

/// Attribution retained with content.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct Provenance {
    /// Actor responsible for the record's current form.
    pub actor_id: ActorId,
    /// Path by which the record entered the document.
    pub origin: Origin,
    /// Time at which this provenance entry was recorded.
    pub timestamp: Timestamp,
    /// Optional source identifier, such as an external reference or proposal ID.
    pub source: Option<String>,
}

/// Human- and agent-readable meaning attached to a shape.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct ShapeStyle {
    /// Opacity applied to the complete shape.
    pub opacity: Opacity,
    /// Optional opacity override for fills.
    pub fill_opacity: Option<Opacity>,
    /// Optional opacity override for strokes.
    pub stroke_opacity: Option<Opacity>,
}

/// Padding inside a layout container.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
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
    /// Ordered children when this shape is a container.
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

/// Validates the property rules shared by the Rust and TypeScript registries.
///
/// Unknown properties remain available for shape-specific extensions. The
/// registry gives common `width` and `height` properties cross-language numeric
/// and non-negative constraints, and validates the normalized geometry of path
/// shapes.
///
/// # Errors
///
/// Returns [`ShapePropertyError`] when the kind is unknown or a supplied common
/// dimension cannot be represented as a finite, non-negative number.
pub fn validate_shape_properties(kind: &str, properties: &ShapeProperties) -> Result<(), ShapePropertyError> {
    if !is_builtin_shape_kind(kind) {
        return Err(ShapePropertyError::UnknownKind { kind: kind.to_owned() });
    }

    for property in ["width", "height"] {
        let Some(value) = properties.get(property) else {
            continue;
        };
        let Some(number) = value.as_f64() else {
            return Err(ShapePropertyError::ExpectedNumber { kind: kind.to_owned(), property: property.to_owned() });
        };
        if !number.is_finite() {
            return Err(ShapePropertyError::NonFiniteNumber { kind: kind.to_owned(), property: property.to_owned() });
        }
        if number < 0.0 {
            return Err(ShapePropertyError::NegativeNumber { kind: kind.to_owned(), property: property.to_owned() });
        }
    }
    if kind == PATH_KIND {
        let geometry = path_geometry_from_properties(properties)
            .map_err(|error| ShapePropertyError::InvalidPath { kind: kind.to_owned(), message: error.to_string() })?;
        validate_path_geometry(&geometry)
            .map_err(|error| ShapePropertyError::InvalidPath { kind: kind.to_owned(), message: error.to_string() })?;
    }
    Ok(())
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

    #[test]
    fn builtin_registry_validates_shared_dimension_properties() {
        assert_eq!(
            builtin_shape_kinds(),
            &[
                RECTANGLE_KIND,
                ELLIPSE_KIND,
                LINE_KIND,
                ARROW_KIND,
                TEXT_KIND,
                STROKE_KIND,
                PATH_KIND,
                MARKDOWN_KIND,
                CONTAINER_KIND,
            ]
        );
        assert!(
            validate_shape_properties(
                RECTANGLE_KIND,
                &BTreeMap::from([(String::from("width"), Value::from(10.0))])
            )
            .is_ok()
        );
        assert!(matches!(
            validate_shape_properties(
                RECTANGLE_KIND,
                &BTreeMap::from([(String::from("height"), Value::from(-1.0))])
            ),
            Err(ShapePropertyError::NegativeNumber { .. })
        ));
        assert!(matches!(
            validate_shape_properties("unknown", &BTreeMap::new()),
            Err(ShapePropertyError::UnknownKind { .. })
        ));
        let mut geometry = PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Line { to: Vec2 { x: 10.0, y: 0.0 } },
                    PathSegment::Quadratic { control: Vec2 { x: 15.0, y: 5.0 }, to: Vec2 { x: 10.0, y: 10.0 } },
                    PathSegment::Cubic {
                        control_1: Vec2 { x: 10.0, y: 15.0 },
                        control_2: Vec2 { x: 0.0, y: 15.0 },
                        to: Vec2 { x: 0.0, y: 10.0 },
                    },
                ],
                closed: true,
            }],
            fill_rule: PathFillRule::EvenOdd,
        };
        assert!(validate_path_geometry(&geometry).is_ok());
        let properties = BTreeMap::from([
            (
                "subpaths".into(),
                serde_json::to_value(&geometry.subpaths).expect("subpaths serialize"),
            ),
            (
                "fill_rule".into(),
                serde_json::to_value(geometry.fill_rule).expect("fill rule serializes"),
            ),
        ]);
        assert!(validate_shape_properties(PATH_KIND, &properties).is_ok());

        geometry.subpaths[0]
            .segments
            .insert(1, PathSegment::Move { to: Vec2 { x: 1.0, y: 1.0 } });
        assert!(matches!(
            validate_path_geometry(&geometry),
            Err(PathGeometryError::MoveNotFirst { .. })
        ));
        geometry.subpaths[0].segments.remove(1);
        geometry.subpaths[0].segments[0] = PathSegment::Move { to: Vec2 { x: f64::NAN, y: 0.0 } };
        assert!(matches!(
            validate_path_geometry(&geometry),
            Err(PathGeometryError::NonFiniteCoordinate { component: "x", .. })
        ));
        let invalid_properties = BTreeMap::from([("subpaths".into(), serde_json::json!([]))]);
        assert!(matches!(
            validate_shape_properties(PATH_KIND, &invalid_properties),
            Err(ShapePropertyError::InvalidPath { .. })
        ));

        assert_eq!(BuiltinShapeKind::parse("rect"), Some(BuiltinShapeKind::Rectangle));
        assert_eq!(BuiltinShapeKind::parse("path"), Some(BuiltinShapeKind::Path));
        assert_eq!(BuiltinShapeKind::Rectangle.to_string(), RECTANGLE_KIND);
        assert_eq!(
            serde_json::to_value(BuiltinShapeKind::Rectangle).expect("built-in kind should serialize"),
            Value::from(RECTANGLE_KIND)
        );
    }
}
