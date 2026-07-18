use super::{Bounds, Document, EngineError, ShapeId, ShapeParent, ShapeRecord};

pub fn local_shape_bounds(shape: &ShapeRecord) -> Bounds {
    let width = numeric_property(shape, "width").unwrap_or(0.0).abs();
    let height = numeric_property(shape, "height").unwrap_or(0.0).abs();
    transformed_bounds(width, height, shape.transform)
}

pub fn world_shape_bounds(document: &Document, shape_id: &ShapeId) -> Bounds {
    let Some(shape) = document.shapes.get(shape_id) else {
        return Bounds { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
    };
    let mut bounds = local_shape_bounds(shape);
    let mut parent = shape.parent.clone();
    while let ShapeParent::Shape(parent_id) = parent {
        let Some(parent_shape) = document.shapes.get(&parent_id) else {
            break;
        };
        bounds.x += parent_shape.transform.translation.x;
        bounds.y += parent_shape.transform.translation.y;
        parent = parent_shape.parent.clone();
    }
    bounds
}

pub fn transformed_bounds(width: f64, height: f64, transform: crate::Transform) -> Bounds {
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
    let min_x = points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let max_x = points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let max_y = points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    Bounds { x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y }
}

pub fn numeric_property(shape: &ShapeRecord, name: &str) -> Option<f64> {
    shape
        .properties
        .get(name)
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
}

pub fn count_as_f64(count: usize) -> Result<f64, EngineError> {
    let count = u32::try_from(count).map_err(|_| EngineError::Invariant("layout selection is too large".into()))?;
    Ok(f64::from(count))
}

// FIXME: make these instance methods on Bounds
pub fn center_x(bounds: &Bounds) -> f64 {
    bounds.x + bounds.width / 2.0
}

pub fn center_y(bounds: &Bounds) -> f64 {
    bounds.y + bounds.height / 2.0
}

pub fn right(bounds: &Bounds) -> f64 {
    bounds.x + bounds.width
}

pub fn bottom(bounds: &Bounds) -> f64 {
    bounds.y + bounds.height
}

pub fn intersects(left: &Bounds, right_bounds: &Bounds) -> bool {
    left.x <= right(right_bounds)
        && right(left) >= right_bounds.x
        && left.y <= bottom(right_bounds)
        && bottom(left) >= right_bounds.y
}

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
}
