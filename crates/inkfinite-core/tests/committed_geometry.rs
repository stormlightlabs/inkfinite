use inkfinite_core::engine::geometry::{path_bounds, stroke_bounds};
use inkfinite_core::{PathGeometry, ShapeProperties};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct GeometryFixture {
    path_cases: Vec<PathCase>,
    stroke_cases: Vec<StrokeCase>,
}

#[derive(Deserialize)]
struct PathCase {
    name: String,
    geometry: PathGeometry,
    expected_bounds: BoundsFixture,
}

#[derive(Deserialize)]
struct StrokeCase {
    name: String,
    points: Value,
    brush: Value,
    style: Value,
    committed_bounds: BoundsFixture,
}

#[derive(Deserialize)]
struct BoundsFixture {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn assert_close(actual: f64, expected: f64, name: &str, field: &str) {
    assert!(
        (actual - expected).abs() < 1e-12,
        "{name} {field}: expected {expected}, got {actual}"
    );
}

#[test]
fn rust_committed_geometry_matches_shared_fixture() {
    let fixture: GeometryFixture =
        serde_json::from_str(include_str!("../../../fixtures/native/geometry/committed.json"))
            .expect("committed geometry fixture should decode");
    for case in fixture.path_cases {
        let actual = path_bounds(&case.geometry);
        assert_close(actual.x, case.expected_bounds.x, &case.name, "x");
        assert_close(actual.y, case.expected_bounds.y, &case.name, "y");
        assert_close(actual.width, case.expected_bounds.width, &case.name, "width");
        assert_close(actual.height, case.expected_bounds.height, &case.name, "height");
    }
    for case in fixture.stroke_cases {
        let properties = ShapeProperties::from([
            ("points".into(), case.points),
            ("brush".into(), case.brush),
            ("style".into(), case.style),
        ]);
        let actual = stroke_bounds(&properties).expect("stroke fixture should validate");
        assert_close(actual.x, case.committed_bounds.x, &case.name, "x");
        assert_close(actual.y, case.committed_bounds.y, &case.name, "y");
        assert_close(actual.width, case.committed_bounds.width, &case.name, "width");
        assert_close(actual.height, case.committed_bounds.height, &case.name, "height");
    }
}
