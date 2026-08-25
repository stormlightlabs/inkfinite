//! Geometry, paint, metadata, and other reusable canonical values.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use ts_rs::TS;

use super::ids::{ActorId, Timestamp};
use super::registry::{Origin, ShapeProperties};

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

/// Whether the two cubic handles at an anchor move together.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PathHandleMode {
    /// The incoming and outgoing handles can move independently.
    Broken,
    /// The incoming and outgoing handles stay opposite one another.
    Joined,
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
    /// Optional per-anchor handle modes. Missing entries use broken handles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_modes: Option<Vec<PathHandleMode>>,
}

/// Normalized geometry for a native path shape.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct PathGeometry {
    /// Independent subpaths in document-local coordinates.
    pub subpaths: Vec<PathSubpath>,
    /// Rule used when filling the compound path.
    pub fill_rule: PathFillRule,
}

/// Whether a native mask reads source alpha or source luminance.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum MaskMode {
    /// Use the mask geometry as an alpha mask.
    Alpha,
    /// Use the rendered luminance of the mask geometry.
    Luminance,
}

/// A native non-destructive mask based on editable path geometry.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MaskEffect {
    /// How the mask contributes opacity.
    pub mode: MaskMode,
    /// Mask geometry in the target shape's local coordinates.
    pub geometry: PathGeometry,
    /// Overall mask opacity.
    #[serde(default = "default_mask_opacity")]
    pub opacity: f64,
}

/// One supported, editable SVG filter primitive.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum FilterPrimitive {
    /// Gaussian blur radius in local user units.
    Blur {
        /// Standard deviation used by the blur.
        radius: f64,
    },
    /// CSS/SVG brightness multiplier.
    Brightness {
        /// Multiplier where `1` leaves the source unchanged.
        amount: f64,
    },
    /// CSS/SVG contrast multiplier.
    Contrast {
        /// Multiplier where `1` leaves the source unchanged.
        amount: f64,
    },
    /// Desaturate the source by the supplied amount.
    Grayscale {
        /// Amount from zero to one.
        amount: f64,
    },
    /// Rotate source hue in degrees.
    HueRotate {
        /// Hue rotation in degrees.
        degrees: f64,
    },
    /// Invert source colours by the supplied amount.
    Invert {
        /// Amount from zero to one.
        amount: f64,
    },
    /// Adjust colour saturation.
    Saturate {
        /// Multiplier where `1` leaves the source unchanged.
        amount: f64,
    },
    /// Convert source colours toward sepia.
    Sepia {
        /// Amount from zero to one.
        amount: f64,
    },
    /// Adjust source opacity.
    Opacity {
        /// Multiplier from zero to one.
        amount: f64,
    },
    /// Draw a blurred coloured shadow behind the source.
    DropShadow {
        /// Horizontal offset.
        dx: f64,
        /// Vertical offset.
        dy: f64,
        /// Blur radius.
        radius: f64,
        /// Shadow colour.
        color: String,
        /// Shadow opacity.
        opacity: f64,
    },
}

/// An ordered list of supported filter primitives.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FilterEffect {
    /// Filter primitives in application order.
    pub primitives: Vec<FilterPrimitive>,
}

fn default_mask_opacity() -> f64 {
    1.0
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
    /// The optional handle-mode list does not match the segment list.
    #[error("path subpath {subpath} has {actual} handle modes for {expected} segments")]
    HandleModeCount {
        /// Invalid subpath index.
        subpath: usize,
        /// Number of segments that need modes.
        expected: usize,
        /// Number of modes supplied by the document.
        actual: usize,
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
        if let Some(handle_modes) = &subpath.handle_modes
            && handle_modes.len() != subpath.segments.len()
        {
            return Err(PathGeometryError::HandleModeCount {
                subpath: subpath_index,
                expected: subpath.segments.len(),
                actual: handle_modes.len(),
            });
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
    /// Optional card title.
    #[serde(default)]
    pub title: Option<String>,
    /// Optional semantic selector such as `architecture.service`.
    pub role: Option<String>,
    /// Optional longer description.
    pub description: Option<String>,
    /// Optional card body.
    #[serde(default)]
    pub body: Option<String>,
    /// Searchable, user-defined tags.
    pub tags: Vec<String>,
    /// Optional content source, such as a citation or file path.
    #[serde(default)]
    pub source: Option<String>,
    /// Optional external link associated with the content.
    #[serde(default)]
    pub link: Option<String>,
    /// Optional user-defined structured metadata. An empty map means no custom fields.
    #[serde(default)]
    pub custom_metadata: BTreeMap<String, Value>,
    /// Whether direct edits to this shape are prohibited.
    pub locked: bool,
    /// Whether an agent may propose or apply edits to this shape.
    pub agent_editable: bool,
    /// Attribution for the record.
    pub provenance: Provenance,
}

/// Coordinate space used by a gradient's geometry.
#[derive(Clone, Copy, Debug, Default, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum GradientUnits {
    /// Coordinates are fractions of the painted shape's bounding box.
    #[default]
    ObjectBoundingBox,
    /// Coordinates are measured in the painted shape's local coordinate space.
    UserSpaceOnUse,
}

/// How a gradient behaves outside its first and last stop.
#[derive(Clone, Copy, Debug, Default, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum GradientSpread {
    /// Hold the nearest stop colour.
    #[default]
    Pad,
    /// Repeat the gradient while reversing each alternate copy.
    Reflect,
    /// Repeat the gradient from the first stop.
    Repeat,
}

