use super::{Bounds, Document, EngineError, ShapeId, ShapeParent, ShapeRecord};
use crate::{Transform, Vec2};

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
    let width = numeric_property(shape, "width").unwrap_or(0.0).abs();
    let height = numeric_property(shape, "height").unwrap_or(0.0).abs();
    Affine::from_transform(shape.transform).transform_bounds(Bounds { x: 0.0, y: 0.0, width, height })
}

/// Returns a shape's axis-aligned bounds in document coordinates.
#[must_use]
pub fn world_shape_bounds(document: &Document, shape_id: &ShapeId) -> Bounds {
    let Some(shape) = document.shapes.get(shape_id) else {
        return Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
    };
    let width = numeric_property(shape, "width").unwrap_or(0.0).abs();
    let height = numeric_property(shape, "height").unwrap_or(0.0).abs();
    world_transform(document, shape).transform_bounds(Bounds { x: 0.0, y: 0.0, width, height })
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
