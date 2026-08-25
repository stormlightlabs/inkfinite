//! Canonical validation and normalization for shape properties.

#[cfg(test)]
use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use super::geometry::{
    FilterEffect, FilterPrimitive, MaskEffect, PathGeometry, path_geometry_from_properties, validate_paint_value,
    validate_path_geometry,
};
#[cfg(test)]
use super::geometry::{Opacity, PathFillRule, PathGeometryError, PathSegment, PathSubpath, Vec2};
#[cfg(test)]
use super::ids::ShapeId;
#[cfg(test)]
use super::registry::{
    ARROW_KIND, BuiltinShapeKind, CONTAINER_KIND, ELLIPSE_KIND, LINE_KIND, MARKDOWN_KIND, RECTANGLE_KIND,
    SiblingAnchor, builtin_shape_kinds,
};
use super::registry::{
    IMAGE_KIND, ImageCrop, ImageMask, ImageMaskKind, PATH_KIND, REFERENCE_KIND, ReferenceKind, ReferenceProperties,
    STROKE_KIND, ShapeProperties, ShapePropertyError, StrokeProperties, TEXT_KIND, is_builtin_shape_kind,
};

/// Validates the property rules shared by the Rust and TypeScript registries.
///
/// Unknown properties remain available for shape-specific extensions. The
/// registry gives common `width` and `height` properties cross-language numeric
/// and non-negative constraints, and validates the normalized geometry of path
/// and freehand stroke shapes.
///
/// # Errors
///
/// Returns [`ShapePropertyError`] when the kind, a common dimension, or a
/// path or stroke geometry value is invalid.
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
    for property in ["fill", "stroke", "background", "border"] {
        if let Some(value) = properties.get(property)
            && !value.is_null()
        {
            validate_paint_value(value).map_err(|message| ShapePropertyError::InvalidPaint {
                kind: kind.to_owned(),
                property: property.to_owned(),
                message,
            })?;
        }
    }
    if let Some(style) = properties.get("style").and_then(Value::as_object) {
        for property in ["stroke", "color"] {
            if let Some(value) = style.get(property)
                && !value.is_null()
            {
                validate_paint_value(value).map_err(|message| ShapePropertyError::InvalidPaint {
                    kind: kind.to_owned(),
                    property: format!("style.{property}"),
                    message,
                })?;
            }
        }
    }
    if kind == TEXT_KIND {
        validate_text_properties(properties)
            .map_err(|message| ShapePropertyError::InvalidText { kind: kind.to_owned(), message })?;
    } else if kind == PATH_KIND {
        let geometry = path_geometry_from_properties(properties)
            .map_err(|error| ShapePropertyError::InvalidPath { kind: kind.to_owned(), message: error.to_string() })?;
        validate_path_geometry(&geometry)
            .map_err(|error| ShapePropertyError::InvalidPath { kind: kind.to_owned(), message: error.to_string() })?;
    } else if kind == STROKE_KIND {
        validate_stroke_properties(properties)
            .map_err(|message| ShapePropertyError::InvalidStroke { kind: kind.to_owned(), message })?;
    } else if kind == IMAGE_KIND {
        validate_image_properties(properties)
            .map_err(|message| ShapePropertyError::InvalidImage { kind: kind.to_owned(), message })?;
    }
    validate_vector_effects(properties)
        .map_err(|message| ShapePropertyError::InvalidEffects { kind: kind.to_owned(), message })?;
    if kind == REFERENCE_KIND {
        validate_reference_properties(properties)
            .map_err(|message| ShapePropertyError::InvalidReference { kind: kind.to_owned(), message })?;
    }
    Ok(())
}

