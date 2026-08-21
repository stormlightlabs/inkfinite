//! Parsing and native mapping for the static SVG subset understood by Inkfinite.
//!
//! The importer produces a tree of native shape properties rather than keeping
//! an SVG document model. Groups retain their local transforms and become
//! container candidates; supported vector elements become the corresponding
//! native shape kinds. Raster images are extracted as embedded assets and kept
//! as image nodes until the document model gains a native image shape. The
//! exact source is retained as a content-addressed SVG asset.

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use roxmltree::{Document as XmlDocument, Node};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use svgtypes::{PathParser, PathSegment};
use thiserror::Error;
use ts_rs::TS;

use crate::engine::geometry::{Affine, path_bounds, union};
use crate::proto::Bounds;
use crate::{
    AssetId, AssetRecord, AssetSource, Opacity, PathFillRule, PathGeometry, PathSegment as NativePathSegment,
    PathSubpath, Provenance, ShapeKind, ShapeProperties, ShapeStyle, Timestamp, Transform, Vec2,
};

/// Maximum UTF-8 input accepted by the SVG parser.
pub const SVG_IMPORT_MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy)]
enum PreviousSegment {
    Cubic,
    Quadratic,
    Other,
}

/// An unsupported SVG feature identified during static import.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SvgUnsupportedFeature {
    /// A linear, radial, or mesh gradient.
    Gradient,
    /// A pattern paint server.
    Pattern,
    /// A clip path definition or reference.
    ClipPath,
    /// A mask definition or reference.
    Mask,
    /// A filter definition or reference.
    Filter,
    /// Script content or an event handler.
    Script,
    /// SMIL animation content.
    Animation,
    /// An external resource reference.
    ExternalResource,
    /// A stylesheet that the static importer does not evaluate.
    Stylesheet,
}

/// Action taken for unsupported SVG content during static import.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SvgUnsupportedAction {
    /// Leave the content out of the normalized native tree.
    Omitted,
}

impl fmt::Display for SvgUnsupportedFeature {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Gradient => "gradient",
            Self::Pattern => "pattern",
            Self::ClipPath => "clip path",
            Self::Mask => "mask",
            Self::Filter => "filter",
            Self::Script => "script or event handler",
            Self::Animation => "animation",
            Self::ExternalResource => "external resource",
            Self::Stylesheet => "stylesheet",
        })
    }
}

impl fmt::Display for SvgUnsupportedAction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Omitted => "omitted from native tree",
        })
    }
}

/// A non-fatal condition encountered while importing an SVG.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SvgImportWarning {
    /// An SVG element was skipped because it has no native mapping in this slice.
    UnsupportedElement {
        /// Element name.
        element: String,
        /// Source element ID, when present.
        source_id: Option<String>,
        /// Reason for skipping it.
        reason: String,
    },
    /// A named SVG feature is intentionally excluded from the static native tree.
    UnsupportedFeature {
        /// Unsupported SVG feature.
        feature: SvgUnsupportedFeature,
        /// Element name.
        element: String,
        /// Source element ID, when present.
        source_id: Option<String>,
        /// Action taken by the importer.
        action: SvgUnsupportedAction,
    },
    /// A paint value cannot be represented by native color properties.
    UnsupportedPaint {
        /// Element name.
        element: String,
        /// Paint property name.
        property: String,
        /// Original paint value.
        value: String,
    },
}

impl fmt::Display for SvgImportWarning {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedElement { element, source_id, reason } => {
                write!(formatter, "skipped SVG element <{element}>")?;
                if let Some(source_id) = source_id {
                    write!(formatter, " ({source_id})")?;
                }
                write!(formatter, ": {reason}")
            }
            Self::UnsupportedFeature { feature, element, source_id, action } => {
                write!(formatter, "skipped SVG {feature} on <{element}>")?;
                if let Some(source_id) = source_id {
                    write!(formatter, " ({source_id})")?;
                }
                write!(formatter, ": {action}")
            }
            Self::UnsupportedPaint { element, property, value } => {
                write!(formatter, "skipped SVG {property} paint on <{element}>: {value}")
            }
        }
    }
}

/// A failure at the SVG parsing or native mapping edge.
#[derive(Debug, Error, PartialEq)]
pub enum SvgImportError {
    /// The input exceeded the parser's input limit.
    #[error("SVG input exceeds the {limit}-byte limit")]
    InputTooLarge {
        /// Maximum accepted input size.
        limit: usize,
    },
    /// The input was not UTF-8.
    #[error("SVG input is not UTF-8: {0}")]
    InvalidUtf8(String),
    /// The XML document could not be parsed.
    #[error("SVG XML is invalid: {0}")]
    Xml(String),
    /// The document did not have an SVG root element.
    #[error("SVG document must have an <svg> root element")]
    MissingRoot,
    /// A numeric or style attribute could not be parsed.
    #[error("invalid SVG {attribute} on <{element}>: {value}")]
    InvalidAttribute {
        /// Element carrying the attribute.
        element: String,
        /// Attribute name.
        attribute: String,
        /// Invalid source value.
        value: String,
    },
    /// Path data could not be normalized into native segments.
    #[error("invalid SVG path on <{element}>: {message}")]
    InvalidPath {
        /// Element carrying the path.
        element: String,
        /// Normalization failure.
        message: String,
    },
    /// A transform cannot be represented by the native rotate/scale model.
    #[error("unsupported SVG transform on <{element}>: {message}")]
    UnsupportedTransform {
        /// Element carrying the transform.
        element: String,
        /// Transform limitation.
        message: String,
    },
    /// An embedded image data URL could not be decoded.
    #[error("invalid embedded SVG image on <{element}>: {message}")]
    InvalidImage {
        /// Element carrying the image.
        element: String,
        /// Image decoding failure.
        message: String,
    },
}

#[derive(Clone, Copy)]
enum Axis {
    Horizontal,
    Vertical,
}

/// A view box declared by the source SVG.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize, TS)]
pub struct SvgViewBox {
    /// Horizontal origin in SVG user units.
    pub x: f64,
    /// Vertical origin in SVG user units.
    pub y: f64,
    /// Width in SVG user units.
    pub width: f64,
    /// Height in SVG user units.
    pub height: f64,
}

/// A parsed SVG asset, either the original source or embedded raster data.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
pub struct SvgAsset {
    /// Deterministic asset identifier derived from the bytes.
    pub id: AssetId,
    /// Suggested source filename for the asset.
    pub name: String,
    /// IANA media type, such as `image/png`.
    pub media_type: String,
    /// Content digest including its algorithm prefix.
    pub digest: String,
    /// Embedded asset bytes.
    pub bytes: Vec<u8>,
}

impl SvgAsset {
    /// Converts the parsed asset into a document asset record.
    #[must_use]
    pub fn record(&self, actor_id: crate::ActorId, timestamp: Timestamp, source: Option<String>) -> AssetRecord {
        AssetRecord {
            id: self.id.clone(),
            name: self.name.clone(),
            media_type: self.media_type.clone(),
            digest: self.digest.clone(),
            source: AssetSource::Embedded { bytes: self.bytes.clone() },
            provenance: Provenance { actor_id, origin: crate::Origin::Human, timestamp, source },
            version: crate::RecordVersion(1),
        }
    }
}

/// One native shape produced by SVG mapping.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
pub struct SvgShape {
    /// The source element's `id`, when present.
    pub source_id: Option<String>,
    /// Native Inkfinite shape kind.
    pub kind: ShapeKind,
    /// Transform relative to the containing SVG group.
    pub transform: Transform,
    /// Kind-specific native properties.
    pub properties: ShapeProperties,
    /// Common native opacity values.
    pub style: ShapeStyle,
}

/// A parsed group mapped to a native container candidate.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
pub struct SvgGroup {
    /// The source group or root element's `id`, when present.
    pub source_id: Option<String>,
    /// Transform relative to the containing SVG group.
    pub transform: Transform,
    /// Container opacity values.
    pub style: ShapeStyle,
    /// Native container properties, including calculated width and height.
    pub properties: ShapeProperties,
    /// Ordered child nodes in SVG paint order.
    pub children: Vec<SvgImportNode>,
}

