//! Deterministic, platform-independent SVG rendering.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

use crate::engine::geometry::{
    Affine, bounds_from_points, intersects, stroke_outline as canonical_stroke_outline, union, world_transform,
};
use crate::proto::Bounds;
use crate::{
    AssetId, AssetSource, BindingAnchor, BuiltinShapeKind, Document, DocumentSnapshot, LayerId, PageId, PathFillRule,
    PathGeometry, PathSegment, PathSubpath, ShapeId, ShapeRecord, Vec2,
};

const DEFAULT_PADDING: f64 = 20.0;
const EMPTY_SIZE: f64 = 100.0;
const FALLBACK_FONT: &str = "sans-serif";

/// Filters and resources used for one SVG projection.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SvgRenderOptions {
    /// Page to render. The document's first page is used when omitted.
    pub page_id: Option<PageId>,
    /// Layers to include. An empty set includes every visible layer on the page.
    pub layer_ids: BTreeSet<LayerId>,
    /// Shapes to include. Selecting a container includes its descendants.
    pub selection: BTreeSet<ShapeId>,
    /// Region to include and use as the exact SVG view box.
    pub region: Option<Bounds>,
    /// Font families supplied by the caller in addition to SVG generic families.
    pub available_font_families: BTreeSet<String>,
    /// External assets that the caller has resolved and made available.
    pub available_asset_ids: BTreeSet<AssetId>,
}

/// A deterministic SVG projection and any non-fatal fallback diagnostics.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SvgRenderOutput {
    /// Complete UTF-8 SVG document.
    pub svg: String,
    /// Stable, deduplicated warnings in lexical order.
    pub warnings: Vec<SvgRenderWarning>,
}

/// A deterministic fallback used while rendering a valid snapshot.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum SvgRenderWarning {
    /// A requested font was replaced with the built-in generic fallback.
    MissingFont {
        /// Shape that requested the unavailable family.
        shape_id: ShapeId,
        /// Requested CSS font family.
        requested: String,
        /// Deterministic family written to the SVG.
        fallback: String,
    },
    /// A shape referred to an asset that the document or caller could not supply.
    MissingAsset {
        /// Shape containing the reference.
        shape_id: ShapeId,
        /// Referenced asset ID.
        asset_id: AssetId,
    },
    /// An external asset exists but was not resolved by the headless caller.
    UnresolvedExternalAsset {
        /// Shape containing the reference.
        shape_id: ShapeId,
        /// Referenced asset ID.
        asset_id: AssetId,
    },
}

impl std::fmt::Display for SvgRenderWarning {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingFont { shape_id, requested, fallback } => {
                write!(
                    formatter,
                    "shape {shape_id} requested unavailable font {requested}; using {fallback}"
                )
            }
            Self::MissingAsset { shape_id, asset_id } => {
                write!(formatter, "shape {shape_id} references missing asset {asset_id}")
            }
            Self::UnresolvedExternalAsset { shape_id, asset_id } => {
                write!(
                    formatter,
                    "shape {shape_id} references unresolved external asset {asset_id}"
                )
            }
        }
    }
}

/// Failure to produce an SVG projection from a snapshot.
#[derive(Clone, Debug, Error, PartialEq)]
pub enum SvgRenderError {
    /// The requested page is absent from the snapshot.
    #[error("page {page_id} does not exist")]
    PageNotFound { page_id: PageId },
    /// A render region contains non-finite or negative dimensions.
    #[error("render region must contain finite coordinates and non-negative dimensions")]
    InvalidRegion,
    /// A built-in shape has properties that its renderer cannot decode.
    #[error("shape {shape_id} ({kind}) has invalid rendering properties: {message}")]
    InvalidShapeProperties {
        /// Shape that could not be rendered.
        shape_id: ShapeId,
        /// Built-in registry key.
        kind: String,
        /// Property decoding error.
        message: String,
    },
}

struct Renderer<'a> {
    document: &'a Document,
    options: &'a SvgRenderOptions,
    warnings: BTreeSet<SvgRenderWarning>,
    font_faces: BTreeMap<String, (String, Vec<u8>)>,
    rendered_bounds: Option<Bounds>,
    body: String,
}

