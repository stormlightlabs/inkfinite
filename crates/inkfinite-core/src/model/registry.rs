//! Shape registry keys, hierarchy values, and kind-specific properties.

use std::collections::BTreeMap;
use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use ts_rs::TS;

use super::geometry::{Insets, PaintValue};
use super::ids::{LayerId, ShapeId};

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
    /// Embedded raster image shape.
    Image,
    /// URL, file, or page reference content.
    Reference,
    /// Container shape.
    Container,
}

impl BuiltinShapeKind {
    /// Built-in kinds in their stable serialized order.
    pub const ALL: [Self; 11] = [
        Self::Rectangle,
        Self::Ellipse,
        Self::Line,
        Self::Arrow,
        Self::Text,
        Self::Stroke,
        Self::Path,
        Self::Markdown,
        Self::Image,
        Self::Reference,
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
            Self::Image => "image",
            Self::Reference => "reference",
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
            b"image" => Some(Self::Image),
            b"reference" => Some(Self::Reference),
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
/// Built-in embedded image shape kind.
pub const IMAGE_KIND: &str = BuiltinShapeKind::Image.as_str();
/// Built-in URL, file, or page reference shape kind.
pub const REFERENCE_KIND: &str = BuiltinShapeKind::Reference.as_str();
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
    IMAGE_KIND,
    REFERENCE_KIND,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StrokeBrushProperties {
    pub(crate) size: f64,
    pub(crate) thinning: f64,
    pub(crate) smoothing: f64,
    pub(crate) streamline: f64,
    pub(crate) simulate_pressure: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct StrokeStyleProperties {
    pub(crate) color: PaintValue,
    pub(crate) opacity: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StrokeWidthPoint {
    pub(crate) offset: f64,
    pub(crate) width: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StrokeProperties {
    pub(crate) points: Vec<Vec<f64>>,
    pub(crate) style: StrokeStyleProperties,
    pub(crate) brush: StrokeBrushProperties,
    #[serde(default, alias = "width_profile")]
    pub(crate) width_profile: Option<Vec<StrokeWidthPoint>>,
}

/// The semantic target represented by a reference shape.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ReferenceKind {
    /// A web URL.
    Url,
    /// A local or workspace file path.
    File,
    /// Another page in the same document.
    Page,
}

/// Native reference content properties.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceProperties {
    /// Width of the reference card.
    #[serde(alias = "w")]
    pub width: f64,
    /// Height of the reference card.
    #[serde(alias = "h")]
    pub height: f64,
    /// Reference target kind.
    #[serde(alias = "reference_type")]
    pub reference_type: ReferenceKind,
    /// URL, path, or page ID represented by the shape.
    pub value: String,
    /// Optional display label.
    #[serde(default)]
    pub label: Option<String>,
}

/// Normalized image crop insets.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImageCrop {
    /// Top inset as a fraction of the source image.
    pub top: f64,
    /// Right inset as a fraction of the source image.
    pub right: f64,
    /// Bottom inset as a fraction of the source image.
    pub bottom: f64,
    /// Left inset as a fraction of the source image.
    pub left: f64,
}

/// Shape used to clip an image during rendering.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ImageMaskKind {
    /// No additional curvature.
    Rectangle,
    /// Elliptical image mask.
    Ellipse,
    /// Rounded rectangle image mask.
    Rounded,
}

/// Native image mask properties.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImageMask {
    /// Mask shape.
    pub kind: ImageMaskKind,
    /// Rounded-corner radius for a rounded mask.
    #[serde(default)]
    pub radius: Option<f64>,
}

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
    /// A fill or stroke paint does not decode or fail gradient validation.
    #[error("shape kind {kind} property {property} has invalid paint: {message}")]
    InvalidPaint {
        kind: String,
        property: String,
        message: String,
    },
    /// Text-on-path properties do not decode or fail attachment validation.
    #[error("shape kind {kind} has invalid text path properties: {message}")]
    InvalidText { kind: String, message: String },
    /// Native path properties do not decode or fail path geometry validation.
    #[error("shape kind {kind} has invalid path geometry: {message}")]
    InvalidPath { kind: String, message: String },
    /// Freehand properties do not decode or fail committed stroke validation.
    #[error("shape kind {kind} has invalid stroke geometry: {message}")]
    InvalidStroke { kind: String, message: String },
    /// Image properties do not decode or fail image validation.
    #[error("shape kind {kind} has invalid image properties: {message}")]
    InvalidImage { kind: String, message: String },
    /// Clip, mask, or filter properties do not decode or fail effect validation.
    #[error("shape kind {kind} has invalid vector effects: {message}")]
    InvalidEffects { kind: String, message: String },
    /// Reference properties do not decode or fail reference validation.
    #[error("shape kind {kind} has invalid reference properties: {message}")]
    InvalidReference { kind: String, message: String },
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
