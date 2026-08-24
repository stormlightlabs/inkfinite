//! Canonical geometry resolution for semantic arrow connectors.
//!
//! Arrow properties retain editable waypoints and binding metadata lives in the
//! document's binding collection. This module resolves those inputs into the
//! native path representation used by rendering, bounds, and editor clients.

use std::collections::BTreeSet;

use serde::Deserialize;
use thiserror::Error;
use ts_rs::TS;

use crate::engine::geometry::{world_shape_bounds, world_transform};
use crate::routing::obstacle_aware_orthogonal_route;
use crate::{
    ARROW_KIND, BindingAnchor, BuiltinShapeKind, Document, PathFillRule, PathGeometry, PathSegment, PathSubpath,
    ShapeId, ShapeRecord, Vec2,
};

/// The resolved native geometry of one semantic arrow.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema, TS)]
pub struct ResolvedArrowGeometry {
    /// The arrow shaft as native path segments in the arrow's local space.
    pub path: PathGeometry,
    /// Routing mode that produced the path, after applying automatic routing.
    pub routing: String,
    /// Resolved endpoints and retained waypoints in arrow-local coordinates.
    ///
    /// This is useful to editor clients that need to compare a projected
    /// resolution with an in-progress waypoint edit without inspecting the
    /// path's curve representation.
    pub waypoints: Vec<Vec2>,
}

/// Failure while resolving an arrow's editable connector inputs.
#[derive(Clone, Debug, Error, PartialEq)]
pub enum ArrowGeometryError {
    /// The requested shape is not present in the document.
    #[error("arrow shape {0} does not exist")]
    UnknownShape(ShapeId),
    /// The requested shape exists but is not an arrow.
    #[error("shape {0} is not an arrow")]
    NotArrow(ShapeId),
    /// The arrow properties do not contain the required connector fields.
    #[error("arrow properties could not be decoded: {0}")]
    InvalidProperties(String),
    /// One of the stored connector coordinates is not finite.
    #[error("arrow contains a non-finite coordinate at waypoint {0}")]
    NonFiniteWaypoint(usize),
    /// The arrow's world transform cannot be inverted for local path output.
    #[error("arrow {0} has a singular world transform")]
    SingularTransform(ShapeId),
}

/// Resolves one arrow by its stable document shape ID.
///
/// The returned path uses the arrow's local coordinates. Its consumers should
/// apply [`world_transform`](crate::engine::geometry::world_transform) when
/// drawing or comparing it with document-space geometry.
///
/// # Errors
///
/// Returns [`ArrowGeometryError`] when the shape is absent, is not an arrow, or
/// contains malformed connector properties.
pub fn resolve_arrow_geometry(
    document: &Document, shape_id: &ShapeId,
) -> Result<ResolvedArrowGeometry, ArrowGeometryError> {
    let shape = document
        .shapes
        .get(shape_id)
        .ok_or_else(|| ArrowGeometryError::UnknownShape(shape_id.clone()))?;
    resolve_arrow_geometry_for_shape(document, shape)
}