/// Normalizes geometry properties at the canonical transaction boundary.
///
/// Path properties are decoded and reserialized from the native representation.
/// Freehand points and brush settings are likewise decoded and written back with
/// the stable browser-facing field names. Other shape properties are cloned
/// unchanged. Callers should use this before storing a shape or patching its
/// geometry so equivalent editor values have one durable representation.
///
/// # Errors
///
/// Returns [`ShapePropertyError`] when the kind or its geometry is invalid.
pub fn normalize_shape_properties(
    kind: &str, properties: &ShapeProperties,
) -> Result<ShapeProperties, ShapePropertyError> {
    validate_shape_properties(kind, properties)?;
    let mut normalized = properties.clone();
    if kind == PATH_KIND {
        let geometry = path_geometry_from_properties(properties)
            .map_err(|error| ShapePropertyError::InvalidPath { kind: kind.to_owned(), message: error.to_string() })?;
        normalized.insert(
            "subpaths".into(),
            serde_json::to_value(geometry.subpaths).map_err(|error| ShapePropertyError::InvalidPath {
                kind: kind.to_owned(),
                message: error.to_string(),
            })?,
        );
        normalized.insert(
            "fill_rule".into(),
            serde_json::to_value(geometry.fill_rule).map_err(|error| ShapePropertyError::InvalidPath {
                kind: kind.to_owned(),
                message: error.to_string(),
            })?,
        );
    } else if kind == STROKE_KIND {
        let stroke = decode_stroke_properties(properties)
            .map_err(|message| ShapePropertyError::InvalidStroke { kind: kind.to_owned(), message })?;
        normalized.insert(
            "points".into(),
            serde_json::to_value(stroke.points).map_err(|error| ShapePropertyError::InvalidStroke {
                kind: kind.to_owned(),
                message: error.to_string(),
            })?,
        );
        normalized.insert(
            "style".into(),
            serde_json::to_value(stroke.style).map_err(|error| ShapePropertyError::InvalidStroke {
                kind: kind.to_owned(),
                message: error.to_string(),
            })?,
        );
        normalized.insert(
            "brush".into(),
            serde_json::to_value(stroke.brush).map_err(|error| ShapePropertyError::InvalidStroke {
                kind: kind.to_owned(),
                message: error.to_string(),
            })?,
        );
        normalized.remove("width_profile");
        if let Some(profile) = stroke.width_profile {
            normalized.insert(
                "widthProfile".into(),
                serde_json::to_value(profile).map_err(|error| ShapePropertyError::InvalidStroke {
                    kind: kind.to_owned(),
                    message: error.to_string(),
                })?,
            );
        }
    }
    Ok(normalized)
}