/// Affine transform applied in gradient coordinate space.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct GradientTransform {
    /// Horizontal scale and rotation component.
    pub a: f64,
    /// Vertical shear and rotation component.
    pub b: f64,
    /// Horizontal shear and rotation component.
    pub c: f64,
    /// Vertical scale component.
    pub d: f64,
    /// Horizontal translation.
    pub e: f64,
    /// Vertical translation.
    pub f: f64,
}

impl Default for GradientTransform {
    fn default() -> Self {
        Self { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 }
    }
}

/// One colour transition in a gradient.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    /// Position from zero to one along the gradient.
    pub offset: f64,
    /// CSS colour used at this position.
    pub color: String,
    /// Opacity applied to the colour at this position.
    pub opacity: f64,
}

/// A native fill or stroke paint.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Paint {
    /// A single CSS colour.
    Solid {
        /// CSS colour value.
        color: String,
    },
    /// A linear gradient between two points.
    LinearGradient {
        /// Start horizontal coordinate.
        x1: f64,
        /// Start vertical coordinate.
        y1: f64,
        /// End horizontal coordinate.
        x2: f64,
        /// End vertical coordinate.
        y2: f64,
        /// Coordinate space for the endpoints.
        #[serde(default)]
        units: GradientUnits,
        /// Gradient coordinate transform.
        #[serde(default)]
        transform: GradientTransform,
        /// Behaviour outside the stop range.
        #[serde(default)]
        spread: GradientSpread,
        /// Ordered colour stops.
        stops: Vec<GradientStop>,
    },
    /// A radial gradient with an optional separate focal point.
    RadialGradient {
        /// Centre horizontal coordinate.
        cx: f64,
        /// Centre vertical coordinate.
        cy: f64,
        /// Radius.
        r: f64,
        /// Focal point horizontal coordinate.
        fx: f64,
        /// Focal point vertical coordinate.
        fy: f64,
        /// Coordinate space for the geometry.
        #[serde(default)]
        units: GradientUnits,
        /// Gradient coordinate transform.
        #[serde(default)]
        transform: GradientTransform,
        /// Behaviour outside the stop range.
        #[serde(default)]
        spread: GradientSpread,
        /// Ordered colour stops.
        stops: Vec<GradientStop>,
    },
}

/// Paint values accepted by legacy flat-colour records and native gradients.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum PaintValue {
    /// A legacy CSS colour string.
    Solid(String),
    /// A native gradient or explicit solid paint.
    Native(Paint),
}

impl Paint {
    /// Validates gradient coordinates, transforms, stops, and colours.
    pub fn validate(&self) -> Result<(), String> {
        let (coordinates, transform, stops) = match self {
            Self::Solid { color } => {
                if color.trim().is_empty() {
                    return Err("solid paint colour must not be empty".into());
                }
                return Ok(());
            }
            Self::LinearGradient { x1, y1, x2, y2, transform, stops, .. } => ([*x1, *y1, *x2, *y2], *transform, stops),
            Self::RadialGradient { cx, cy, r, fx, fy, transform, stops, .. } => {
                if !r.is_finite() || *r < 0.0 {
                    return Err("radial gradient radius must be finite and non-negative".into());
                }
                ([*cx, *cy, *fx, *fy], *transform, stops)
            }
        };
        if !coordinates.into_iter().all(f64::is_finite) {
            return Err("gradient coordinates must be finite".into());
        }
        if ![
            transform.a,
            transform.b,
            transform.c,
            transform.d,
            transform.e,
            transform.f,
        ]
        .into_iter()
        .all(f64::is_finite)
        {
            return Err("gradient transform must be finite".into());
        }
        if stops.is_empty() {
            return Err("gradient must contain at least one stop".into());
        }
        for stop in stops {
            if !stop.offset.is_finite() || !(0.0..=1.0).contains(&stop.offset) {
                return Err("gradient stop offsets must be finite and between 0 and 1".into());
            }
            if !stop.opacity.is_finite() || !(0.0..=1.0).contains(&stop.opacity) {
                return Err("gradient stop opacity must be between 0 and 1".into());
            }
            if stop.color.trim().is_empty() {
                return Err("gradient stop colour must not be empty".into());
            }
        }
        Ok(())
    }
}

/// Decodes either a legacy CSS colour or a native paint object.
pub fn paint_from_value(value: &Value) -> Result<Paint, String> {
    match value {
        Value::String(color) => Ok(Paint::Solid { color: color.clone() }),
        _ => serde_json::from_value::<Paint>(value.clone()).map_err(|error| error.to_string()),
    }
}

/// Validates one legacy or native paint value.
pub fn validate_paint_value(value: &Value) -> Result<(), String> {
    paint_from_value(value)?.validate()
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
