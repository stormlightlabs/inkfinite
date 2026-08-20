use perfect_freehand::{InputPoint, StrokeOptions, get_stroke};
use serde_json::Value;

use super::{Bounds, Document, EngineError, ShapeId, ShapeParent, ShapeRecord};
use crate::{PathGeometry, PathSegment, ShapeProperties, StrokeProperties, Transform, Vec2};

/// A two-dimensional affine transform shared by document geometry consumers.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    /// Horizontal scale and rotation component.
    pub a: f64,
    /// Vertical shear and rotation component.
    pub b: f64,
    /// Horizontal shear and rotation component.
    pub c: f64,
    /// Vertical scale and rotation component.
    pub d: f64,
    /// Horizontal translation.
    pub e: f64,
    /// Vertical translation.
    pub f: f64,
}

impl Affine {
    /// Identity transform.
    pub const IDENTITY: Self = Self { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    /// Converts an Inkfinite relative transform to an affine matrix.
    #[must_use]
    pub fn from_transform(transform: Transform) -> Self {
        let cos = transform.rotation.cos();
        let sin = transform.rotation.sin();
        Self {
            a: cos * transform.scale_x,
            b: sin * transform.scale_x,
            c: -sin * transform.scale_y,
            d: cos * transform.scale_y,
            e: transform.translation.x,
            f: transform.translation.y,
        }
    }

    /// Composes `child` after this transform.
    #[must_use]
    pub fn then(self, child: Self) -> Self {
        Self {
            a: self.a * child.a + self.c * child.b,
            b: self.b * child.a + self.d * child.b,
            c: self.a * child.c + self.c * child.d,
            d: self.b * child.c + self.d * child.d,
            e: self.a * child.e + self.c * child.f + self.e,
            f: self.b * child.e + self.d * child.f + self.f,
        }
    }

    /// Applies the transform to a point.
    #[must_use]
    pub fn point(self, point: Vec2) -> Vec2 {
        Vec2 { x: self.a * point.x + self.c * point.y + self.e, y: self.b * point.x + self.d * point.y + self.f }
    }

    /// Returns the axis-aligned bounds of a transformed rectangle.
    #[must_use]
    pub fn transform_bounds(self, bounds: Bounds) -> Bounds {
        bounds_from_points(&[
            self.point(Vec2 { x: bounds.x, y: bounds.y }),
            self.point(Vec2 { x: bounds.x + bounds.width, y: bounds.y }),
            self.point(Vec2 { x: bounds.x + bounds.width, y: bounds.y + bounds.height }),
            self.point(Vec2 { x: bounds.x, y: bounds.y + bounds.height }),
        ])
    }

    /// Returns the inverse matrix, or `None` for a singular transform.
    #[must_use]
    pub fn inverse(self) -> Option<Self> {
        let determinant = self.a * self.d - self.b * self.c;
        if determinant.abs() < f64::EPSILON {
            return None;
        }
        Some(Self {
            a: self.d / determinant,
            b: -self.b / determinant,
            c: -self.c / determinant,
            d: self.a / determinant,
            e: (self.c * self.f - self.d * self.e) / determinant,
            f: (self.b * self.e - self.a * self.f) / determinant,
        })
    }
}

/// Returns a shape's axis-aligned bounds in its parent's coordinate space.
#[must_use]
pub fn local_shape_bounds(shape: &ShapeRecord) -> Bounds {
    let local = if shape.kind.as_str() == crate::PATH_KIND {
        crate::path_geometry_from_properties(&shape.properties)
            .map_or(Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 }, |geometry| {
                path_bounds(&geometry)
            })
    } else if shape.kind.as_str() == crate::STROKE_KIND {
        stroke_bounds(&shape.properties).unwrap_or(Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 })
    } else {
        let width = numeric_property(shape, "width").unwrap_or(0.0).abs();
        let height = numeric_property(shape, "height").unwrap_or(0.0).abs();
        Bounds { x: 0.0, y: 0.0, width, height }
    };
    Affine::from_transform(shape.transform).transform_bounds(local)
}

/// Computes the committed freehand outline using the Rust canonical renderer.
///
/// The editor may calculate the same outline for a responsive preview, but
/// transaction validation and affected-region calculation use this function.
///
/// # Errors
///
/// Returns the decoded stroke-property error when the properties are malformed.
pub fn stroke_outline(properties: &ShapeProperties) -> Result<Vec<Vec2>, String> {
    crate::validate_shape_properties(crate::STROKE_KIND, properties).map_err(|error| error.to_string())?;
    let stroke: StrokeProperties = serde_json::from_value(Value::Object(properties.clone().into_iter().collect()))
        .map_err(|error| format!("stroke properties could not be decoded: {error}"))?;
    if stroke.points.len() < 2 {
        return Ok(Vec::new());
    }
    let points = stroke
        .points
        .iter()
        .map(|point| InputPoint::Array([point[0], point[1]], point.get(2).copied()))
        .collect::<Vec<_>>();
    let options = StrokeOptions {
        size: Some(stroke.brush.size),
        thinning: Some(stroke.brush.thinning),
        smoothing: Some(stroke.brush.smoothing),
        streamline: Some(stroke.brush.streamline),
        simulate_pressure: Some(stroke.brush.simulate_pressure),
        ..StrokeOptions::default()
    };
    Ok(get_stroke(&points, &options)
        .into_iter()
        .map(|point| Vec2 { x: point[0], y: point[1] })
        .collect())
}