/// An image node referencing an extracted embedded raster asset.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
pub struct SvgImage {
    /// The source image element's `id`, when present.
    pub source_id: Option<String>,
    /// Extracted embedded asset.
    pub asset_id: AssetId,
    /// Transform relative to the containing SVG group.
    pub transform: Transform,
    /// Image properties, including width and height.
    pub properties: ShapeProperties,
    /// Image opacity values.
    pub style: ShapeStyle,
}

/// A normalized SVG node.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SvgImportNode {
    /// A group mapped to a container candidate.
    Group(Box<SvgGroup>),
    /// A native vector or text shape.
    Shape(SvgShape),
    /// An image backed by an extracted asset.
    Image(SvgImage),
}

impl SvgImportNode {
    /// Returns the source element ID, when one was supplied.
    #[must_use]
    pub fn source_id(&self) -> Option<&str> {
        match self {
            Self::Group(group) => group.source_id.as_deref(),
            Self::Shape(shape) => shape.source_id.as_deref(),
            Self::Image(image) => image.source_id.as_deref(),
        }
    }
}

/// A normalized SVG import result.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
pub struct SvgImport {
    /// Root view box, when the source declared one.
    pub view_box: Option<SvgViewBox>,
    /// Root group containing the source SVG's visual children.
    pub root: SvgGroup,
    /// The original source retained for provenance and future fallback or re-import.
    pub source_asset: SvgAsset,
    /// Embedded raster assets referenced by image nodes.
    pub assets: Vec<SvgAsset>,
    /// Non-fatal features skipped during parsing.
    pub warnings: Vec<SvgImportWarning>,
}

#[derive(Clone)]
struct SvgStyle {
    /// Computed CSS `color` used when a paint value is `currentColor`.
    color: String,
    fill: Option<String>,
    stroke: Option<String>,
    stroke_width: f64,
    fill_opacity: f32,
    stroke_opacity: f32,
    opacity: f32,
    fill_rule: PathFillRule,
    font_size: f64,
    font_family: String,
    visible: bool,
}

impl Default for SvgStyle {
    fn default() -> Self {
        Self {
            color: "#000000".into(),
            fill: Some("#000000".into()),
            stroke: None,
            stroke_width: 1.0,
            fill_opacity: 1.0,
            stroke_opacity: 1.0,
            opacity: 1.0,
            fill_rule: PathFillRule::NonZero,
            font_size: 16.0,
            font_family: "sans-serif".into(),
            visible: true,
        }
    }
}

impl SvgStyle {
    fn native_style(&self) -> Result<ShapeStyle, SvgImportError> {
        Ok(ShapeStyle {
            opacity: Opacity::new(self.opacity).map_err(|error| invalid_style("opacity", error.to_string()))?,
            fill_opacity: Some(
                Opacity::new(self.fill_opacity).map_err(|error| invalid_style("fill-opacity", error.to_string()))?,
            ),
            stroke_opacity: Some(
                Opacity::new(self.stroke_opacity)
                    .map_err(|error| invalid_style("stroke-opacity", error.to_string()))?,
            ),
        })
    }
}

struct ImportParser {
    assets: Vec<SvgAsset>,
    warnings: Vec<SvgImportWarning>,
    view_box: Option<SvgViewBox>,
}

impl ImportParser {
    fn children<'a, 'input>(
        &mut self, node: Node<'a, 'input>, parent_style: &SvgStyle,
    ) -> Result<Vec<SvgImportNode>, SvgImportError> {
        node.children()
            .filter(|child| child.is_element())
            .filter_map(|child| self.node(child, parent_style).transpose())
            .collect()
    }