impl Renderer<'_> {
    fn render_shape(
        &mut self, shape_id: &ShapeId, parent_matrix: Affine, ancestor_selected: bool, output: &mut String,
    ) -> Result<(), SvgRenderError> {
        let Some(shape) = self.document.shapes.get(shape_id) else {
            return Ok(());
        };
        let selected = ancestor_selected || self.options.selection.contains(shape_id);
        if !self.options.selection.is_empty()
            && !selected
            && !contains_selected_descendant(self.document, shape, &self.options.selection)
        {
            return Ok(());
        }

        let matrix = parent_matrix.then(Affine::from_transform(shape.transform));
        let local_bounds = shape_local_bounds(shape)?;
        let world_bounds = matrix.transform_bounds(local_bounds);
        let intersects_region = self
            .options
            .region
            .is_none_or(|region| intersects(&region, &world_bounds));
        let render_self = (self.options.selection.is_empty() || selected) && intersects_region;

        let mut inner = String::new();
        if render_self {
            self.inspect_resources(shape);
            self.rendered_bounds = Some(
                self.rendered_bounds
                    .map_or(world_bounds, |current| union(current, world_bounds)),
            );
            inner = self.shape_element(shape, matrix)?;
        }
        for child_id in &shape.child_ids {
            self.render_shape(child_id, matrix, selected, &mut inner)?;
        }
        if inner.is_empty() {
            return Ok(());
        }
        writeln!(
            output,
            "    <g data-shape-id=\"{}\" opacity=\"{}\">",
            escape_xml(shape.id.as_str()),
            number(f64::from(shape.style.opacity.get()))
        )
        .expect("writing to a String cannot fail");
        output.push_str(&inner);
        output.push_str("    </g>\n");
        Ok(())
    }

    fn shape_element(&mut self, shape: &ShapeRecord, matrix: Affine) -> Result<String, SvgRenderError> {
        let transform = affine_svg(matrix);
        let fill_opacity = number(f64::from(
            shape.style.fill_opacity.unwrap_or(crate::Opacity::OPAQUE).get(),
        ));
        let stroke_opacity = number(f64::from(
            shape.style.stroke_opacity.unwrap_or(crate::Opacity::OPAQUE).get(),
        ));
        let mut output = String::new();
        match BuiltinShapeKind::parse(shape.kind.as_str()) {
            Some(BuiltinShapeKind::Rectangle) => {
                let props: BoxProps = properties(shape)?;
                writeln!(
                    output,
                    "      <rect transform=\"{transform}\" width=\"{}\" height=\"{}\" rx=\"{}\" fill=\"{}\" fill-opacity=\"{fill_opacity}\" stroke=\"{}\" stroke-opacity=\"{stroke_opacity}\" stroke-width=\"2\"/>",
                    number(props.width), number(props.height), number(props.radius.min(props.width / 2.0).min(props.height / 2.0).max(0.0)),
                    paint(props.fill.as_deref()), paint(props.stroke.as_deref())
                ).expect("writing to a String cannot fail");
            }
            Some(BuiltinShapeKind::Container) => {
                let props: ContainerProps = properties(shape)?;
                if props.width > 0.0 || props.height > 0.0 || props.fill.is_some() || props.stroke.is_some() {
                    writeln!(
                        output,
                        "      <rect transform=\"{transform}\" width=\"{}\" height=\"{}\" rx=\"{}\" fill=\"{}\" fill-opacity=\"{fill_opacity}\" stroke=\"{}\" stroke-opacity=\"{stroke_opacity}\" stroke-width=\"2\"/>",
                        number(props.width), number(props.height), number(props.radius.min(props.width / 2.0).min(props.height / 2.0).max(0.0)),
                        paint(props.fill.as_deref()), paint(props.stroke.as_deref())
                    ).expect("writing to a String cannot fail");
                }
            }
            Some(BuiltinShapeKind::Ellipse) => {
                let props: BoxProps = properties(shape)?;
                writeln!(
                    output,
                    "      <ellipse transform=\"{transform}\" cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\" fill=\"{}\" fill-opacity=\"{fill_opacity}\" stroke=\"{}\" stroke-opacity=\"{stroke_opacity}\" stroke-width=\"2\"/>",
                    number(props.width / 2.0), number(props.height / 2.0), number(props.width / 2.0), number(props.height / 2.0),
                    paint(props.fill.as_deref()), paint(props.stroke.as_deref())
                ).expect("writing to a String cannot fail");
            }
            Some(BuiltinShapeKind::Line) => {
                let props: LineProps = properties(shape)?;
                writeln!(
                    output,
                    "      <line transform=\"{transform}\" x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" fill=\"none\" stroke=\"{}\" stroke-opacity=\"{stroke_opacity}\" stroke-width=\"{}\"/>",
                    number(props.a.x), number(props.a.y), number(props.b.x), number(props.b.y), escape_xml(&props.stroke), number(props.width)
                ).expect("writing to a String cannot fail");
            }
            Some(BuiltinShapeKind::Arrow) => {
                self.render_arrow(shape, matrix, &transform, &stroke_opacity, &fill_opacity, &mut output)?;
            }
            Some(BuiltinShapeKind::Text) => self.render_text(shape, &transform, &fill_opacity, &mut output)?,
            Some(BuiltinShapeKind::Markdown) => {
                self.render_markdown(shape, &transform, &fill_opacity, &stroke_opacity, &mut output)?;
            }
            Some(BuiltinShapeKind::Stroke) => {
                let props: StrokePaintProperties = properties(shape)?;
                let outline = canonical_stroke_outline(&shape.properties).map_err(|message| {
                    SvgRenderError::InvalidShapeProperties {
                        shape_id: shape.id.clone(),
                        kind: shape.kind.to_string(),
                        message,
                    }
                })?;
                if !outline.is_empty() {
                    let path = outline
                        .iter()
                        .enumerate()
                        .map(|(index, point)| {
                            format!(
                                "{} {} {}",
                                if index == 0 { "M" } else { "L" },
                                number(point.x),
                                number(point.y)
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                    let opacity = shape
                        .style
                        .stroke_opacity
                        .map_or(props.style.opacity, |value| f64::from(value.get()));
                    writeln!(
                        output,
                        "      <path transform=\"{transform}\" d=\"{path} Z\" fill=\"{}\" fill-opacity=\"{}\" stroke=\"none\"/>",
                        escape_xml(&props.style.color), number(opacity)
                    ).expect("writing to a String cannot fail");
                }
            }
            Some(BuiltinShapeKind::Path) => {
                let props: PathProps = properties(shape)?;
                let geometry = PathGeometry { subpaths: props.subpaths, fill_rule: props.fill_rule };
                crate::validate_path_geometry(&geometry).map_err(|error| SvgRenderError::InvalidShapeProperties {
                    shape_id: shape.id.clone(),
                    kind: shape.kind.to_string(),
                    message: error.to_string(),
                })?;
                writeln!(
                    output,
                    "      <path transform=\"{transform}\" d=\"{}\" fill=\"{}\" fill-rule=\"{}\" fill-opacity=\"{fill_opacity}\" stroke=\"{}\" stroke-opacity=\"{stroke_opacity}\" stroke-width=\"{}\"/>",
                    path_data(&geometry),
                    paint(props.fill.as_deref()),
                    path_fill_rule(props.fill_rule),
                    paint(props.stroke.as_deref()),
                    number(props.stroke_width.unwrap_or(2.0).max(0.0)),
                )
                .expect("writing to a String cannot fail");
            }
            None => {}
        }
        Ok(output)
    }

    fn render_arrow(
        &self, shape: &ShapeRecord, matrix: Affine, transform: &str, stroke_opacity: &str, fill_opacity: &str,
        output: &mut String,
    ) -> Result<(), SvgRenderError> {
        let props: ArrowProps = properties(shape)?;
        if props.points.len() < 2 {
            return Ok(());
        }
        let mut points = props.points.clone();
        let inverse = matrix.inverse();
        for binding in self
            .document
            .bindings
            .values()
            .filter(|binding| binding.source_shape_id == shape.id)
        {
            let Some(target) = self.document.shapes.get(&binding.target_shape_id) else { continue };
            let target_bounds = render_shape_world_bounds(self.document, target)?;
            let point = binding_point(target_bounds, binding.anchor, props.style.width);
            let local = inverse.map_or(point, |inverse| inverse.point(point));
            if binding.source_handle == "start" {
                points[0] = local;
            } else if binding.source_handle == "end" {
                let last = points.len() - 1;
                points[last] = local;
            }
        }
        if props
            .routing
            .as_ref()
            .is_some_and(|routing| routing.kind == "orthogonal")
        {
            points = orthogonal(points[0], points[points.len() - 1]);
        }
        let path = points
            .iter()
            .enumerate()
            .map(|(index, point)| {
                format!(
                    "{} {} {}",
                    if index == 0 { "M" } else { "L" },
                    number(point.x),
                    number(point.y)
                )
            })
            .collect::<Vec<_>>()
            .join(" ");
        let dash = props
            .style
            .dash
            .as_ref()
            .filter(|dash| !dash.is_empty())
            .map(|dash| {
                format!(
                    " stroke-dasharray=\"{}\"",
                    dash.iter().map(|value| number(*value)).collect::<Vec<_>>().join(" ")
                )
            })
            .unwrap_or_default();
        writeln!(output, "      <path transform=\"{transform}\" d=\"{path}\" fill=\"none\" stroke=\"{}\" stroke-opacity=\"{stroke_opacity}\" stroke-width=\"{}\"{dash}/>", escape_xml(&props.style.stroke), number(props.style.width)).expect("writing to a String cannot fail");
        if props.style.head_end.unwrap_or(true) {
            arrow_head(
                output,
                transform,
                points[points.len() - 2],
                points[points.len() - 1],
                &props.style,
                stroke_opacity,
            );
        }
        if props.style.head_start.unwrap_or(false) {
            arrow_head(output, transform, points[1], points[0], &props.style, stroke_opacity);
        }
        if let Some(label) = props.label.filter(|label| !label.text.is_empty()) {
            let distance = match label.align.as_str() {
                "start" => label.offset,
                "end" => polyline_length(&points) - label.offset,
                _ => polyline_length(&points) / 2.0 + label.offset,
            };
            let at = point_at_distance(&points, distance);
            let label_width = deterministic_text_width(&label.text, 14.0) + 8.0;
            writeln!(output, "      <g transform=\"{transform}\" fill-opacity=\"{fill_opacity}\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"18\" fill=\"#ffffff\" fill-opacity=\"0.9\" stroke=\"#cccccc\"/><text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"14\" fill=\"#000000\">{}</text></g>", number(at.x - label_width / 2.0), number(at.y - 23.0), number(label_width), number(at.x), number(at.y - 7.0), escape_xml(&label.text)).expect("writing to a String cannot fail");
        }
        Ok(())
    }

    fn render_text(
        &mut self, shape: &ShapeRecord, transform: &str, fill_opacity: &str, output: &mut String,
    ) -> Result<(), SvgRenderError> {
        let props: TextProps = properties(shape)?;
        let font = self.font(shape, &props.font_family);
        let lines = props.width.map_or_else(
            || vec![props.text.clone()],
            |width| wrap_text(&props.text, width, props.font_size),
        );
        writeln!(output, "      <text transform=\"{transform}\" font-family=\"{}\" font-size=\"{}\" fill=\"{}\" fill-opacity=\"{fill_opacity}\" dominant-baseline=\"text-before-edge\">", escape_xml(font), number(props.font_size), escape_xml(&props.color)).expect("writing to a String cannot fail");
        let mut y = 0.0;
        for line in &lines {
            writeln!(
                output,
                "        <tspan x=\"0\" y=\"{}\">{}</tspan>",
                number(y),
                escape_xml(line)
            )
            .expect("writing to a String cannot fail");
            y += props.font_size * 1.2;
        }
        output.push_str("      </text>\n");
        Ok(())
    }

    fn render_markdown(
        &mut self, shape: &ShapeRecord, transform: &str, fill_opacity: &str, stroke_opacity: &str, output: &mut String,
    ) -> Result<(), SvgRenderError> {
        let props: MarkdownProps = properties(shape)?;
        let height = props.height.unwrap_or(props.font_size * 10.0);
        let font = self.font(shape, &props.font_family).to_owned();
        writeln!(output, "      <g transform=\"{transform}\">").expect("writing to a String cannot fail");
        writeln!(output, "        <rect width=\"{}\" height=\"{}\" fill=\"{}\" fill-opacity=\"{fill_opacity}\" stroke=\"{}\" stroke-opacity=\"{stroke_opacity}\"/>", number(props.width), number(height), paint(props.background.as_deref().or(Some("#ffffff"))), paint(props.border.as_deref())).expect("writing to a String cannot fail");
        let mut y = 8.0;
        let line_height = props.font_size * 1.4;
        for line in markdown_lines(&props.markdown, props.font_size) {
            let plain_text = strip_markdown(&line.text);
            let wrapped_lines = wrap_text(&plain_text, props.width - 16.0, line.font_size);
            let keeps_inline_style = wrapped_lines.len() == 1 && !line.code;
            for wrapped in wrapped_lines {
                if y + line_height > height - 8.0 {
                    break;
                }
                let content = if keeps_inline_style { markdown_inline_svg(&line.text) } else { escape_xml(&wrapped) };
                writeln!(output, "        <text x=\"8\" y=\"{}\" font-family=\"{}\" font-size=\"{}\" font-weight=\"{}\" fill=\"{}\" fill-opacity=\"{fill_opacity}\" dominant-baseline=\"text-before-edge\">{content}</text>", number(y), escape_xml(if line.code { "monospace" } else { &font }), number(line.font_size), if line.bold { "bold" } else { "normal" }, escape_xml(&props.color)).expect("writing to a String cannot fail");
                y += line.font_size * 1.4;
            }
        }
        output.push_str("      </g>\n");
        Ok(())
    }

    fn font<'a>(&mut self, shape: &ShapeRecord, requested: &'a str) -> &'a str {
        if is_generic_font(requested) || self.options.available_font_families.contains(requested) {
            requested
        } else if let Some(asset) = self.document.assets.values().find(|asset| {
            asset.media_type.starts_with("font/")
                && asset.name == requested
                && matches!(asset.source, AssetSource::Embedded { .. })
        }) {
            let AssetSource::Embedded { bytes } = &asset.source else { unreachable!("matched embedded asset") };
            self.font_faces
                .entry(requested.to_owned())
                .or_insert_with(|| (asset.media_type.clone(), bytes.clone()));
            requested
        } else {
            self.warnings.insert(SvgRenderWarning::MissingFont {
                shape_id: shape.id.clone(),
                requested: requested.into(),
                fallback: FALLBACK_FONT.into(),
            });
            FALLBACK_FONT
        }
    }

    fn inspect_resources(&mut self, shape: &ShapeRecord) {
        for key in ["asset_id", "assetId"] {
            let Some(asset_id) = shape.properties.get(key).and_then(Value::as_str).map(AssetId::from) else {
                continue;
            };
            match self.document.assets.get(&asset_id) {
                None => {
                    self.warnings
                        .insert(SvgRenderWarning::MissingAsset { shape_id: shape.id.clone(), asset_id });
                }
                Some(asset)
                    if matches!(asset.source, AssetSource::External { .. })
                        && !self.options.available_asset_ids.contains(&asset_id) =>
                {
                    self.warnings
                        .insert(SvgRenderWarning::UnresolvedExternalAsset { shape_id: shape.id.clone(), asset_id });
                }
                Some(_) => {}
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoxProps {
    #[serde(alias = "w")]
    width: f64,
    #[serde(alias = "h")]
    height: f64,
    #[serde(default)]
    fill: Option<String>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default)]
    radius: f64,
}

#[derive(Default, Deserialize)]
struct ContainerProps {
    #[serde(default, alias = "w")]
    width: f64,
    #[serde(default, alias = "h")]
    height: f64,
    #[serde(default)]
    fill: Option<String>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default)]
    radius: f64,
}