/// Returns the axis-aligned bounds of a committed freehand outline.
///
/// # Errors
///
/// Returns the decoded stroke-property error when the properties are malformed.
pub fn stroke_bounds(properties: &ShapeProperties) -> Result<Bounds, String> {
    Ok(bounds_from_points(&stroke_outline(properties)?))
}

/// Returns a shape's axis-aligned bounds in document coordinates.
#[must_use]
pub fn world_shape_bounds(document: &Document, shape_id: &ShapeId) -> Bounds {
    let Some(shape) = document.shapes.get(shape_id) else {
        return Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
    };
    parent_world_transform(document, &shape.parent)
        .unwrap_or(Affine::IDENTITY)
        .transform_bounds(local_shape_bounds(shape))
}

/// Returns the world transform of a shape parent.
///
/// `None` means that the parent record is missing. Callers that are validating
/// a document should report that missing record instead of falling back to the
/// identity transform.
#[must_use]
pub fn parent_world_transform(document: &Document, parent: &ShapeParent) -> Option<Affine> {
    match parent {
        ShapeParent::Layer(layer_id) => document.layers.contains_key(layer_id).then_some(Affine::IDENTITY),
        ShapeParent::Shape(shape_id) => document
            .shapes
            .get(shape_id)
            .map(|shape| world_transform(document, shape)),
    }
}

/// Decomposes an affine transform into the native translation, rotation, and
/// scale representation.
///
/// Native transforms cannot represent shear. `None` is returned for singular,
/// non-finite, or sheared matrices.
#[must_use]
pub fn decompose_transform(matrix: Affine) -> Option<Transform> {
    let scale_x = matrix.a.hypot(matrix.b);
    if ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f, scale_x]
        .into_iter()
        .all(f64::is_finite)
        || scale_x <= f64::EPSILON
    {
        return None;
    }
    let rotation = matrix.b.atan2(matrix.a);
    let scale_y = (matrix.a * matrix.d - matrix.b * matrix.c) / scale_x;
    if !scale_y.is_finite() || scale_y.abs() <= f64::EPSILON {
        return None;
    }
    let transform = Transform { translation: Vec2 { x: matrix.e, y: matrix.f }, rotation, scale_x, scale_y };
    affine_approximately_equal(Affine::from_transform(transform), matrix).then_some(transform)
}

/// Converts a world transform into a native transform relative to `parent`.
#[must_use]
pub fn local_transform_from_world(document: &Document, parent: &ShapeParent, world: Affine) -> Option<Transform> {
    parent_world_transform(document, parent)
        .and_then(Affine::inverse)
        .and_then(|inverse| decompose_transform(inverse.then(world)))
}

fn affine_approximately_equal(left: Affine, right: Affine) -> bool {
    [
        (left.a, right.a),
        (left.b, right.b),
        (left.c, right.c),
        (left.d, right.d),
        (left.e, right.e),
        (left.f, right.f),
    ]
    .into_iter()
    .all(|(left, right)| (left - right).abs() <= 1e-9 * (1.0 + left.abs().max(right.abs())))
}

/// Returns the exact axis-aligned bounds of normalized path geometry.
///
/// Quadratic and cubic Bézier derivative roots are included, so the bounds do
/// not depend on a sampling step. A closed subpath contributes its implicit
/// closing line; an open subpath contributes only its stored segments.
#[must_use]
pub fn path_bounds(geometry: &PathGeometry) -> Bounds {
    let mut points = Vec::new();
    for subpath in &geometry.subpaths {
        let Some(PathSegment::Move { to: start }) = subpath.segments.first() else {
            continue;
        };
        let mut current = *start;
        points.push(current);
        for segment in subpath.segments.iter().skip(1) {
            match segment {
                PathSegment::Move { to } => {
                    current = *to;
                    points.push(current);
                }
                PathSegment::Line { to } => {
                    points.extend([current, *to]);
                    current = *to;
                }
                PathSegment::Quadratic { control, to } => {
                    points.extend([current, *to]);
                    add_quadratic_extremum(&mut points, current, *control, *to, |t| {
                        quadratic_point(current, *control, *to, t)
                    });
                    current = *to;
                }
                PathSegment::Cubic { control_1, control_2, to } => {
                    points.extend([current, *to]);
                    add_cubic_extrema(&mut points, current, *control_1, *control_2, *to, |t| {
                        cubic_point(current, *control_1, *control_2, *to, t)
                    });
                    current = *to;
                }
            }
        }
        if subpath.closed {
            points.extend([current, *start]);
        }
    }
    bounds_from_points(&points)
}