    fn node<'a, 'input>(
        &mut self, node: Node<'a, 'input>, parent_style: &SvgStyle,
    ) -> Result<Option<SvgImportNode>, SvgImportError> {
        let element = local_name(node).to_owned();
        self.warn_event_handlers(node);
        let style = resolve_style(parent_style, node, &mut self.warnings)?;
        if !style.visible {
            return Ok(None);
        }
        let source_id = source_id(node);
        match element.as_str() {
            "g" => {
                let children = self.children(node, &style)?;
                let group = SvgGroup {
                    source_id,
                    transform: self.transform(node)?,
                    style: style.native_style()?,
                    properties: group_properties(&children),
                    children,
                };
                Ok(Some(SvgImportNode::Group(Box::new(group))))
            }
            "rect" => Ok(Some(SvgImportNode::Shape(self.rect(node, &style)?))),
            "circle" => Ok(Some(SvgImportNode::Shape(self.circle(node, &style)?))),
            "ellipse" => Ok(Some(SvgImportNode::Shape(self.ellipse(node, &style)?))),
            "line" => Ok(Some(SvgImportNode::Shape(self.line(node, &style)?))),
            "polygon" => Ok(Some(SvgImportNode::Shape(self.polyline(node, &style, true)?))),
            "polyline" => Ok(Some(SvgImportNode::Shape(self.polyline(node, &style, false)?))),
            "path" => Ok(Some(SvgImportNode::Shape(self.path(node, &style)?))),
            "text" => Ok(Some(SvgImportNode::Shape(self.text(node, &style)?))),
            "image" => self.image(node, &style).map(|image| image.map(SvgImportNode::Image)),
            "defs" => {
                self.warn_definition_features(node);
                Ok(None)
            }
            "metadata" | "title" | "desc" => Ok(None),
            "style" => {
                self.warn_feature(node, SvgUnsupportedFeature::Stylesheet, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            "linearGradient" | "radialGradient" | "meshgradient" => {
                self.warn_feature(node, SvgUnsupportedFeature::Gradient, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            "pattern" => {
                self.warn_feature(node, SvgUnsupportedFeature::Pattern, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            "clipPath" => {
                self.warn_feature(node, SvgUnsupportedFeature::ClipPath, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            "mask" => {
                self.warn_feature(node, SvgUnsupportedFeature::Mask, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            "filter" => {
                self.warn_feature(node, SvgUnsupportedFeature::Filter, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            "script" => {
                self.warn_feature(node, SvgUnsupportedFeature::Script, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            "animate" | "animateMotion" | "animateTransform" | "set" | "discard" => {
                self.warn_feature(node, SvgUnsupportedFeature::Animation, SvgUnsupportedAction::Omitted);
                Ok(None)
            }
            _ => {
                self.warn_unsupported(node, "no native mapping");
                Ok(None)
            }
        }
    }

    fn rect<'a, 'input>(&mut self, node: Node<'a, 'input>, style: &SvgStyle) -> Result<SvgShape, SvgImportError> {
        let x = self.length(node, "x", 0.0, Axis::Horizontal)?;
        let y = self.length(node, "y", 0.0, Axis::Vertical)?;
        let width = self.length(node, "width", 0.0, Axis::Horizontal)?;
        let height = self.length(node, "height", 0.0, Axis::Vertical)?;
        ensure_non_negative(node, "width", width)?;
        ensure_non_negative(node, "height", height)?;
        let rx = self.optional_length(node, "rx", Axis::Horizontal)?;
        let ry = self.optional_length(node, "ry", Axis::Vertical)?;
        if let Some(rx) = rx {
            ensure_non_negative(node, "rx", rx)?;
        }
        if let Some(ry) = ry {
            ensure_non_negative(node, "ry", ry)?;
        }
        let radius = rx.or(ry).unwrap_or(0.0);
        let transform = self.transformed_geometry(node, x, y)?;
        Ok(SvgShape {
            source_id: source_id(node),
            kind: ShapeKind::from(crate::RECTANGLE_KIND),
            transform,
            properties: properties([
                ("width", json!(width)),
                ("height", json!(height)),
                ("radius", json!(radius.min(width / 2.0).min(height / 2.0).max(0.0))),
                ("fill", paint_value(style.fill.clone())),
                ("stroke", paint_value(style.stroke.clone())),
            ]),
            style: style.native_style()?,
        })
    }

    fn circle<'a, 'input>(&mut self, node: Node<'a, 'input>, style: &SvgStyle) -> Result<SvgShape, SvgImportError> {
        let cx = self.length(node, "cx", 0.0, Axis::Horizontal)?;
        let cy = self.length(node, "cy", 0.0, Axis::Vertical)?;
        let radius = self.length(node, "r", 0.0, Axis::Horizontal)?;
        ensure_non_negative(node, "r", radius)?;
        let transform = self.transformed_geometry(node, cx - radius, cy - radius)?;
        Ok(SvgShape {
            source_id: source_id(node),
            kind: ShapeKind::from(crate::ELLIPSE_KIND),
            transform,
            properties: properties([
                ("width", json!(radius * 2.0)),
                ("height", json!(radius * 2.0)),
                ("fill", paint_value(style.fill.clone())),
                ("stroke", paint_value(style.stroke.clone())),
            ]),
            style: style.native_style()?,
        })
    }

    fn ellipse<'a, 'input>(&mut self, node: Node<'a, 'input>, style: &SvgStyle) -> Result<SvgShape, SvgImportError> {
        let cx = self.length(node, "cx", 0.0, Axis::Horizontal)?;
        let cy = self.length(node, "cy", 0.0, Axis::Vertical)?;
        let rx = self.length(node, "rx", 0.0, Axis::Horizontal)?;
        let ry = self.length(node, "ry", 0.0, Axis::Vertical)?;
        ensure_non_negative(node, "rx", rx)?;
        ensure_non_negative(node, "ry", ry)?;
        let transform = self.transformed_geometry(node, cx - rx, cy - ry)?;
        Ok(SvgShape {
            source_id: source_id(node),
            kind: ShapeKind::from(crate::ELLIPSE_KIND),
            transform,
            properties: properties([
                ("width", json!(rx * 2.0)),
                ("height", json!(ry * 2.0)),
                ("fill", paint_value(style.fill.clone())),
                ("stroke", paint_value(style.stroke.clone())),
            ]),
            style: style.native_style()?,
        })
    }

    fn line<'a, 'input>(&mut self, node: Node<'a, 'input>, style: &SvgStyle) -> Result<SvgShape, SvgImportError> {
        let x1 = self.length(node, "x1", 0.0, Axis::Horizontal)?;
        let y1 = self.length(node, "y1", 0.0, Axis::Vertical)?;
        let x2 = self.length(node, "x2", 0.0, Axis::Horizontal)?;
        let y2 = self.length(node, "y2", 0.0, Axis::Vertical)?;
        let transform = self.transformed_geometry(node, x1, y1)?;
        Ok(SvgShape {
            source_id: source_id(node),
            kind: ShapeKind::from(crate::LINE_KIND),
            transform,
            properties: properties([
                ("a", json!(Vec2 { x: 0.0, y: 0.0 })),
                ("b", json!(Vec2 { x: x2 - x1, y: y2 - y1 })),
                ("stroke", json!(style.stroke.clone().unwrap_or_else(|| "none".into()))),
                ("width", json!(style.stroke_width)),
            ]),
            style: style.native_style()?,
        })
    }

    fn polyline<'a, 'input>(
        &mut self, node: Node<'a, 'input>, style: &SvgStyle, closed: bool,
    ) -> Result<SvgShape, SvgImportError> {
        let value = node
            .attribute("points")
            .ok_or_else(|| invalid_attribute(node, "points", "missing"))?;
        let points = parse_number_pairs(value).map_err(|message| invalid_attribute(node, "points", message))?;
        let minimum = if closed { 3 } else { 2 };
        if points.len() < minimum {
            return Err(invalid_attribute(
                node,
                "points",
                format!("expected at least {minimum} points"),
            ));
        }
        let mut segments = vec![NativePathSegment::Move { to: points[0] }];
        segments.extend(points.iter().skip(1).copied().map(|to| NativePathSegment::Line { to }));
        let geometry = PathGeometry {
            subpaths: vec![PathSubpath { segments, closed, handle_modes: None }],
            fill_rule: style.fill_rule,
        };
        self.path_shape(node, style, &geometry, self.transform(node)?)
    }

    fn path<'a, 'input>(&mut self, node: Node<'a, 'input>, style: &SvgStyle) -> Result<SvgShape, SvgImportError> {
        let value = node
            .attribute("d")
            .ok_or_else(|| invalid_attribute(node, "d", "missing"))?;
        let geometry = normalize_path(value, style.fill_rule)
            .map_err(|message| SvgImportError::InvalidPath { element: local_name(node).into(), message })?;
        self.path_shape(node, style, &geometry, self.transform(node)?)
    }

    fn path_shape<'a, 'input>(
        &mut self, node: Node<'a, 'input>, style: &SvgStyle, geometry: &PathGeometry, transform: Transform,
    ) -> Result<SvgShape, SvgImportError> {
        crate::validate_path_geometry(geometry).map_err(|error| SvgImportError::InvalidPath {
            element: local_name(node).into(),
            message: error.to_string(),
        })?;
        let subpaths = serde_json::to_value(&geometry.subpaths).map_err(|error| SvgImportError::InvalidPath {
            element: local_name(node).into(),
            message: error.to_string(),
        })?;
        let fill_rule = serde_json::to_value(geometry.fill_rule).map_err(|error| SvgImportError::InvalidPath {
            element: local_name(node).into(),
            message: error.to_string(),
        })?;
        Ok(SvgShape {
            source_id: source_id(node),
            kind: ShapeKind::from(crate::PATH_KIND),
            transform,
            properties: properties([
                ("subpaths", subpaths),
                ("fill_rule", fill_rule),
                ("fill", paint_value(style.fill.clone())),
                ("stroke", paint_value(style.stroke.clone())),
                ("stroke_width", json!(style.stroke_width)),
            ]),
            style: style.native_style()?,
        })
    }

    fn text<'a, 'input>(&mut self, node: Node<'a, 'input>, style: &SvgStyle) -> Result<SvgShape, SvgImportError> {
        let x = self.first_length(node, "x", Axis::Horizontal)?;
        let y = self.first_length(node, "y", Axis::Vertical)?;
        let text = node
            .descendants()
            .filter(|descendant| descendant.is_text())
            .filter_map(|descendant| descendant.text())
            .collect::<String>();
        let color = style.fill.clone().unwrap_or_else(|| "none".into());
        let transform = self.transformed_geometry(node, x, y)?;
        Ok(SvgShape {
            source_id: source_id(node),
            kind: ShapeKind::from(crate::TEXT_KIND),
            transform,
            properties: properties([
                ("text", json!(text)),
                ("font_size", json!(style.font_size)),
                ("font_family", json!(style.font_family.clone())),
                ("color", json!(color)),
            ]),
            style: style.native_style()?,
        })
    }

    fn image<'a, 'input>(
        &mut self, node: Node<'a, 'input>, style: &SvgStyle,
    ) -> Result<Option<SvgImage>, SvgImportError> {
        let href = node
            .attribute("href")
            .or_else(|| node.attribute(("http://www.w3.org/1999/xlink", "href")))
            .ok_or_else(|| invalid_attribute(node, "href", "missing"))?;
        let Some((media_type, bytes)) = decode_raster_data_url(href)
            .map_err(|message| SvgImportError::InvalidImage { element: local_name(node).into(), message })?
        else {
            if !href.starts_with("data:") {
                self.warn_feature(
                    node,
                    SvgUnsupportedFeature::ExternalResource,
                    SvgUnsupportedAction::Omitted,
                );
            } else {
                self.warn_unsupported(node, "only embedded raster data URLs are imported");
            }
            return Ok(None);
        };
        let asset = make_asset(media_type, bytes, "image");
        let asset_id = asset.id.clone();
        if !self.assets.iter().any(|candidate| candidate.id == asset_id) {
            self.assets.push(asset);
        }
        let x = self.length(node, "x", 0.0, Axis::Horizontal)?;
        let y = self.length(node, "y", 0.0, Axis::Vertical)?;
        let width = self.length(node, "width", 0.0, Axis::Horizontal)?;
        let height = self.length(node, "height", 0.0, Axis::Vertical)?;
        ensure_non_negative(node, "width", width)?;
        ensure_non_negative(node, "height", height)?;
        Ok(Some(SvgImage {
            source_id: source_id(node),
            asset_id,
            transform: self.transformed_geometry(node, x, y)?,
            properties: properties([("width", json!(width)), ("height", json!(height))]),
            style: style.native_style()?,
        }))
    }

    fn transform<'a, 'input>(&self, node: Node<'a, 'input>) -> Result<Transform, SvgImportError> {
        let value = node.attribute("transform").unwrap_or("");
        let matrix = parse_transform(value)
            .map_err(|message| SvgImportError::UnsupportedTransform { element: local_name(node).into(), message })?;
        decompose_transform(matrix)
            .map_err(|message| SvgImportError::UnsupportedTransform { element: local_name(node).into(), message })
    }

    fn transformed_geometry<'a, 'input>(
        &self, node: Node<'a, 'input>, x: f64, y: f64,
    ) -> Result<Transform, SvgImportError> {
        let matrix = parse_transform(node.attribute("transform").unwrap_or(""))
            .map_err(|message| SvgImportError::UnsupportedTransform { element: local_name(node).into(), message })?
            .then(Affine { e: x, f: y, ..Affine::IDENTITY });
        decompose_transform(matrix)
            .map_err(|message| SvgImportError::UnsupportedTransform { element: local_name(node).into(), message })
    }

    fn length<'a, 'input>(
        &self, node: Node<'a, 'input>, attribute: &str, default: f64, axis: Axis,
    ) -> Result<f64, SvgImportError> {
        let Some(value) = node.attribute(attribute) else { return Ok(default) };
        let reference = self.view_box.map(|view_box| match axis {
            Axis::Horizontal => view_box.width,
            Axis::Vertical => view_box.height,
        });
        parse_length(value, reference).map_err(|_| invalid_attribute(node, attribute, value))
    }

    fn first_length<'a, 'input>(
        &self, node: Node<'a, 'input>, attribute: &str, axis: Axis,
    ) -> Result<f64, SvgImportError> {
        let value = node.attribute(attribute).unwrap_or("0");
        let first = value
            .split(|character: char| character.is_ascii_whitespace() || character == ',')
            .find(|part| !part.is_empty())
            .unwrap_or("0");
        let reference = self.view_box.map(|view_box| match axis {
            Axis::Horizontal => view_box.width,
            Axis::Vertical => view_box.height,
        });
        parse_length(first, reference).map_err(|_| invalid_attribute(node, attribute, value))
    }

    fn optional_length<'a, 'input>(
        &self, node: Node<'a, 'input>, attribute: &str, axis: Axis,
    ) -> Result<Option<f64>, SvgImportError> {
        let Some(value) = node.attribute(attribute) else { return Ok(None) };
        let reference = self.view_box.map(|view_box| match axis {
            Axis::Horizontal => view_box.width,
            Axis::Vertical => view_box.height,
        });
        parse_length(value, reference)
            .map(Some)
            .map_err(|_| invalid_attribute(node, attribute, value))
    }

    fn warn_unsupported<'a, 'input>(&mut self, node: Node<'a, 'input>, reason: &str) {
        self.warnings.push(SvgImportWarning::UnsupportedElement {
            element: local_name(node).into(),
            source_id: source_id(node),
            reason: reason.into(),
        });
    }

    fn warn_feature<'a, 'input>(
        &mut self, node: Node<'a, 'input>, feature: SvgUnsupportedFeature, action: SvgUnsupportedAction,
    ) {
        self.warnings.push(SvgImportWarning::UnsupportedFeature {
            feature,
            element: local_name(node).into(),
            source_id: source_id(node),
            action,
        });
    }

    fn warn_definition_features<'a, 'input>(&mut self, node: Node<'a, 'input>) {
        for descendant in node.descendants().filter(|descendant| descendant.is_element()) {
            self.warn_event_handlers(descendant);
            let feature = match local_name(descendant) {
                "linearGradient" | "radialGradient" | "meshgradient" => Some(SvgUnsupportedFeature::Gradient),
                "pattern" => Some(SvgUnsupportedFeature::Pattern),
                "clipPath" => Some(SvgUnsupportedFeature::ClipPath),
                "mask" => Some(SvgUnsupportedFeature::Mask),
                "filter" => Some(SvgUnsupportedFeature::Filter),
                "script" => Some(SvgUnsupportedFeature::Script),
                "animate" | "animateMotion" | "animateTransform" | "set" | "discard" => {
                    Some(SvgUnsupportedFeature::Animation)
                }
                "style" => Some(SvgUnsupportedFeature::Stylesheet),
                _ => None,
            };
            if let Some(feature) = feature {
                self.warn_feature(descendant, feature, SvgUnsupportedAction::Omitted);
            }
        }
    }

    fn warn_event_handlers<'a, 'input>(&mut self, node: Node<'a, 'input>) {
        for attribute in node.attributes() {
            let name = attribute.name().as_bytes();
            if name.len() >= 2 && name[0].eq_ignore_ascii_case(&b'o') && name[1].eq_ignore_ascii_case(&b'n') {
                self.warn_feature(node, SvgUnsupportedFeature::Script, SvgUnsupportedAction::Omitted);
            }
        }
    }
}

#[derive(Clone, Copy)]
struct SvgArc {
    rx: f64,
    ry: f64,
    x_axis_rotation: f64,
    large_arc: bool,
    sweep: bool,
}

/// Parses SVG text into normalized native mapping records.
///
/// The parser is static and does not resolve external resources. Supported
/// vector elements are mapped to native shape properties, groups retain local
/// transforms, simple text becomes a native text shape, embedded raster images
/// become [`SvgAsset`] records, and the original source is retained as an
/// `image/svg+xml` asset.
///
/// # Errors
///
/// Returns [`SvgImportError`] when XML, geometry, numeric attributes, or an
/// embedded image cannot be represented.
pub fn parse_svg(source: &str) -> Result<SvgImport, SvgImportError> {
    if source.len() > SVG_IMPORT_MAX_BYTES {
        return Err(SvgImportError::InputTooLarge { limit: SVG_IMPORT_MAX_BYTES });
    }
    let document = XmlDocument::parse(source).map_err(|error| SvgImportError::Xml(error.to_string()))?;
    let root = document.root_element();
    if local_name(root) != "svg" {
        return Err(SvgImportError::MissingRoot);
    }

    let view_box = root
        .attribute("viewBox")
        .map(|value| parse_view_box(value, "svg", "viewBox"))
        .transpose()?;
    let source_asset = make_source_asset(source.as_bytes());
    let mut parser = ImportParser { assets: Vec::new(), warnings: Vec::new(), view_box };
    parser.warn_event_handlers(root);
    let root_style = resolve_style(&SvgStyle::default(), root, &mut parser.warnings)?;
    let children = parser.children(root, &root_style)?;
    let root_transform = parser.transform(root)?;
    let root_group = SvgGroup {
        source_id: source_id(root),
        transform: root_transform,
        style: root_style.native_style()?,
        properties: group_properties(&children),
        children,
    };
    Ok(SvgImport { view_box, root: root_group, source_asset, assets: parser.assets, warnings: parser.warnings })
}

/// Imports SVG text or UTF-8 bytes through the shared SVG import edge.
///
/// This convenience entry point accepts both `&str` and byte slices so file,
/// desktop, and CLI callers can share the parser.
///
/// # Errors
///
/// Returns [`SvgImportError`] when [`parse_svg`] rejects the source.
pub fn import_svg(source: impl AsRef<[u8]>) -> Result<SvgImport, SvgImportError> {
    let bytes = source.as_ref();
    if bytes.len() > SVG_IMPORT_MAX_BYTES {
        return Err(SvgImportError::InputTooLarge { limit: SVG_IMPORT_MAX_BYTES });
    }
    let source = std::str::from_utf8(bytes).map_err(|error| SvgImportError::InvalidUtf8(error.to_string()))?;
    parse_svg(source)
}

fn resolve_style<'a, 'input>(
    parent: &SvgStyle, node: Node<'a, 'input>, warnings: &mut Vec<SvgImportWarning>,
) -> Result<SvgStyle, SvgImportError> {
    let mut style = parent.clone();
    style.opacity = 1.0;
    let mut declarations = BTreeMap::new();
    for attribute in node.attributes() {
        declarations.insert(attribute.name(), attribute.value());
    }
    if let Some(value) = node.attribute("style") {
        for declaration in value.split(';') {
            let Some((name, value)) = declaration.split_once(':') else { continue };
            declarations.insert(name.trim(), value.trim());
        }
    }
    for (name, value) in declarations {
        match name {
            "color" => {
                let value = value.trim();
                if !value.is_empty() {
                    style.color =
                        if value.eq_ignore_ascii_case("currentcolor") { parent.color.clone() } else { value.into() };
                }
            }
            "fill" => style.fill = parse_paint(value, "fill", node, warnings, &style.color),
            "stroke" => style.stroke = parse_paint(value, "stroke", node, warnings, &style.color),
            "stroke-width" => {
                style.stroke_width = parse_style_length(value, "stroke-width", node)?;
                if style.stroke_width < 0.0 {
                    return Err(invalid_attribute(node, "stroke-width", value));
                }
            }
            "fill-opacity" => style.fill_opacity = parse_opacity(value, "fill-opacity", node)?,
            "stroke-opacity" => style.stroke_opacity = parse_opacity(value, "stroke-opacity", node)?,
            "opacity" => style.opacity = parse_opacity(value, "opacity", node)?,
            "fill-rule" => {
                style.fill_rule = match value.trim() {
                    "nonzero" => PathFillRule::NonZero,
                    "evenodd" => PathFillRule::EvenOdd,
                    _ => return Err(invalid_attribute(node, "fill-rule", value)),
                }
            }
            "font-size" => {
                style.font_size = parse_style_length(value, "font-size", node)?;
                if style.font_size < 0.0 {
                    return Err(invalid_attribute(node, "font-size", value));
                }
            }
            "font-family" => style.font_family = first_font_family(value),
            "clip-path" if value.trim_start().starts_with("url(") => {
                warnings.push(SvgImportWarning::UnsupportedFeature {
                    feature: SvgUnsupportedFeature::ClipPath,
                    element: local_name(node).into(),
                    source_id: source_id(node),
                    action: SvgUnsupportedAction::Omitted,
                });
            }
            "mask" if value.trim_start().starts_with("url(") => {
                warnings.push(SvgImportWarning::UnsupportedFeature {
                    feature: SvgUnsupportedFeature::Mask,
                    element: local_name(node).into(),
                    source_id: source_id(node),
                    action: SvgUnsupportedAction::Omitted,
                });
            }
            "filter" if value.trim_start().starts_with("url(") => {
                warnings.push(SvgImportWarning::UnsupportedFeature {
                    feature: SvgUnsupportedFeature::Filter,
                    element: local_name(node).into(),
                    source_id: source_id(node),
                    action: SvgUnsupportedAction::Omitted,
                });
            }
            "display" if value.trim() == "none" => style.visible = false,
            "visibility" if matches!(value.trim(), "hidden" | "collapse") => style.visible = false,
            _ => {}
        }
    }
    Ok(style)
}

fn parse_paint<'a, 'input>(
    value: &str, property: &str, node: Node<'a, 'input>, warnings: &mut Vec<SvgImportWarning>, current_color: &str,
) -> Option<String> {
    let value = value.trim();
    if value.eq_ignore_ascii_case("none") || value.eq_ignore_ascii_case("transparent") {
        return None;
    }
    if value.starts_with("url(") {
        warnings.push(SvgImportWarning::UnsupportedPaint {
            element: local_name(node).into(),
            property: property.into(),
            value: value.into(),
        });
        return None;
    }
    if value.eq_ignore_ascii_case("currentcolor") {
        return Some(current_color.into());
    }
    (!value.is_empty()).then(|| value.into())
}

fn ensure_non_negative<'a, 'input>(node: Node<'a, 'input>, attribute: &str, value: f64) -> Result<(), SvgImportError> {
    (value >= 0.0)
        .then_some(())
        .ok_or_else(|| invalid_attribute(node, attribute, value.to_string()))
}

fn parse_style_length<'a, 'input>(value: &str, attribute: &str, node: Node<'a, 'input>) -> Result<f64, SvgImportError> {
    parse_length(value, None).map_err(|_| invalid_attribute(node, attribute, value))
}

fn parse_opacity<'a, 'input>(value: &str, attribute: &str, node: Node<'a, 'input>) -> Result<f32, SvgImportError> {
    let value = value.trim();
    let fraction = if let Some(value) = value.strip_suffix('%') {
        value.parse::<f32>().map(|value| value / 100.0)
    } else {
        value.parse::<f32>()
    };
    fraction
        .ok()
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(0.0, 1.0))
        .ok_or_else(|| invalid_attribute(node, attribute, value))
}

fn first_font_family(value: &str) -> String {
    value
        .split(',')
        .next()
        .map(str::trim)
        .unwrap_or("sans-serif")
        .trim_matches(['\'', '"'])
        .to_owned()
}

fn parse_length(value: &str, reference: Option<f64>) -> Result<f64, ()> {
    let value = value.trim();
    let (number, multiplier) = if let Some(value) = value.strip_suffix('%') {
        (value.parse::<f64>().map_err(|_| ())?, reference.ok_or(())? / 100.0)
    } else if let Some(value) = value.strip_suffix("px") {
        (value.parse::<f64>().map_err(|_| ())?, 1.0)
    } else if let Some(value) = value.strip_suffix("pt") {
        (value.parse::<f64>().map_err(|_| ())?, 96.0 / 72.0)
    } else if let Some(value) = value.strip_suffix("pc") {
        (value.parse::<f64>().map_err(|_| ())?, 16.0)
    } else if let Some(value) = value.strip_suffix("mm") {
        (value.parse::<f64>().map_err(|_| ())?, 96.0 / 25.4)
    } else if let Some(value) = value.strip_suffix("cm") {
        (value.parse::<f64>().map_err(|_| ())?, 96.0 / 2.54)
    } else if let Some(value) = value.strip_suffix("in") {
        (value.parse::<f64>().map_err(|_| ())?, 96.0)
    } else {
        (value.parse::<f64>().map_err(|_| ())?, 1.0)
    };
    let value = number * multiplier;
    value.is_finite().then_some(value).ok_or(())
}

fn parse_view_box(value: &str, element: &str, attribute: &str) -> Result<SvgViewBox, SvgImportError> {
    let values = parse_number_list(value).map_err(|_| invalid_attribute_name(element, attribute, value))?;
    if values.len() != 4 || values[2] <= 0.0 || values[3] <= 0.0 {
        return Err(invalid_attribute_name(element, attribute, value));
    }
    Ok(SvgViewBox { x: values[0], y: values[1], width: values[2], height: values[3] })
}

fn parse_number_pairs(value: &str) -> Result<Vec<Vec2>, String> {
    let values = parse_number_list(value).map_err(|_| "expected a list of finite coordinate pairs".to_owned())?;
    if values.len() % 2 != 0 {
        return Err("expected an even number of coordinates".into());
    }
    Ok(values
        .chunks_exact(2)
        .map(|pair| Vec2 { x: pair[0], y: pair[1] })
        .collect())
}

fn parse_number_list(value: &str) -> Result<Vec<f64>, ()> {
    let bytes = value.as_bytes();
    let mut index = 0;
    let mut values = Vec::new();
    while index < bytes.len() {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b',') {
            index += 1;
        }
        if index == bytes.len() {
            break;
        }
        let start = index;
        if matches!(bytes[index], b'+' | b'-') {
            index += 1;
        }
        let integer_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        let mut has_digit = index > integer_start;
        if index < bytes.len() && bytes[index] == b'.' {
            index += 1;
            let fraction_start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            has_digit |= index > fraction_start;
        }
        if !has_digit {
            return Err(());
        }
        if index < bytes.len() && matches!(bytes[index], b'e' | b'E') {
            index += 1;
            if index < bytes.len() && matches!(bytes[index], b'+' | b'-') {
                index += 1;
            }
            let exponent_start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            if exponent_start == index {
                return Err(());
            }
        }
        let number = value[start..index].parse::<f64>().map_err(|_| ())?;
        if !number.is_finite() {
            return Err(());
        }
        values.push(number);
    }
    Ok(values)
}

fn properties(entries: impl IntoIterator<Item = (&'static str, Value)>) -> ShapeProperties {
    entries.into_iter().map(|(key, value)| (key.into(), value)).collect()
}

fn paint_value(value: Option<String>) -> Value {
    value.map_or_else(|| Value::Null, Value::String)
}

fn invalid_attribute<'a, 'input>(node: Node<'a, 'input>, attribute: &str, value: impl Into<String>) -> SvgImportError {
    invalid_attribute_name(local_name(node), attribute, value)
}

fn invalid_attribute_name(element: &str, attribute: &str, value: impl Into<String>) -> SvgImportError {
    SvgImportError::InvalidAttribute { element: element.into(), attribute: attribute.into(), value: value.into() }
}

fn invalid_style(attribute: &str, value: impl Into<String>) -> SvgImportError {
    SvgImportError::InvalidAttribute { element: "style".into(), attribute: attribute.into(), value: value.into() }
}

fn local_name<'a, 'input>(node: Node<'a, 'input>) -> &'input str {
    node.tag_name().name()
}

fn source_id<'a, 'input>(node: Node<'a, 'input>) -> Option<String> {
    node.attribute("id")
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn group_properties(children: &[SvgImportNode]) -> ShapeProperties {
    let (mut max_x, mut max_y) = (0.0_f64, 0.0_f64);
    for child in children {
        let bounds = node_bounds(child);
        max_x = max_x.max(bounds.x + bounds.width);
        max_y = max_y.max(bounds.y + bounds.height);
    }
    properties([("width", json!(max_x.max(0.0))), ("height", json!(max_y.max(0.0)))])
}

fn node_bounds(node: &SvgImportNode) -> Bounds {
    match node {
        SvgImportNode::Group(group) => {
            let bounds = group.children.iter().map(node_bounds).reduce(union).unwrap_or(Bounds {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            });
            Affine::from_transform(group.transform).transform_bounds(bounds)
        }
        SvgImportNode::Shape(shape) => {
            let local = if shape.kind.as_str() == crate::PATH_KIND {
                crate::path_geometry_from_properties(&shape.properties)
                    .map(|geometry| path_bounds(&geometry))
                    .unwrap_or(Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 })
            } else {
                Bounds {
                    x: 0.0,
                    y: 0.0,
                    width: shape.properties.get("width").and_then(Value::as_f64).unwrap_or(0.0),
                    height: shape.properties.get("height").and_then(Value::as_f64).unwrap_or(0.0),
                }
            };
            Affine::from_transform(shape.transform).transform_bounds(local)
        }
        SvgImportNode::Image(image) => Affine::from_transform(image.transform).transform_bounds(Bounds {
            x: 0.0,
            y: 0.0,
            width: image.properties.get("width").and_then(Value::as_f64).unwrap_or(0.0),
            height: image.properties.get("height").and_then(Value::as_f64).unwrap_or(0.0),
        }),
    }
}

fn parse_transform(value: &str) -> Result<Affine, String> {
    let transform = svgtypes::Transform::from_str(value).map_err(|error| error.to_string())?;
    let matrix =
        Affine { a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f };
    if [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
        .into_iter()
        .all(f64::is_finite)
    {
        Ok(matrix)
    } else {
        Err("transform contains a non-finite number".into())
    }
}

fn decompose_transform(matrix: Affine) -> Result<Transform, String> {
    let scale_x = matrix.a.hypot(matrix.b);
    if scale_x <= f64::EPSILON {
        return Err("zero horizontal scale is not supported".into());
    }
    let determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    let scale_y = determinant / scale_x;
    if scale_y.abs() <= f64::EPSILON {
        return Err("zero vertical scale is not supported".into());
    }
    let rotation = matrix.b.atan2(matrix.a);
    let cos = rotation.cos();
    let sin = rotation.sin();
    let expected = [cos * scale_x, sin * scale_x, -sin * scale_y, cos * scale_y];
    let actual = [matrix.a, matrix.b, matrix.c, matrix.d];
    let tolerance = actual.into_iter().map(f64::abs).fold(1.0, f64::max) * 1e-8;
    if actual
        .into_iter()
        .zip(expected)
        .any(|(actual, expected)| (actual - expected).abs() > tolerance)
    {
        return Err("skewed affine matrices cannot be represented by native transforms".into());
    }
    Ok(Transform { translation: Vec2 { x: matrix.e, y: matrix.f }, rotation, scale_x, scale_y })
}

fn normalize_path(value: &str, fill_rule: PathFillRule) -> Result<PathGeometry, String> {
    let mut subpaths = Vec::new();
    let mut current = Vec2 { x: 0.0, y: 0.0 };
    let mut start = current;
    let mut previous_cubic_control = None;
    let mut previous_quadratic_control = None;
    let mut previous = PreviousSegment::Other;

    for segment in PathParser::from(value) {
        let segment = segment.map_err(|error| error.to_string())?;
        match segment {
            PathSegment::MoveTo { abs, x, y } => {
                current = point(abs, x, y, current);
                start = current;
                subpaths.push(PathSubpath {
                    segments: vec![NativePathSegment::Move { to: current }],
                    closed: false,
                    handle_modes: None,
                });
                previous_cubic_control = None;
                previous_quadratic_control = None;
                previous = PreviousSegment::Other;
            }
            PathSegment::LineTo { abs, x, y } => {
                ensure_open_subpath(&mut subpaths, current);
                current = point(abs, x, y, current);
                current_subpath(&mut subpaths)?
                    .segments
                    .push(NativePathSegment::Line { to: current });
                previous_cubic_control = None;
                previous_quadratic_control = None;
                previous = PreviousSegment::Other;
            }
            PathSegment::HorizontalLineTo { abs, x } => {
                ensure_open_subpath(&mut subpaths, current);
                current = Vec2 { x: if abs { x } else { current.x + x }, y: current.y };
                current_subpath(&mut subpaths)?
                    .segments
                    .push(NativePathSegment::Line { to: current });
                previous_cubic_control = None;
                previous_quadratic_control = None;
                previous = PreviousSegment::Other;
            }
            PathSegment::VerticalLineTo { abs, y } => {
                ensure_open_subpath(&mut subpaths, current);
                current = Vec2 { x: current.x, y: if abs { y } else { current.y + y } };
                current_subpath(&mut subpaths)?
                    .segments
                    .push(NativePathSegment::Line { to: current });
                previous_cubic_control = None;
                previous_quadratic_control = None;
                previous = PreviousSegment::Other;
            }
            PathSegment::CurveTo { abs, x1, y1, x2, y2, x, y } => {
                ensure_open_subpath(&mut subpaths, current);
                let control_1 = point(abs, x1, y1, current);
                let control_2 = point(abs, x2, y2, current);
                current = point(abs, x, y, current);
                current_subpath(&mut subpaths)?.segments.push(NativePathSegment::Cubic {
                    control_1,
                    control_2,
                    to: current,
                });
                previous_cubic_control = Some(control_2);
                previous_quadratic_control = None;
                previous = PreviousSegment::Cubic;
            }
            PathSegment::SmoothCurveTo { abs, x2, y2, x, y } => {
                ensure_open_subpath(&mut subpaths, current);
                let control_1 = if matches!(previous, PreviousSegment::Cubic) {
                    reflect(previous_cubic_control.unwrap_or(current), current)
                } else {
                    current
                };
                let control_2 = point(abs, x2, y2, current);
                current = point(abs, x, y, current);
                current_subpath(&mut subpaths)?.segments.push(NativePathSegment::Cubic {
                    control_1,
                    control_2,
                    to: current,
                });
                previous_cubic_control = Some(control_2);
                previous_quadratic_control = None;
                previous = PreviousSegment::Cubic;
            }
            PathSegment::Quadratic { abs, x1, y1, x, y } => {
                ensure_open_subpath(&mut subpaths, current);
                let control = point(abs, x1, y1, current);
                current = point(abs, x, y, current);
                current_subpath(&mut subpaths)?
                    .segments
                    .push(NativePathSegment::Quadratic { control, to: current });
                previous_cubic_control = None;
                previous_quadratic_control = Some(control);
                previous = PreviousSegment::Quadratic;
            }
            PathSegment::SmoothQuadratic { abs, x, y } => {
                ensure_open_subpath(&mut subpaths, current);
                let control = if matches!(previous, PreviousSegment::Quadratic) {
                    reflect(previous_quadratic_control.unwrap_or(current), current)
                } else {
                    current
                };
                current = point(abs, x, y, current);
                current_subpath(&mut subpaths)?
                    .segments
                    .push(NativePathSegment::Quadratic { control, to: current });
                previous_cubic_control = None;
                previous_quadratic_control = Some(control);
                previous = PreviousSegment::Quadratic;
            }
            PathSegment::EllipticalArc { abs, rx, ry, x_axis_rotation, large_arc, sweep, x, y } => {
                ensure_open_subpath(&mut subpaths, current);
                let end = point(abs, x, y, current);
                append_arc(
                    &mut current_subpath(&mut subpaths)?.segments,
                    current,
                    end,
                    SvgArc { rx, ry, x_axis_rotation, large_arc, sweep },
                );
                current = end;
                previous_cubic_control = None;
                previous_quadratic_control = None;
                previous = PreviousSegment::Other;
            }
            PathSegment::ClosePath { .. } => {
                let Some(subpath) = subpaths.last_mut() else {
                    return Err("close command appeared before a move command".into());
                };
                subpath.closed = true;
                current = start;
                previous_cubic_control = None;
                previous_quadratic_control = None;
                previous = PreviousSegment::Other;
            }
        }
    }
    if subpaths.is_empty() {
        return Err("path must contain at least one subpath".into());
    }
    Ok(PathGeometry { subpaths, fill_rule })
}

fn point(abs: bool, x: f64, y: f64, current: Vec2) -> Vec2 {
    if abs { Vec2 { x, y } } else { Vec2 { x: current.x + x, y: current.y + y } }
}

fn reflect(control: Vec2, around: Vec2) -> Vec2 {
    Vec2 { x: around.x * 2.0 - control.x, y: around.y * 2.0 - control.y }
}

fn ensure_open_subpath(subpaths: &mut Vec<PathSubpath>, current: Vec2) {
    if subpaths.last().is_none_or(|subpath| subpath.closed) {
        subpaths.push(PathSubpath {
            segments: vec![NativePathSegment::Move { to: current }],
            closed: false,
            handle_modes: None,
        });
    }
}

fn current_subpath(subpaths: &mut [PathSubpath]) -> Result<&mut PathSubpath, String> {
    subpaths
        .last_mut()
        .ok_or_else(|| "path command appeared before a move command".into())
}

fn append_arc(segments: &mut Vec<NativePathSegment>, start: Vec2, end: Vec2, arc: SvgArc) {
    let mut rx = arc.rx.abs();
    let mut ry = arc.ry.abs();
    if (start.x - end.x).abs() <= f64::EPSILON && (start.y - end.y).abs() <= f64::EPSILON {
        return;
    }
    if rx <= f64::EPSILON || ry <= f64::EPSILON {
        segments.push(NativePathSegment::Line { to: end });
        return;
    }
    let phi = arc.x_axis_rotation.to_radians();
    let (cos_phi, sin_phi) = (phi.cos(), phi.sin());
    let dx = (start.x - end.x) / 2.0;
    let dy = (start.y - end.y) / 2.0;
    let x_prime = cos_phi * dx + sin_phi * dy;
    let y_prime = -sin_phi * dx + cos_phi * dy;
    let radii_scale = (x_prime * x_prime / (rx * rx) + y_prime * y_prime / (ry * ry)).sqrt();
    if radii_scale > 1.0 {
        rx *= radii_scale;
        ry *= radii_scale;
    }
    let rx2 = rx * rx;
    let ry2 = ry * ry;
    let numerator = (rx2 * ry2 - rx2 * y_prime * y_prime - ry2 * x_prime * x_prime).max(0.0);
    let denominator = rx2 * y_prime * y_prime + ry2 * x_prime * x_prime;
    let coefficient = if denominator <= f64::EPSILON {
        0.0
    } else {
        let sign = if arc.large_arc == arc.sweep { -1.0 } else { 1.0 };
        sign * (numerator / denominator).sqrt()
    };
    let center_prime_x = coefficient * rx * y_prime / ry;
    let center_prime_y = coefficient * -ry * x_prime / rx;
    let center = Vec2 {
        x: cos_phi * center_prime_x - sin_phi * center_prime_y + (start.x + end.x) / 2.0,
        y: sin_phi * center_prime_x + cos_phi * center_prime_y + (start.y + end.y) / 2.0,
    };
    let unit_start = Vec2 { x: (x_prime - center_prime_x) / rx, y: (y_prime - center_prime_y) / ry };
    let unit_end = Vec2 { x: (-x_prime - center_prime_x) / rx, y: (-y_prime - center_prime_y) / ry };
    let mut delta = angle_between(unit_start, unit_end);
    if !arc.sweep && delta > 0.0 {
        delta -= std::f64::consts::TAU;
    } else if arc.sweep && delta < 0.0 {
        delta += std::f64::consts::TAU;
    }
    let count = ((delta.abs() / (std::f64::consts::FRAC_PI_2)).ceil() as usize).max(1);
    let step = delta / count as f64;
    for index in 0..count {
        let theta_start = angle_of(unit_start) + step * index as f64;
        let theta_end = theta_start + step;
        let alpha = 4.0 / 3.0 * (step / 4.0).tan();
        let first = ellipse_point(center, rx, ry, cos_phi, sin_phi, theta_start);
        let last = ellipse_point(center, rx, ry, cos_phi, sin_phi, theta_end);
        let first_tangent = ellipse_tangent(rx, ry, cos_phi, sin_phi, theta_start);
        let last_tangent = ellipse_tangent(rx, ry, cos_phi, sin_phi, theta_end);
        let control_1 = Vec2 { x: first.x + alpha * first_tangent.x, y: first.y + alpha * first_tangent.y };
        let control_2 = Vec2 { x: last.x - alpha * last_tangent.x, y: last.y - alpha * last_tangent.y };
        let to = if index + 1 == count { end } else { last };
        segments.push(NativePathSegment::Cubic { control_1, control_2, to });
    }
}

fn angle_of(point: Vec2) -> f64 {
    point.y.atan2(point.x)
}

fn angle_between(left: Vec2, right: Vec2) -> f64 {
    (left.x * right.y - left.y * right.x).atan2(left.x * right.x + left.y * right.y)
}

fn ellipse_point(center: Vec2, rx: f64, ry: f64, cos_phi: f64, sin_phi: f64, theta: f64) -> Vec2 {
    let (cos_theta, sin_theta) = (theta.cos(), theta.sin());
    Vec2 {
        x: center.x + rx * cos_phi * cos_theta - ry * sin_phi * sin_theta,
        y: center.y + rx * sin_phi * cos_theta + ry * cos_phi * sin_theta,
    }
}

fn ellipse_tangent(rx: f64, ry: f64, cos_phi: f64, sin_phi: f64, theta: f64) -> Vec2 {
    let (cos_theta, sin_theta) = (theta.cos(), theta.sin());
    Vec2 {
        x: -rx * cos_phi * sin_theta - ry * sin_phi * cos_theta,
        y: -rx * sin_phi * sin_theta + ry * cos_phi * cos_theta,
    }
}

fn decode_raster_data_url(value: &str) -> Result<Option<(String, Vec<u8>)>, String> {
    let Some(value) = value.strip_prefix("data:") else { return Ok(None) };
    let Some((metadata, data)) = value.split_once(',') else {
        return Err("data URL has no payload".into());
    };
    let mut parts = metadata.split(';');
    let media_type = parts
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("text/plain")
        .to_ascii_lowercase();
    if !matches!(
        media_type.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return Ok(None);
    }
    let bytes = if parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        BASE64.decode(data.as_bytes()).map_err(|error| error.to_string())?
    } else {
        percent_decode(data)?
    };
    Ok(Some((media_type, bytes)))
}

fn percent_decode(value: &str) -> Result<Vec<u8>, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("truncated percent escape".into());
            }
            let high = hex_digit(bytes[index + 1]).ok_or_else(|| "invalid percent escape".to_owned())?;
            let low = hex_digit(bytes[index + 2]).ok_or_else(|| "invalid percent escape".to_owned())?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    Ok(decoded)
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn make_source_asset(bytes: &[u8]) -> SvgAsset {
    make_asset("image/svg+xml".into(), bytes.to_vec(), "source")
}

fn make_asset(media_type: String, bytes: Vec<u8>, prefix: &str) -> SvgAsset {
    let digest_bytes = Sha256::digest(&bytes);
    let hex = digest_bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let extension = match media_type.as_str() {
        "image/svg+xml" => "svg",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    };
    SvgAsset {
        id: AssetId::from(format!("asset:sha256-{hex}")),
        name: format!("{prefix}-{hex}.{extension}"),
        media_type,
        digest: format!("sha256:{hex}"),
        bytes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(import: &SvgImport, index: usize) -> &SvgShape {
        match &import.root.children[index] {
            SvgImportNode::Shape(shape) => shape,
            other => panic!("expected shape, got {other:?}"),
        }
    }

    #[test]
    fn imports_primitives_groups_styles_and_nested_transforms() {
        let import = parse_svg(
            r##"<svg viewBox="0 0 200 100" fill="#123456" opacity=".9">
                <g id="outer" transform="translate(10 20)" fill-opacity=".5">
                    <g id="inner" transform="rotate(90)">
                        <rect id="box" x="2" y="3" width="20" height="10" rx="4" stroke="#abcdef" stroke-width="3"/>
                        <circle id="dot" cx="50" cy="10" r="5"/>
                        <ellipse cx="80" cy="10" rx="10" ry="4"/>
                        <line x1="0" y1="0" x2="10" y2="10" stroke="red"/>
                    </g>
                </g>
            </svg>"##,
        )
        .expect("SVG should import");
        assert_eq!(
            import.view_box,
            Some(SvgViewBox { x: 0.0, y: 0.0, width: 200.0, height: 100.0 })
        );
        let SvgImportNode::Group(outer) = &import.root.children[0] else { panic!("outer group") };
        assert_eq!(outer.source_id.as_deref(), Some("outer"));
        assert_eq!(outer.transform.translation, Vec2 { x: 10.0, y: 20.0 });
        let SvgImportNode::Group(inner) = &outer.children[0] else { panic!("inner group") };
        assert!((inner.transform.rotation - std::f64::consts::FRAC_PI_2).abs() < 1e-10);
        assert_eq!(inner.children.len(), 4);
        assert_eq!(inner.children[0].source_id(), Some("box"));
        let SvgImportNode::Shape(rect) = &inner.children[0] else { panic!("rect") };
        assert_eq!(rect.kind.as_str(), crate::RECTANGLE_KIND);
        assert_eq!(rect.properties["width"], json!(20.0));
        assert_eq!(rect.properties["fill"], json!("#123456"));
        assert_eq!(rect.properties["stroke"], json!("#abcdef"));
        assert_eq!(rect.style.fill_opacity, Some(Opacity::new(0.5).expect("opacity")));
    }

    #[test]
    fn normalizes_path_commands_arcs_and_compound_subpaths() {
        let import = parse_svg(
            r#"<svg><path fill-rule="evenodd" d="M0 0 h10 v10 q5 5 10 0 t10 0 c1 2 3 4 5 6 s7 8 9 10 a4 4 0 0 1 8 0 z M30 30 l5 5"/></svg>"#,
        )
        .expect("path should import");
        let path = shape(&import, 0);
        let geometry = crate::path_geometry_from_properties(&path.properties).expect("native geometry");
        assert_eq!(geometry.fill_rule, PathFillRule::EvenOdd);
        assert_eq!(geometry.subpaths.len(), 2);
        assert!(geometry.subpaths[0].closed);
        assert!(
            geometry.subpaths[0]
                .segments
                .iter()
                .any(|segment| matches!(segment, NativePathSegment::Cubic { .. }))
        );
        assert_eq!(geometry.subpaths[1].segments.len(), 2);
    }

    #[test]
    fn imports_polygon_and_polyline_as_native_paths() {
        let import =
            parse_svg(r#"<svg><polygon points="0,0 10,0 10,10"/><polyline points="20 20,30 20,30 30"/></svg>"#)
                .expect("polygons should import");
        let polygon = shape(&import, 0);
        let polyline = shape(&import, 1);
        assert_eq!(polygon.kind.as_str(), crate::PATH_KIND);
        assert_eq!(polyline.kind.as_str(), crate::PATH_KIND);
        assert!(
            crate::path_geometry_from_properties(&polygon.properties)
                .unwrap()
                .subpaths[0]
                .closed
        );
        assert!(
            !crate::path_geometry_from_properties(&polyline.properties)
                .unwrap()
                .subpaths[0]
                .closed
        );
    }

    #[test]
    fn text_is_flattened_to_a_native_text_shape() {
        let import = parse_svg(r#"<svg><text x="12" y="24" font-size="20" font-family="Inter, sans-serif">Hello <tspan>world</tspan></text></svg>"#)
            .expect("text should import");
        let text = shape(&import, 0);
        assert_eq!(text.kind.as_str(), crate::TEXT_KIND);
        assert_eq!(text.transform.translation, Vec2 { x: 12.0, y: 24.0 });
        assert_eq!(text.properties["text"], json!("Hello world"));
        assert_eq!(text.properties["font_family"], json!("Inter"));
    }

    #[test]
    fn retains_original_source_as_a_content_addressed_asset() {
        let source = r#"<svg onload="alert(1)"><rect width="10" height="20"/></svg>"#;
        let import = parse_svg(source).expect("SVG should import");

        assert_eq!(import.source_asset.media_type, "image/svg+xml");
        assert_eq!(import.source_asset.bytes, source.as_bytes());
        assert_eq!(
            import.source_asset.name,
            format!("source-{}.svg", &import.source_asset.digest[7..])
        );
        assert_eq!(
            import.source_asset.id.as_str(),
            format!("asset:sha256-{}", &import.source_asset.digest[7..])
        );
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::Script, .. }
        )));
    }

    #[test]
    fn extracts_and_deduplicates_embedded_raster_assets() {
        let source = base64::engine::general_purpose::STANDARD.encode([137_u8, 80, 78, 71]);
        let svg = format!(
            r#"<svg><image id="one" href="data:image/png;base64,{source}" width="10" height="20"/><image id="two" href="data:image/png;base64,{source}"/></svg>"#
        );
        let import = parse_svg(&svg).expect("embedded images should import");
        assert_eq!(import.assets.len(), 1);
        assert_eq!(import.assets[0].digest.len(), 71);
        assert!(matches!(import.root.children[0], SvgImportNode::Image(_)));
        assert!(matches!(import.root.children[1], SvgImportNode::Image(_)));
        let SvgImportNode::Image(first) = &import.root.children[0] else { unreachable!() };
        let SvgImportNode::Image(second) = &import.root.children[1] else { unreachable!() };
        assert_eq!(first.asset_id, second.asset_id);
    }

    #[test]
    fn rejects_malformed_paths_transforms_and_xml() {
        assert!(matches!(
            parse_svg("<svg><path d=\"M0\"/></svg>"),
            Err(SvgImportError::InvalidPath { .. })
        ));
        assert!(matches!(
            parse_svg("<svg><rect transform=\"skewX(20)\"/></svg>"),
            Err(SvgImportError::UnsupportedTransform { .. })
        ));
        assert!(matches!(parse_svg("<svg>"), Err(SvgImportError::Xml(_))));
        assert!(matches!(parse_svg("<html/>"), Err(SvgImportError::MissingRoot)));
    }

    #[test]
    fn reports_unsupported_features_without_executing_or_fetching_them() {
        let import = parse_svg(
            r##"<svg onload="alert(1)">
                <defs>
                    <linearGradient id="gradient"/>
                    <clipPath id="clip"/>
                    <mask id="mask"/>
                    <filter id="filter"/>
                </defs>
                <script>alert(1)</script>
                <animate attributeName="x"/>
                <image href="https://example.com/a.png"/>
                <path clip-path="url(#clip)" mask="url(#mask)" filter="url(#filter)" fill="url(#gradient)" d="M0 0L1 1"/>
            </svg>"##,
        )
        .expect("unsupported content should be reported");
        assert_eq!(import.root.children.len(), 1);
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::Gradient, .. }
        )));
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::ClipPath, .. }
        )));
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::Mask, .. }
        )));
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::Filter, .. }
        )));
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::Script, .. }
        )));
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::Animation, .. }
        )));
        assert!(import.warnings.iter().any(|warning| matches!(
            warning,
            SvgImportWarning::UnsupportedFeature { feature: SvgUnsupportedFeature::ExternalResource, .. }
        )));
        assert!(
            import
                .warnings
                .iter()
                .any(|warning| matches!(warning, SvgImportWarning::UnsupportedPaint { .. }))
        );
    }
}