#[derive(Deserialize)]
struct LineProps {
    a: Vec2,
    b: Vec2,
    stroke: String,
    width: f64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrowStyle {
    stroke: String,
    width: f64,
    head_start: Option<bool>,
    head_end: Option<bool>,
    dash: Option<Vec<f64>>,
}

#[derive(Deserialize)]
struct ArrowRouting {
    kind: String,
}

#[derive(Deserialize)]
struct ArrowLabel {
    text: String,
    align: String,
    offset: f64,
}

#[derive(Deserialize)]
struct ArrowProps {
    points: Vec<Vec2>,
    style: ArrowStyle,
    routing: Option<ArrowRouting>,
    label: Option<ArrowLabel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextProps {
    text: String,
    font_size: f64,
    font_family: String,
    color: String,
    #[serde(alias = "w")]
    width: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownProps {
    #[serde(alias = "md")]
    markdown: String,
    #[serde(alias = "w")]
    width: f64,
    #[serde(alias = "h")]
    height: Option<f64>,
    font_size: f64,
    font_family: String,
    color: String,
    #[serde(alias = "bg")]
    background: Option<String>,
    border: Option<String>,
}

#[derive(Deserialize)]
struct PathProps {
    subpaths: Vec<PathSubpath>,
    fill_rule: PathFillRule,
    #[serde(default)]
    fill: Option<String>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default, alias = "strokeWidth")]
    stroke_width: Option<f64>,
}

#[derive(Deserialize)]
struct StrokePaintProperties {
    style: StrokeStyle,
}

#[derive(Deserialize)]
struct StrokeStyle {
    color: String,
    opacity: f64,
}

struct MarkdownLine {
    text: String,
    font_size: f64,
    bold: bool,
    code: bool,
}

/// Renders a materialized snapshot as deterministic SVG.
///
/// Layer and shape order come exclusively from the page, layer, and container
/// child lists. Hidden layers are omitted; locked layers remain visible, as in
/// the interactive renderer. The function performs no filesystem or font-system
/// access, so equal snapshots and options produce byte-for-byte equal output.
///
/// # Errors
///
/// Returns [`SvgRenderError`] for an unknown page, invalid region, or malformed
/// built-in shape properties.
pub fn render_svg(snapshot: &DocumentSnapshot, options: &SvgRenderOptions) -> Result<SvgRenderOutput, SvgRenderError> {
    validate_region(options.region)?;
    let Some(page_id) = options.page_id.as_ref().or_else(|| snapshot.document.page_ids.first()) else {
        return Ok(empty_svg());
    };
    let page = snapshot
        .document
        .pages
        .get(page_id)
        .ok_or_else(|| SvgRenderError::PageNotFound { page_id: page_id.clone() })?;

    let mut renderer = Renderer {
        document: &snapshot.document,
        options,
        warnings: BTreeSet::new(),
        font_faces: BTreeMap::new(),
        rendered_bounds: None,
        body: String::new(),
    };

    for layer_id in &page.layer_ids {
        if !options.layer_ids.is_empty() && !options.layer_ids.contains(layer_id) {
            continue;
        }
        let Some(layer) = snapshot.document.layers.get(layer_id) else {
            continue;
        };
        if !layer.visible {
            continue;
        }
        let mut layer_body = String::new();
        for shape_id in &layer.shape_ids {
            renderer.render_shape(shape_id, Affine::IDENTITY, false, &mut layer_body)?;
        }
        if !layer_body.is_empty() {
            writeln!(
                renderer.body,
                "  <g data-layer-id=\"{}\" opacity=\"{}\">",
                escape_xml(layer.id.as_str()),
                number(f64::from(layer.opacity.get()))
            )
            .expect("writing to a String cannot fail");
            renderer.body.push_str(&layer_body);
            renderer.body.push_str("  </g>\n");
        }
    }

    let view_box = options.region.or(renderer.rendered_bounds).unwrap_or(Bounds {
        x: 0.0,
        y: 0.0,
        width: EMPTY_SIZE,
        height: EMPTY_SIZE,
    });
    let view_box = if options.region.is_some() { view_box } else { padded(view_box, DEFAULT_PADDING) };
    let width = view_box.width.max(1.0);
    let height = view_box.height.max(1.0);
    let clip = options.region.map(|region| {
        format!(
            "  <defs><clipPath id=\"inkfinite-region\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/></clipPath></defs>\n",
            number(region.x), number(region.y), number(region.width), number(region.height)
        )
    });

    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{} {} {} {}\" width=\"{}\" height=\"{}\">\n",
        number(view_box.x),
        number(view_box.y),
        number(width),
        number(height),
        number(width),
        number(height)
    );
    if !renderer.font_faces.is_empty() {
        svg.push_str("  <defs><style>\n");
        for (family, (media_type, bytes)) in &renderer.font_faces {
            writeln!(
                svg,
                "    @font-face {{ font-family: '{}'; src: url(data:{};base64,{}) format('{}'); }}",
                escape_css_string(family),
                escape_xml(media_type),
                base64(bytes),
                font_format(media_type)
            )
            .expect("writing to a String cannot fail");
        }
        svg.push_str("  </style></defs>\n");
    }
    if let Some(clip) = clip {
        svg.push_str(&clip);
        svg.push_str("  <g clip-path=\"url(#inkfinite-region)\">\n");
        svg.push_str(&indent(&renderer.body, 2));
        svg.push_str("  </g>\n");
    } else {
        svg.push_str(&renderer.body);
    }
    svg.push_str("</svg>\n");