fn validate_text_properties(properties: &ShapeProperties) -> Result<(), String> {
    let Some(text_path) = properties.get("textPath").or_else(|| properties.get("text_path")) else {
        return Ok(());
    };
    let object = text_path
        .as_object()
        .ok_or_else(|| "text path attachment must be an object".to_owned())?;
    object
        .get("pathId")
        .or_else(|| object.get("path_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "text path attachment needs a path ID".to_owned())?;
    let offset = object
        .get("offset")
        .and_then(Value::as_f64)
        .ok_or_else(|| "text path offset must be a finite number".to_owned())?;
    if !offset.is_finite() {
        return Err("text path offset must be a finite number".into());
    }
    if !matches!(
        object.get("align").and_then(Value::as_str),
        Some("start" | "center" | "end")
    ) {
        return Err("text path alignment must be start, center, or end".into());
    }
    if !matches!(object.get("side").and_then(Value::as_str), Some("left" | "right")) {
        return Err("text path side must be left or right".into());
    }
    if !matches!(
        object.get("direction").and_then(Value::as_str),
        Some("forward" | "reverse")
    ) {
        return Err("text path direction must be forward or reverse".into());
    }
    Ok(())
}

fn validate_vector_effects(properties: &ShapeProperties) -> Result<(), String> {
    if let Some(value) = properties.get("clip_path") {
        let geometry: PathGeometry = serde_json::from_value(value.clone())
            .map_err(|error| format!("clip_path could not be decoded: {error}"))?;
        validate_path_geometry(&geometry).map_err(|error| format!("clip_path is invalid: {error}"))?;
    }
    if let Some(value) = properties.get("mask_effect") {
        let mask: MaskEffect = serde_json::from_value(value.clone())
            .map_err(|error| format!("mask_effect could not be decoded: {error}"))?;
        validate_path_geometry(&mask.geometry).map_err(|error| format!("mask geometry is invalid: {error}"))?;
        if !mask.opacity.is_finite() || !(0.0..=1.0).contains(&mask.opacity) {
            return Err("mask opacity must be finite and between 0 and 1".into());
        }
    }
    if let Some(value) = properties.get("filter") {
        let filter: FilterEffect =
            serde_json::from_value(value.clone()).map_err(|error| format!("filter could not be decoded: {error}"))?;
        if filter.primitives.is_empty() {
            return Err("filter must contain at least one primitive".into());
        }
        for primitive in filter.primitives {
            let valid = match primitive {
                FilterPrimitive::Blur { radius } => radius.is_finite() && radius >= 0.0,
                FilterPrimitive::Brightness { amount }
                | FilterPrimitive::Contrast { amount }
                | FilterPrimitive::Saturate { amount } => amount.is_finite() && amount >= 0.0,
                FilterPrimitive::Grayscale { amount }
                | FilterPrimitive::Invert { amount }
                | FilterPrimitive::Sepia { amount }
                | FilterPrimitive::Opacity { amount } => amount.is_finite() && (0.0..=1.0).contains(&amount),
                FilterPrimitive::HueRotate { degrees } => degrees.is_finite(),
                FilterPrimitive::DropShadow { dx, dy, radius, opacity, color } => {
                    dx.is_finite()
                        && dy.is_finite()
                        && radius.is_finite()
                        && radius >= 0.0
                        && opacity.is_finite()
                        && (0.0..=1.0).contains(&opacity)
                        && !color.trim().is_empty()
                }
            };
            if !valid {
                return Err("filter primitive contains an invalid value".into());
            }
        }
    }
    Ok(())
}

fn validate_image_properties(properties: &ShapeProperties) -> Result<(), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ImageProperties {
        #[serde(alias = "w")]
        width: f64,
        #[serde(alias = "h")]
        height: f64,
        #[serde(alias = "asset_id")]
        asset_id: String,
        #[serde(default)]
        crop: Option<ImageCrop>,
        #[serde(default)]
        mask: Option<ImageMask>,
        #[serde(default)]
        caption: Option<String>,
    }

    let image: ImageProperties = serde_json::from_value(Value::Object(properties.clone().into_iter().collect()))
        .map_err(|error| format!("image properties could not be decoded: {error}"))?;
    if !image.width.is_finite() || image.width < 0.0 || !image.height.is_finite() || image.height < 0.0 {
        return Err("image dimensions must be finite and non-negative".into());
    }
    if image.asset_id.trim().is_empty() {
        return Err("image asset_id must not be empty".into());
    }
    if let Some(crop) = image.crop {
        let edges = [crop.top, crop.right, crop.bottom, crop.left];
        if !edges
            .into_iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
        {
            return Err("image crop insets must be finite and between 0 and 1".into());
        }
        if crop.left + crop.right >= 1.0 || crop.top + crop.bottom >= 1.0 {
            return Err("image crop must leave a positive source area".into());
        }
    }
    if let Some(mask) = image.mask {
        if let Some(radius) = mask.radius
            && (!radius.is_finite() || radius < 0.0 || radius > image.width.min(image.height) / 2.0)
        {
            return Err("image mask radius must be finite and within the image bounds".into());
        }
        if !matches!(mask.kind, ImageMaskKind::Rounded) && mask.radius.is_some() {
            return Err("only rounded image masks may specify a radius".into());
        }
    }
    let _ = image.caption;
    Ok(())
}

fn validate_reference_properties(properties: &ShapeProperties) -> Result<(), String> {
    let reference: ReferenceProperties =
        serde_json::from_value(Value::Object(properties.clone().into_iter().collect()))
            .map_err(|error| format!("reference properties could not be decoded: {error}"))?;
    if !reference.width.is_finite() || reference.width < 0.0 || !reference.height.is_finite() || reference.height < 0.0
    {
        return Err("reference dimensions must be finite and non-negative".into());
    }
    if reference.value.trim().is_empty() {
        return Err("reference value must not be empty".into());
    }
    if matches!(reference.reference_type, ReferenceKind::Url)
        && !(reference.value.starts_with("http://") || reference.value.starts_with("https://"))
    {
        return Err("URL references must use http:// or https://".into());
    }
    Ok(())
}

/// Decodes a reference shape's properties.
///
/// # Errors
///
/// Returns [`ShapePropertyError`] when the reference properties are malformed.
pub fn reference_properties_from_properties(
    properties: &ShapeProperties,
) -> Result<ReferenceProperties, ShapePropertyError> {
    validate_reference_properties(properties)
        .map_err(|message| ShapePropertyError::InvalidReference { kind: REFERENCE_KIND.into(), message })?;
    serde_json::from_value(Value::Object(properties.clone().into_iter().collect())).map_err(|error| {
        ShapePropertyError::InvalidReference { kind: REFERENCE_KIND.into(), message: error.to_string() }
    })
}

fn validate_stroke_properties(properties: &ShapeProperties) -> Result<(), String> {
    let stroke = decode_stroke_properties(properties)?;
    if stroke.points.len() < 2 {
        return Err("stroke must contain at least two points".into());
    }
    for (index, point) in stroke.points.iter().enumerate() {
        if !(2..=3).contains(&point.len()) {
            return Err(format!(
                "stroke point {index} must contain x, y, and an optional pressure"
            ));
        }
        if !point[..2].iter().all(|value| value.is_finite()) {
            return Err(format!("stroke point {index} has a non-finite coordinate"));
        }
        if let Some(pressure) = point.get(2)
            && (!pressure.is_finite() || !(0.0..=1.0).contains(pressure))
        {
            return Err(format!("stroke point {index} has invalid pressure"));
        }
    }
    if !stroke.brush.size.is_finite() || stroke.brush.size <= 0.0 {
        return Err("stroke brush size must be finite and positive".into());
    }
    if ![
        stroke.brush.thinning,
        stroke.brush.smoothing,
        stroke.brush.streamline,
        stroke.style.opacity,
    ]
    .into_iter()
    .all(f64::is_finite)
    {
        return Err("stroke brush and style values must be finite".into());
    }
    if !(0.0..=1.0).contains(&stroke.style.opacity) {
        return Err("stroke style opacity must be between 0 and 1".into());
    }
    if let Some(profile) = &stroke.width_profile {
        let mut previous_offset = -1.0;
        for point in profile {
            if !point.offset.is_finite() || !(0.0..=1.0).contains(&point.offset) {
                return Err("stroke width offsets must be finite and between 0 and 1".into());
            }
            if !point.width.is_finite() || point.width <= 0.0 {
                return Err("stroke widths must be finite and positive".into());
            }
            if point.offset <= previous_offset {
                return Err("stroke width offsets must be strictly increasing".into());
            }
            previous_offset = point.offset;
        }
    }
    Ok(())
}

fn decode_stroke_properties(properties: &ShapeProperties) -> Result<StrokeProperties, String> {
    serde_json::from_value(Value::Object(properties.clone().into_iter().collect()))
        .map_err(|error| format!("stroke properties could not be decoded: {error}"))
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
    fn image_and_reference_properties_validate_content_rules() {
        let valid_image = BTreeMap::from([
            ("w".into(), Value::from(320.0)),
            ("h".into(), Value::from(200.0)),
            ("assetId".into(), Value::from("asset:image")),
            (
                "crop".into(),
                serde_json::json!({ "top": 0.1, "right": 0.1, "bottom": 0.1, "left": 0.1 }),
            ),
            ("mask".into(), serde_json::json!({ "kind": "rounded", "radius": 12.0 })),
        ]);
        assert!(validate_shape_properties(IMAGE_KIND, &valid_image).is_ok());
        let invalid_crop = BTreeMap::from([
            ("w".into(), Value::from(100.0)),
            ("h".into(), Value::from(100.0)),
            ("assetId".into(), Value::from("asset:image")),
            (
                "crop".into(),
                serde_json::json!({ "top": 0.0, "right": 0.6, "bottom": 0.0, "left": 0.6 }),
            ),
        ]);
        assert!(matches!(
            validate_shape_properties(IMAGE_KIND, &invalid_crop),
            Err(ShapePropertyError::InvalidImage { .. })
        ));
        let valid_reference = BTreeMap::from([
            ("w".into(), Value::from(280.0)),
            ("h".into(), Value::from(72.0)),
            ("referenceType".into(), Value::from("url")),
            ("value".into(), Value::from("https://example.com")),
        ]);
        assert!(validate_shape_properties(REFERENCE_KIND, &valid_reference).is_ok());
        let invalid_reference = BTreeMap::from([
            ("w".into(), Value::from(280.0)),
            ("h".into(), Value::from(72.0)),
            ("referenceType".into(), Value::from("url")),
            ("value".into(), Value::from("file://not-a-url")),
        ]);
        assert!(matches!(
            validate_shape_properties(REFERENCE_KIND, &invalid_reference),
            Err(ShapePropertyError::InvalidReference { .. })
        ));
    }

    #[test]
    #[allow(clippy::cognitive_complexity)]
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
                IMAGE_KIND,
                REFERENCE_KIND,
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
                handle_modes: None,
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

        let stroke_properties = BTreeMap::from([
            ("points".into(), serde_json::json!([[0.0, 0.0, 0.25], [20.0, 10.0]])),
            ("style".into(), serde_json::json!({ "color": "#000", "opacity": 0.75 })),
            (
                "brush".into(),
                serde_json::json!({
                    "size": 8.0,
                    "thinning": 0.5,
                    "smoothing": 0.5,
                    "streamline": 0.5,
                    "simulatePressure": true
                }),
            ),
            (
                "widthProfile".into(),
                serde_json::json!([{ "offset": 0.0, "width": 4.0 }, { "offset": 1.0, "width": 12.0 }]),
            ),
        ]);
        assert!(validate_shape_properties(STROKE_KIND, &stroke_properties).is_ok());
        let normalized = normalize_shape_properties(STROKE_KIND, &stroke_properties).expect("stroke normalizes");
        assert_eq!(normalized["points"], stroke_properties["points"]);
        assert_eq!(normalized["brush"]["simulatePressure"], Value::Bool(true));
        assert_eq!(normalized["widthProfile"], stroke_properties["widthProfile"]);
        assert!(matches!(
            validate_shape_properties(
                STROKE_KIND,
                &BTreeMap::from([
                    ("points".into(), serde_json::json!([[0.0, 0.0]])),
                    ("style".into(), serde_json::json!({ "color": "#000", "opacity": 1.0 })),
                    (
                        "brush".into(),
                        serde_json::json!({
                            "size": 8.0,
                            "thinning": 0.5,
                            "smoothing": 0.5,
                            "streamline": 0.5,
                            "simulatePressure": true
                        })
                    )
                ])
            ),
            Err(ShapePropertyError::InvalidStroke { .. })
        ));

        let gradient = serde_json::json!({
            "kind": "radial_gradient",
            "cx": 0.5,
            "cy": 0.5,
            "r": 0.5,
            "fx": 0.4,
            "fy": 0.4,
            "units": "object_bounding_box",
            "transform": { "a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0 },
            "spread": "pad",
            "stops": [
                { "offset": 0, "color": "#fff", "opacity": 1 },
                { "offset": 1, "color": "#000", "opacity": 0.5 }
            ]
        });
        assert!(validate_shape_properties(RECTANGLE_KIND, &BTreeMap::from([("fill".into(), gradient)])).is_ok());
        let invalid_gradient = serde_json::json!({
            "kind": "linear_gradient",
            "x1": 0,
            "y1": 0,
            "x2": 1,
            "y2": 0,
            "stops": [{ "offset": 0, "color": "#fff", "opacity": 2 }]
        });
        assert!(matches!(
            validate_shape_properties(RECTANGLE_KIND, &BTreeMap::from([("fill".into(), invalid_gradient)])),
            Err(ShapePropertyError::InvalidPaint { .. })
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