/// Returns the complete local-to-world transform for a shape hierarchy.
#[must_use]
pub fn world_transform(document: &Document, shape: &ShapeRecord) -> Affine {
    let mut chain = vec![shape];
    let mut parent = &shape.parent;
    while let ShapeParent::Shape(parent_id) = parent {
        let Some(parent_shape) = document.shapes.get(parent_id) else { break };
        chain.push(parent_shape);
        parent = &parent_shape.parent;
    }
    chain.into_iter().rev().fold(Affine::IDENTITY, |matrix, item| {
        matrix.then(Affine::from_transform(item.transform))
    })
}

/// Returns the smallest axis-aligned bounds containing every supplied point.
#[must_use]
pub fn bounds_from_points(points: &[Vec2]) -> Bounds {
    if points.is_empty() {
        return Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
    }
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (points[0].x, points[0].y, points[0].x, points[0].y);
    for point in &points[1..] {
        min_x = min_x.min(point.x);
        min_y = min_y.min(point.y);
        max_x = max_x.max(point.x);
        max_y = max_y.max(point.y);
    }
    Bounds { x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y }
}

/// Reads a finite numeric property from a shape record.
#[must_use]
pub fn numeric_property(shape: &ShapeRecord, name: &str) -> Option<f64> {
    shape
        .properties
        .get(name)
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
}

/// Converts a collection length to the engine's geometry scalar.
///
/// # Errors
///
/// Returns [`EngineError::Invariant`] when the length exceeds `u32`.
pub fn count_as_f64(count: usize) -> Result<f64, EngineError> {
    let count = u32::try_from(count).map_err(|_| EngineError::Invariant("layout selection is too large".into()))?;
    Ok(f64::from(count))
}

/// Returns the horizontal center of `bounds`.
#[must_use]
pub fn center_x(bounds: &Bounds) -> f64 {
    bounds.x + bounds.width / 2.0
}

/// Returns the vertical center of `bounds`.
#[must_use]
pub fn center_y(bounds: &Bounds) -> f64 {
    bounds.y + bounds.height / 2.0
}

/// Returns the right edge of `bounds`.
#[must_use]
pub fn right(bounds: &Bounds) -> f64 {
    bounds.x + bounds.width
}

/// Returns the bottom edge of `bounds`.
#[must_use]
pub fn bottom(bounds: &Bounds) -> f64 {
    bounds.y + bounds.height
}

/// Returns whether two axis-aligned bounds overlap or touch.
#[must_use]
pub fn intersects(left: &Bounds, right_bounds: &Bounds) -> bool {
    left.x <= right(right_bounds)
        && right(left) >= right_bounds.x
        && left.y <= bottom(right_bounds)
        && bottom(left) >= right_bounds.y
}

/// Returns the smallest bounds containing both inputs.
#[must_use]
pub fn union(left: Bounds, right_bounds: Bounds) -> Bounds {
    let x = left.x.min(right_bounds.x);
    let y = left.y.min(right_bounds.y);
    Bounds {
        x,
        y,
        width: right(&left).max(right(&right_bounds)) - x,
        height: bottom(&left).max(bottom(&right_bounds)) - y,
    }
}

fn add_quadratic_extremum<F>(points: &mut Vec<Vec2>, start: Vec2, control: Vec2, end: Vec2, evaluate: F)
where
    F: Fn(f64) -> Vec2,
{
    for t in [
        quadratic_extremum(start.x, control.x, end.x),
        quadratic_extremum(start.y, control.y, end.y),
    ]
    .into_iter()
    .flatten()
    .filter(|t| *t > 0.0 && *t < 1.0)
    {
        points.push(evaluate(t));
    }
}

fn quadratic_extremum(start: f64, control: f64, end: f64) -> Option<f64> {
    let denominator = start - 2.0 * control + end;
    if denominator.abs() <= f64::EPSILON { None } else { Some((start - control) / denominator) }
}

fn add_cubic_extrema<F>(points: &mut Vec<Vec2>, start: Vec2, control_1: Vec2, control_2: Vec2, end: Vec2, evaluate: F)
where
    F: Fn(f64) -> Vec2,
{
    for (a, b, c) in [
        cubic_derivative_coefficients(start.x, control_1.x, control_2.x, end.x),
        cubic_derivative_coefficients(start.y, control_1.y, control_2.y, end.y),
    ] {
        for t in quadratic_roots(a, b, c)
            .into_iter()
            .flatten()
            .filter(|t| *t > 0.0 && *t < 1.0)
        {
            points.push(evaluate(t));
        }
    }
}