    Ok(SvgRenderOutput { svg, warnings: renderer.warnings.into_iter().collect() })
}

fn empty_svg() -> SvgRenderOutput {
    SvgRenderOutput {
        svg:
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" width=\"100\" height=\"100\">\n</svg>\n"
                .into(),
        warnings: Vec::new(),
    }
}

fn properties<T: for<'de> Deserialize<'de>>(shape: &ShapeRecord) -> Result<T, SvgRenderError> {
    serde_json::from_value(Value::Object(shape.properties.clone().into_iter().collect())).map_err(|error| {
        SvgRenderError::InvalidShapeProperties {
            shape_id: shape.id.clone(),
            kind: shape.kind.to_string(),
            message: error.to_string(),
        }
    })
}

fn shape_local_bounds(shape: &ShapeRecord) -> Result<Bounds, SvgRenderError> {
    let bounds = match BuiltinShapeKind::parse(shape.kind.as_str()) {
        Some(BuiltinShapeKind::Rectangle | BuiltinShapeKind::Ellipse) => {
            let props: BoxProps = properties(shape)?;
            Bounds { x: 0.0, y: 0.0, width: props.width, height: props.height }
        }
        Some(BuiltinShapeKind::Container) => {
            let props: ContainerProps = properties(shape)?;
            Bounds { x: 0.0, y: 0.0, width: props.width, height: props.height }
        }
        Some(BuiltinShapeKind::Line) => {
            let props: LineProps = properties(shape)?;
            bounds_from_points(&[props.a, props.b])
        }
        Some(BuiltinShapeKind::Arrow) => {
            let props: ArrowProps = properties(shape)?;
            bounds_from_points(&props.points)
        }
        Some(BuiltinShapeKind::Text) => {
            let props: TextProps = properties(shape)?;
            let width = props
                .width
                .unwrap_or_else(|| deterministic_text_width(&props.text, props.font_size));
            Bounds { x: 0.0, y: 0.0, width, height: props.font_size * 1.2 }
        }
        Some(BuiltinShapeKind::Markdown) => {
            let props: MarkdownProps = properties(shape)?;
            Bounds { x: 0.0, y: 0.0, width: props.width, height: props.height.unwrap_or(props.font_size * 10.0) }
        }
        Some(BuiltinShapeKind::Stroke) => canonical_stroke_outline(&shape.properties).map_or_else(
            |message| {
                Err(SvgRenderError::InvalidShapeProperties {
                    shape_id: shape.id.clone(),
                    kind: shape.kind.to_string(),
                    message,
                })
            },
            |outline| Ok(bounds_from_points(&outline)),
        )?,
        Some(BuiltinShapeKind::Path) => {
            let geometry = crate::path_geometry_from_properties(&shape.properties).map_err(|error| {
                SvgRenderError::InvalidShapeProperties {
                    shape_id: shape.id.clone(),
                    kind: shape.kind.to_string(),
                    message: error.to_string(),
                }
            })?;
            crate::validate_path_geometry(&geometry).map_err(|error| SvgRenderError::InvalidShapeProperties {
                shape_id: shape.id.clone(),
                kind: shape.kind.to_string(),
                message: error.to_string(),
            })?;
            crate::engine::geometry::path_bounds(&geometry)
        }
        None => Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 },
    };
    Ok(bounds)
}