/// Resolves an arrow record into native path geometry.
///
/// Binding endpoints are calculated from the target's world bounds. Explicit
/// interior waypoints remain in the arrow's local space and orthogonal routes
/// pass each leg through the same obstacle router as the native renderer.
///
/// # Errors
///
/// Returns [`ArrowGeometryError`] when the shape is not an arrow, its
/// properties are malformed, or its world transform is singular.
pub fn resolve_arrow_geometry_for_shape(
    document: &Document, shape: &ShapeRecord,
) -> Result<ResolvedArrowGeometry, ArrowGeometryError> {
    if shape.kind.as_str() != ARROW_KIND {
        return Err(ArrowGeometryError::NotArrow(shape.id.clone()));
    }
    let properties: ArrowProperties = serde_json::from_value(shape.properties.clone().into_iter().collect())
        .map_err(|error| ArrowGeometryError::InvalidProperties(error.to_string()))?;
    for (index, point) in properties.points.iter().enumerate() {
        if !point.x.is_finite() || !point.y.is_finite() {
            return Err(ArrowGeometryError::NonFiniteWaypoint(index));
        }
    }
    if !properties.style.width.is_finite() || properties.style.width < 0.0 {
        return Err(ArrowGeometryError::InvalidProperties(
            "arrow style width must be finite and non-negative".into(),
        ));
    }

    let world = world_transform(document, shape);
    let inverse = world
        .inverse()
        .ok_or_else(|| ArrowGeometryError::SingularTransform(shape.id.clone()))?;
    let mut waypoints = properties.points;
    if waypoints.is_empty() {
        return Ok(ResolvedArrowGeometry { path: line_path(&waypoints), routing: "straight".into(), waypoints });
    }

    let binding_targets: BTreeSet<_> = document
        .bindings
        .values()
        .filter(|binding| binding.source_shape_id == shape.id)
        .map(|binding| binding.target_shape_id.clone())
        .collect();
    for binding in document
        .bindings
        .values()
        .filter(|binding| binding.source_shape_id == shape.id)
    {
        let Some(target) = document.shapes.get(&binding.target_shape_id) else {
            continue;
        };
        let target_bounds = world_shape_bounds(document, &target.id);
        let point = binding_point(target_bounds, binding.anchor, properties.style.width);
        let local = inverse.point(point);
        match binding.source_handle.as_str() {
            "start" => waypoints[0] = local,
            "end" => {
                if let Some(last) = waypoints.last_mut() {
                    *last = local;
                }
            }
            _ => {}
        }
    }

    let routing_kind = properties.routing.as_ref().map_or("straight", |routing| {
        if routing.automatic { "orthogonal" } else { routing.kind.as_str() }
    });
    let path = if routing_kind == "orthogonal" && waypoints.len() >= 2 {
        let obstacles = document
            .shapes
            .values()
            .filter(|candidate| {
                candidate.id != shape.id
                    && !binding_targets.contains(&candidate.id)
                    && !matches!(
                        BuiltinShapeKind::parse(candidate.kind.as_str()),
                        Some(BuiltinShapeKind::Arrow | BuiltinShapeKind::Line | BuiltinShapeKind::Container)
                    )
            })
            .map(|candidate| world_shape_bounds(document, &candidate.id))
            .collect::<Vec<_>>();
        let world_waypoints = waypoints.iter().map(|point| world.point(*point)).collect::<Vec<_>>();
        let mut world_route = Vec::new();
        for leg in world_waypoints.windows(2) {
            let leg_route = obstacle_aware_orthogonal_route(leg[0], leg[1], &obstacles, 12.0);
            if world_route.is_empty() {
                world_route.extend(leg_route);
            } else {
                world_route.extend(leg_route.into_iter().skip(1));
            }
        }
        line_path(
            &world_route
                .into_iter()
                .map(|point| inverse.point(point))
                .collect::<Vec<_>>(),
        )
    } else if routing_kind == "curved" {
        curved_path(&waypoints)
    } else {
        line_path(&waypoints)
    };

    Ok(ResolvedArrowGeometry { path, routing: routing_kind.into(), waypoints })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrowProperties {
    #[serde(default)]
    points: Vec<Vec2>,
    style: ArrowStyle,
    #[serde(default)]
    routing: Option<ArrowRouting>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrowStyle {
    width: f64,
}

#[derive(Clone, Debug, Deserialize)]
struct ArrowRouting {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    automatic: bool,
}

fn line_path(points: &[Vec2]) -> PathGeometry {
    let points = if points.is_empty() { vec![Vec2 { x: 0.0, y: 0.0 }] } else { points.to_vec() };
    let segments = points
        .iter()
        .enumerate()
        .map(
            |(index, point)| {
                if index == 0 { PathSegment::Move { to: *point } } else { PathSegment::Line { to: *point } }
            },
        )
        .collect();
    PathGeometry {
        subpaths: vec![PathSubpath { segments, closed: false, handle_modes: None }],
        fill_rule: PathFillRule::NonZero,
    }
}

fn curved_path(points: &[Vec2]) -> PathGeometry {
    if points.len() < 3 {
        return line_path(points);
    }
    let mut segments = vec![PathSegment::Move { to: points[0] }];
    for index in 1..points.len() - 1 {
        let control = points[index];
        let end = midpoint(control, points[index + 1]);
        segments.push(PathSegment::Quadratic { control, to: end });
    }
    let control = points[points.len() - 2];
    segments.push(PathSegment::Quadratic { control, to: points[points.len() - 1] });
    PathGeometry {
        subpaths: vec![PathSubpath { segments, closed: false, handle_modes: None }],
        fill_rule: PathFillRule::NonZero,
    }
}

fn midpoint(left: Vec2, right: Vec2) -> Vec2 {
    Vec2 { x: (left.x + right.x) / 2.0, y: (left.y + right.y) / 2.0 }
}

fn binding_point(bounds: crate::proto::Bounds, anchor: BindingAnchor, arrow_width: f64) -> Vec2 {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ActorId, BindingId, BindingKind, BindingRecord, LayerId, LayerRecord, Opacity, Origin, PageId, PageRecord,
        Provenance, RecordVersion, SemanticMetadata, ShapeKind, ShapeParent, ShapeProperties, ShapeStyle, Timestamp,
        Transform,
    };

    fn document_with_arrow(points: serde_json::Value) -> Document {
        let page_id = PageId::from("page:one");
        let layer_id = LayerId::from("layer:one");
        let arrow_id = ShapeId::from("shape:arrow");
        let properties = ShapeProperties::from([
            ("points".into(), points),
            ("style".into(), serde_json::json!({ "stroke": "#000", "width": 2 })),
        ]);
        let arrow = ShapeRecord {
            id: arrow_id.clone(),
            kind: ShapeKind::from(ARROW_KIND),
            parent: ShapeParent::Layer(layer_id.clone()),
            transform: Transform { translation: Vec2 { x: 10.0, y: 20.0 }, rotation: 0.0, scale_x: 1.0, scale_y: 1.0 },
            child_ids: Vec::new(),
            layout: None,
            properties,
            metadata: metadata(),
            style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
            version: RecordVersion(1),
        };
        Document {
            pages: std::collections::BTreeMap::from([(
                page_id.clone(),
                PageRecord {
                    id: page_id,
                    name: "One".into(),
                    layer_ids: vec![layer_id.clone()],
                    version: RecordVersion(1),
                },
            )]),
            page_ids: vec![PageId::from("page:one")],
            layers: std::collections::BTreeMap::from([(
                layer_id.clone(),
                LayerRecord {
                    id: layer_id,
                    page_id: PageId::from("page:one"),
                    name: "Default".into(),
                    shape_ids: vec![arrow_id.clone()],
                    visible: true,
                    locked: false,
                    opacity: Opacity::OPAQUE,
                    version: RecordVersion(1),
                },
            )]),
            shapes: std::collections::BTreeMap::from([(arrow_id, arrow)]),
            bindings: std::collections::BTreeMap::new(),
            assets: std::collections::BTreeMap::new(),
        }
    }

    fn metadata() -> SemanticMetadata {
        SemanticMetadata {
            name: None,
            title: None,
            role: None,
            description: None,
            body: None,
            tags: Vec::new(),
            source: None,
            link: None,
            custom_metadata: std::collections::BTreeMap::new(),
            locked: false,
            agent_editable: true,
            provenance: Provenance {
                actor_id: ActorId::from("actor:test"),
                origin: Origin::System,
                timestamp: Timestamp(0),
                source: None,
            },
        }
    }

    #[test]
    fn shared_connector_fixture_matches_native_resolution() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/native/connector-geometry.json"))
                .expect("connector fixture should decode");
        for case in fixture["cases"].as_array().expect("connector cases") {
            let mut document = document_with_arrow(case["points"].clone());
            if case["routing"] != "straight" {
                document
                    .shapes
                    .get_mut(&ShapeId::from("shape:arrow"))
                    .expect("fixture arrow")
                    .properties
                    .insert("routing".into(), serde_json::json!({ "kind": case["routing"] }));
            }
            let geometry =
                resolve_arrow_geometry(&document, &ShapeId::from("shape:arrow")).expect("fixture arrow should resolve");
            let expected: ResolvedArrowGeometry =
                serde_json::from_value(case["expected"].clone()).expect("fixture geometry");
            assert_eq!(geometry, expected);
        }
    }

    #[test]
    fn straight_arrows_resolve_to_native_move_and_line_segments() {
        let document = document_with_arrow(serde_json::json!([
            { "x": 0, "y": 0 },
            { "x": 20, "y": 10 },
            { "x": 40, "y": 0 }
        ]));
        let geometry = resolve_arrow_geometry(&document, &ShapeId::from("shape:arrow")).expect("arrow geometry");
        assert_eq!(
            geometry.path.subpaths[0].segments,
            vec![
                PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                PathSegment::Line { to: Vec2 { x: 20.0, y: 10.0 } },
                PathSegment::Line { to: Vec2 { x: 40.0, y: 0.0 } },
            ]
        );
        assert_eq!(geometry.waypoints.len(), 3);
    }

    #[test]
    fn curved_arrows_resolve_to_quadratic_native_segments() {
        let mut document = document_with_arrow(serde_json::json!([
            { "x": 0, "y": 0 },
            { "x": 20, "y": 10 },
            { "x": 40, "y": 0 }
        ]));
        document
            .shapes
            .get_mut(&ShapeId::from("shape:arrow"))
            .unwrap()
            .properties
            .insert("routing".into(), serde_json::json!({ "kind": "curved" }));
        let geometry = resolve_arrow_geometry(&document, &ShapeId::from("shape:arrow")).expect("arrow geometry");
        assert!(matches!(
            geometry.path.subpaths[0].segments[1],
            PathSegment::Quadratic { .. }
        ));
    }

    #[test]
    fn bound_endpoints_are_resolved_before_the_path_is_built() {
        let mut document = document_with_arrow(serde_json::json!([{ "x": 0, "y": 0 }, { "x": 40, "y": 0 }]));
        let target_id = ShapeId::from("shape:target");
        document.shapes.insert(
            target_id.clone(),
            ShapeRecord {
                id: target_id.clone(),
                kind: ShapeKind::from("rect"),
                parent: ShapeParent::Layer(LayerId::from("layer:one")),
                transform: Transform {
                    translation: Vec2 { x: 100.0, y: 50.0 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                child_ids: Vec::new(),
                layout: None,
                properties: ShapeProperties::from([
                    ("width".into(), serde_json::json!(20)),
                    ("height".into(), serde_json::json!(10)),
                ]),
                metadata: metadata(),
                style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
                version: RecordVersion(1),
            },
        );
        document.bindings.insert(
            BindingId::from("binding:end"),
            BindingRecord {
                id: BindingId::from("binding:end"),
                kind: BindingKind::from("arrow-end"),
                source_shape_id: ShapeId::from("shape:arrow"),
                target_shape_id: target_id,
                source_handle: "end".into(),
                anchor: BindingAnchor::Center,
                relation_type: None,
                version: RecordVersion(1),
            },
        );
        let geometry = resolve_arrow_geometry(&document, &ShapeId::from("shape:arrow")).expect("arrow geometry");
        assert_eq!(geometry.waypoints[1], Vec2 { x: 100.0, y: 35.0 });
    }
}