fn cubic_derivative_coefficients(start: f64, control_1: f64, control_2: f64, end: f64) -> (f64, f64, f64) {
    (
        -start + 3.0 * control_1 - 3.0 * control_2 + end,
        2.0 * (start - 2.0 * control_1 + control_2),
        control_1 - start,
    )
}

fn quadratic_roots(a: f64, b: f64, c: f64) -> [Option<f64>; 2] {
    if a.abs() <= f64::EPSILON {
        return [if b.abs() > f64::EPSILON { Some(-c / b) } else { None }, None];
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return [None, None];
    }
    let root = discriminant.sqrt();
    [Some((-b - root) / (2.0 * a)), Some((-b + root) / (2.0 * a))]
}

fn quadratic_point(start: Vec2, control: Vec2, end: Vec2, t: f64) -> Vec2 {
    let inverse = 1.0 - t;
    Vec2 {
        x: inverse * inverse * start.x + 2.0 * inverse * t * control.x + t * t * end.x,
        y: inverse * inverse * start.y + 2.0 * inverse * t * control.y + t * t * end.y,
    }
}

fn cubic_point(start: Vec2, control_1: Vec2, control_2: Vec2, end: Vec2, t: f64) -> Vec2 {
    let inverse = 1.0 - t;
    Vec2 {
        x: inverse.powi(3) * start.x
            + 3.0 * inverse.powi(2) * t * control_1.x
            + 3.0 * inverse * t.powi(2) * control_2.x
            + t.powi(3) * end.x,
        y: inverse.powi(3) * start.y
            + 3.0 * inverse.powi(2) * t * control_1.y
            + 3.0 * inverse * t.powi(2) * control_2.y
            + t.powi(3) * end.y,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn union_contains_both_input_regions() {
        let left = Bounds { x: 0.0, y: 2.0, width: 4.0, height: 3.0 };
        let right = Bounds { x: 3.0, y: 0.0, width: 5.0, height: 4.0 };
        assert_eq!(union(left, right), Bounds { x: 0.0, y: 0.0, width: 8.0, height: 5.0 });
    }

    #[test]
    fn path_bounds_include_quadratic_and_cubic_extrema() {
        let geometry = PathGeometry {
            subpaths: vec![crate::PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Quadratic { control: Vec2 { x: 10.0, y: 20.0 }, to: Vec2 { x: 20.0, y: 0.0 } },
                    PathSegment::Cubic {
                        control_1: Vec2 { x: 30.0, y: -20.0 },
                        control_2: Vec2 { x: 40.0, y: 20.0 },
                        to: Vec2 { x: 50.0, y: 0.0 },
                    },
                ],
                closed: false,
            }],
            fill_rule: crate::PathFillRule::NonZero,
        };
        let bounds = path_bounds(&geometry);

        assert!((bounds.x - 0.0).abs() < 1e-12);
        assert!((bounds.y + 5.773502691896258).abs() < 1e-12);
        assert!((bounds.width - 50.0).abs() < 1e-12);
        assert!((bounds.height - 15.773502691896258).abs() < 1e-12);
    }

    #[test]
    fn closed_path_bounds_include_the_implicit_closing_line() {
        let geometry = PathGeometry {
            subpaths: vec![crate::PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 10.0, y: 20.0 } },
                    PathSegment::Line { to: Vec2 { x: 30.0, y: 20.0 } },
                ],
                closed: true,
            }],
            fill_rule: crate::PathFillRule::EvenOdd,
        };

        assert_eq!(
            path_bounds(&geometry),
            Bounds { x: 10.0, y: 20.0, width: 20.0, height: 0.0 }
        );
    }

    #[test]
    fn affine_composition_and_inverse_round_trip_a_child_point() {
        let parent = Affine::from_transform(crate::Transform {
            translation: crate::Vec2 { x: 10.0, y: 20.0 },
            rotation: std::f64::consts::FRAC_PI_2,
            scale_x: 2.0,
            scale_y: 1.0,
        });
        let child = Affine::from_transform(crate::Transform {
            translation: crate::Vec2 { x: 5.0, y: 0.0 },
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        });
        let matrix = parent.then(child);
        let local = crate::Vec2 { x: 3.0, y: 4.0 };
        let world = matrix.point(local);
        let restored = matrix.inverse().expect("non-singular transform").point(world);

        assert!((restored.x - local.x).abs() < f64::EPSILON);
        assert!((restored.y - local.y).abs() < f64::EPSILON);
    }
}