fn path_data(geometry: &PathGeometry) -> String {
    let mut output = String::new();
    for subpath in &geometry.subpaths {
        for segment in &subpath.segments {
            match segment {
                PathSegment::Move { to } => write!(output, "M {} {} ", number(to.x), number(to.y)),
                PathSegment::Line { to } => write!(output, "L {} {} ", number(to.x), number(to.y)),
                PathSegment::Quadratic { control, to } => write!(
                    output,
                    "Q {} {} {} {} ",
                    number(control.x),
                    number(control.y),
                    number(to.x),
                    number(to.y)
                ),
                PathSegment::Cubic { control_1, control_2, to } => write!(
                    output,
                    "C {} {} {} {} {} {} ",
                    number(control_1.x),
                    number(control_1.y),
                    number(control_2.x),
                    number(control_2.y),
                    number(to.x),
                    number(to.y)
                ),
            }
            .expect("writing to a String cannot fail");
        }
        if subpath.closed {
            output.push_str("Z ");
        }
    }
    output.trim_end().to_owned()
}

fn path_fill_rule(rule: PathFillRule) -> &'static str {
    match rule {
        PathFillRule::NonZero => "nonzero",
        PathFillRule::EvenOdd => "evenodd",
    }
}

fn render_shape_world_bounds(document: &Document, shape: &ShapeRecord) -> Result<Bounds, SvgRenderError> {
    Ok(world_transform(document, shape).transform_bounds(shape_local_bounds(shape)?))
}

