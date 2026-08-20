use inkfinite_core::proto::{Bounds, TransactionDraft};
use inkfinite_core::{
    GEOMETRY_BOUNDS, GEOMETRY_COORDINATE_SYSTEM, GEOMETRY_ROTATION, PathGeometry, ShapeProperties, ShapeRecord,
    builtin_shape_kinds, validate_path_geometry, validate_shape_properties,
};
use serde_json::Value;

#[test]
fn shared_shape_fixture_matches_the_rust_registry_and_bindings() {
    let fixture: Value = serde_json::from_str(include_str!("../../../fixtures/native/shape-registry.json"))
        .expect("shared fixture should be valid JSON");

    let kind_names = fixture["kind_names"]
        .as_array()
        .expect("fixture kind names should be an array")
        .iter()
        .map(|kind| kind.as_str().expect("kind name should be a string"))
        .collect::<Vec<_>>();
    assert_eq!(kind_names, builtin_shape_kinds());
    assert_eq!(fixture["geometry"]["bounds"], GEOMETRY_BOUNDS);
    assert_eq!(fixture["geometry"]["coordinate_system"], GEOMETRY_COORDINATE_SYSTEM);
    assert_eq!(fixture["geometry"]["rotation"], GEOMETRY_ROTATION);

    let path_geometry: PathGeometry = serde_json::from_value(fixture["path_geometry"].clone())
        .expect("path geometry should use the normalized representation");
    validate_path_geometry(&path_geometry).expect("fixture path geometry should validate");
    assert_eq!(
        serde_json::to_value(&path_geometry).expect("path geometry should reserialize"),
        fixture["path_geometry"]
    );
    for case in fixture["invalid_path_cases"]
        .as_array()
        .expect("invalid path cases should be an array")
    {
        let geometry = serde_json::from_value::<PathGeometry>(case["geometry"].clone());
        assert!(
            geometry.is_err() || validate_path_geometry(&geometry.expect("invalid geometry should decode")).is_err()
        );
    }

    for case in fixture["property_cases"]
        .as_array()
        .expect("property cases should be an array")
    {
        let kind = case["kind"].as_str().expect("property kind should be a string");
        let properties: ShapeProperties =
            serde_json::from_value(case["properties"].clone()).expect("property case should be an object");
        assert_eq!(
            validate_shape_properties(kind, &properties).is_ok(),
            case["valid"].as_bool().expect("valid should be a boolean"),
            "property case for {kind}"
        );
    }

    let shape: ShapeRecord = serde_json::from_value(fixture["serialization"]["shape"].clone())
        .expect("shape serialization should decode through the Rust binding");
    let transaction: TransactionDraft = serde_json::from_value(fixture["serialization"]["transaction"].clone())
        .expect("transaction serialization should decode through the Rust binding");
    assert_eq!(
        serde_json::to_value(&shape).expect("shape should reserialize"),
        fixture["serialization"]["shape"]
    );
    assert_eq!(
        serde_json::to_value(&transaction).expect("transaction should reserialize"),
        fixture["serialization"]["transaction"]
    );

    for geometry_case in fixture["geometry_cases"]
        .as_array()
        .expect("geometry cases should be an array")
    {
        let expected: Bounds = serde_json::from_value(geometry_case["expected_bounds"].clone())
            .expect("expected bounds should use the protocol binding");
        let transform: inkfinite_core::Transform =
            serde_json::from_value(geometry_case["transform"].clone()).expect("fixture transform");
        let actual = if geometry_case["kind"] == inkfinite_core::PATH_KIND {
            let geometry: PathGeometry =
                serde_json::from_value(geometry_case["properties"].clone()).expect("path properties should decode");
            inkfinite_core::engine::geometry::Affine::from_transform(transform)
                .transform_bounds(inkfinite_core::engine::geometry::path_bounds(&geometry))
        } else {
            transformed_bounds(
                geometry_case["properties"]["width"].as_f64().expect("fixture width"),
                geometry_case["properties"]["height"].as_f64().expect("fixture height"),
                transform,
            )
        };
        assert_bounds_close(actual, expected);
    }
}

fn transformed_bounds(width: f64, height: f64, transform: inkfinite_core::Transform) -> Bounds {
    let cos = transform.rotation.cos();
    let sin = transform.rotation.sin();
    let points = [(0.0, 0.0), (width, 0.0), (0.0, height), (width, height)].map(|(x, y)| {
        let x = x * transform.scale_x;
        let y = y * transform.scale_y;
        (
            transform.translation.x + x * cos - y * sin,
            transform.translation.y + x * sin + y * cos,
        )
    });
    let min_x = points.iter().map(|point| point.0).fold(f64::INFINITY, f64::min);
    let max_x = points.iter().map(|point| point.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = points.iter().map(|point| point.1).fold(f64::INFINITY, f64::min);
    let max_y = points.iter().map(|point| point.1).fold(f64::NEG_INFINITY, f64::max);
    Bounds { x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y }
}

fn assert_bounds_close(actual: Bounds, expected: Bounds) {
    for (actual, expected) in [
        (actual.x, expected.x),
        (actual.y, expected.y),
        (actual.width, expected.width),
        (actual.height, expected.height),
    ] {
        assert!((actual - expected).abs() < 1e-9, "{actual} != {expected}");
    }
}