fn contains_selected_descendant(document: &Document, shape: &ShapeRecord, selection: &BTreeSet<ShapeId>) -> bool {
    shape.child_ids.iter().any(|id| {
        selection.contains(id)
            || document
                .shapes
                .get(id)
                .is_some_and(|child| contains_selected_descendant(document, child, selection))
    })
}

fn binding_point(bounds: Bounds, anchor: BindingAnchor, arrow_width: f64) -> Vec2 {
    let center = Vec2 { x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0 };
    match anchor {
        BindingAnchor::Center => center,
        BindingAnchor::Edge { x, y } => {
            let mut point = Vec2 { x: center.x + x * bounds.width / 2.0, y: center.y + y * bounds.height / 2.0 };
            let dx = point.x - center.x;
            let dy = point.y - center.y;
            let distance = dx.hypot(dy);
            if distance >= 0.01 {
                let offset = 1.0 + arrow_width / 2.0;
                point.x += dx / distance * offset;
                point.y += dy / distance * offset;
            }
            point
        }
    }
}

fn orthogonal(start: Vec2, end: Vec2) -> Vec<Vec2> {
    if (end.x - start.x).abs() < 0.1 || (end.y - start.y).abs() < 0.1 {
        return vec![start, end];
    }
    let middle = start.x + (end.x - start.x) / 2.0;
    vec![start, Vec2 { x: middle, y: start.y }, Vec2 { x: middle, y: end.y }, end]
}

fn arrow_head(output: &mut String, transform: &str, from: Vec2, at: Vec2, style: &ArrowStyle, opacity: &str) {
    let angle = (at.y - from.y).atan2(at.x - from.x);
    let length = 15.0;
    let spread = std::f64::consts::PI / 6.0;
    let left = Vec2 { x: at.x - length * (angle - spread).cos(), y: at.y - length * (angle - spread).sin() };
    let right = Vec2 { x: at.x - length * (angle + spread).cos(), y: at.y - length * (angle + spread).sin() };
    writeln!(output, "      <path transform=\"{transform}\" d=\"M {} {} L {} {} M {} {} L {} {}\" fill=\"none\" stroke=\"{}\" stroke-opacity=\"{opacity}\" stroke-width=\"{}\"/>", number(at.x), number(at.y), number(left.x), number(left.y), number(at.x), number(at.y), number(right.x), number(right.y), escape_xml(&style.stroke), number(style.width)).expect("writing to a String cannot fail");
}

fn polyline_length(points: &[Vec2]) -> f64 {
    points
        .windows(2)
        .map(|pair| (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y))
        .sum()
}

fn point_at_distance(points: &[Vec2], target: f64) -> Vec2 {
    let mut distance = 0.0;
    for pair in points.windows(2) {
        let length = (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y);
        if distance + length >= target && length > 0.0 {
            let ratio = (target - distance) / length;
            return Vec2 {
                x: pair[0].x + (pair[1].x - pair[0].x) * ratio,
                y: pair[0].y + (pair[1].y - pair[0].y) * ratio,
            };
        }
        distance += length;
    }
    points.last().copied().unwrap_or(Vec2 { x: 0.0, y: 0.0 })
}

fn markdown_lines(source: &str, base_size: f64) -> Vec<MarkdownLine> {
    let mut result = Vec::new();
    let mut code = false;
    for source_line in source.lines() {
        if source_line.starts_with("```") {
            code = !code;
            continue;
        }
        if code {
            result.push(MarkdownLine { text: source_line.into(), font_size: base_size, bold: false, code: true });
            continue;
        }
        let hashes = source_line.bytes().take_while(|byte| *byte == b'#').count();
        let (text, font_size, bold) = if (1..=6).contains(&hashes) && source_line.as_bytes().get(hashes) == Some(&b' ')
        {
            let scale = match hashes {
                1 => 1.85,
                2 => 1.7,
                3 => 1.55,
                4 => 1.4,
                5 => 1.25,
                6 => 1.1,
                _ => 1.0,
            };
            (source_line[hashes + 1..].to_owned(), base_size * scale, true)
        } else if let Some(text) = source_line
            .strip_prefix("- ")
            .or_else(|| source_line.strip_prefix("* "))
            .or_else(|| source_line.strip_prefix("+ "))
        {
            (format!("• {text}"), base_size, false)
        } else {
            (source_line.to_owned(), base_size, false)
        };
        result.push(MarkdownLine { text, font_size, bold, code: false });
    }
    result
}

fn strip_markdown(text: &str) -> String {
    text.replace("***", "")
        .replace("___", "")
        .replace("**", "")
        .replace("__", "")
        .replace(['*', '_', '`'], "")
}

fn markdown_inline_svg(text: &str) -> String {
    let mut output = String::new();
    let mut rest = text;
    let mut bold = false;
    let mut italic = false;
    let mut code = false;
    while !rest.is_empty() {
        let marker = ["**", "__", "`", "*", "_"]
            .into_iter()
            .filter_map(|candidate| rest.find(candidate).map(|index| (index, candidate)))
            .min_by_key(|(index, marker)| (*index, std::cmp::Reverse(marker.len())));
        let Some((index, marker)) = marker else {
            push_markdown_span(&mut output, rest, bold, italic, code);
            break;
        };
        push_markdown_span(&mut output, &rest[..index], bold, italic, code);
        match marker {
            "**" | "__" => bold = !bold,
            "*" | "_" => italic = !italic,
            "`" => code = !code,
            _ => {}
        }
        rest = &rest[index + marker.len()..];
    }
    output
}

fn push_markdown_span(output: &mut String, text: &str, bold: bool, italic: bool, code: bool) {
    if text.is_empty() {
        return;
    }
    let weight = if bold { " font-weight=\"bold\"" } else { "" };
    let style = if italic { " font-style=\"italic\"" } else { "" };
    let family = if code { " font-family=\"monospace\"" } else { "" };
    write!(output, "<tspan{weight}{style}{family}>{}</tspan>", escape_xml(text))
        .expect("writing to a String cannot fail");
}

fn wrap_text(text: &str, max_width: f64, font_size: f64) -> Vec<String> {
    let mut lines = Vec::new();
    for source_line in text.split('\n') {
        let mut current = String::new();
        for word in source_line.split(' ') {
            let candidate = if current.is_empty() { word.into() } else { format!("{current} {word}") };
            if deterministic_text_width(&candidate, font_size) > max_width && !current.is_empty() {
                lines.push(current);
                current = word.into();
            } else {
                current = candidate;
            }
        }
        lines.push(current);
    }
    lines
}

fn deterministic_text_width(text: &str, font_size: f64) -> f64 {
    text.chars()
        .map(|character| {
            if character.is_ascii_whitespace() {
                0.33
            } else if "ilI.,'`|!".contains(character) {
                0.3
            } else if "mwMW@#%&".contains(character) {
                0.9
            } else {
                0.6
            }
        })
        .sum::<f64>()
        * font_size
}

fn is_generic_font(font: &str) -> bool {
    matches!(
        font.to_ascii_lowercase().as_str(),
        "sans-serif" | "serif" | "monospace" | "cursive" | "fantasy" | "system-ui"
    )
}

fn validate_region(region: Option<Bounds>) -> Result<(), SvgRenderError> {
    if region.is_some_and(|bounds| {
        !bounds.x.is_finite()
            || !bounds.y.is_finite()
            || !bounds.width.is_finite()
            || !bounds.height.is_finite()
            || bounds.width < 0.0
            || bounds.height < 0.0
    }) {
        Err(SvgRenderError::InvalidRegion)
    } else {
        Ok(())
    }
}

fn padded(bounds: Bounds, padding: f64) -> Bounds {
    Bounds {
        x: bounds.x - padding,
        y: bounds.y - padding,
        width: bounds.width + padding * 2.0,
        height: bounds.height + padding * 2.0,
    }
}

fn affine_svg(matrix: Affine) -> String {
    format!(
        "matrix({} {} {} {} {} {})",
        number(matrix.a),
        number(matrix.b),
        number(matrix.c),
        number(matrix.d),
        number(matrix.e),
        number(matrix.f)
    )
}

fn paint(value: Option<&str>) -> String {
    value
        .filter(|value| !value.is_empty())
        .map_or_else(|| "none".into(), escape_xml)
}

fn number(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    let formatted = format!("{value:.6}");
    formatted.trim_end_matches('0').trim_end_matches('.').to_owned()
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn escape_css_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn font_format(media_type: &str) -> &'static str {
    match media_type {
        "font/woff" => "woff",
        "font/ttf" | "application/x-font-ttf" => "truetype",
        "font/otf" | "application/x-font-opentype" => "opentype",
        _ => "woff2",
    }
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(char::from(ALPHABET[usize::from(first >> 2)]));
        encoded.push(char::from(ALPHABET[usize::from(((first & 0x03) << 4) | (second >> 4))]));
        encoded.push(if chunk.len() > 1 {
            char::from(ALPHABET[usize::from(((second & 0x0f) << 2) | (third >> 6))])
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 { char::from(ALPHABET[usize::from(third & 0x3f)]) } else { '=' });
    }
    encoded
}

fn indent(value: &str, spaces: usize) -> String {
    let prefix = " ".repeat(spaces);
    value.lines().fold(String::new(), |mut output, line| {
        writeln!(output, "{prefix}{line}").expect("writing to a String cannot fail");
        output
    })
}

#[cfg(test)]
mod tests;
