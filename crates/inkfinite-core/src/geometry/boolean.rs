//! Deterministic boolean operations for native filled paths.
//!
//! Boolean operations work on flattened copies of native curves. The result is
//! ordinary native path data made from line segments, so it can be edited,
//! serialized, and exported through the existing path pipeline.

use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;
use thiserror::Error;

use crate::path_metrics::flatten_path;
use crate::{PathFillRule, PathGeometry, PathSegment, PathSubpath, Vec2, validate_path_geometry};

/// Boolean operation applied from the first selected path to the remaining
/// paths in their selection order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize, schemars::JsonSchema, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum BooleanPathOperation {
    /// Combine all selected filled regions.
    Union,
    /// Keep only the region shared by every selected path.
    Intersection,
    /// Remove later selected regions from the first selected path.
    Difference,
    /// Keep regions covered by an odd number of selected paths.
    Exclusion,
}

/// Failure returned when a boolean operation cannot produce native path data.
#[derive(Clone, Debug, Error, PartialEq)]
pub enum BooleanPathError {
    /// At least two paths are required for a boolean operation.
    #[error("boolean paths requires at least two paths")]
    TooFewPaths,
    /// One input path did not satisfy the native geometry invariant.
    #[error("path {path} has invalid geometry: {message}")]
    InvalidGeometry {
        /// Index of the invalid input path.
        path: usize,
        /// Validation detail.
        message: String,
    },
    /// Boolean operations require filled closed subpaths.
    #[error("path {path} subpath {subpath} is open")]
    OpenSubpath {
        /// Index of the input path.
        path: usize,
        /// Index of the open subpath.
        subpath: usize,
    },
    /// A subpath did not contain enough distinct points to form an area.
    #[error("path {path} subpath {subpath} is degenerate")]
    DegenerateSubpath {
        /// Index of the input path.
        path: usize,
        /// Index of the degenerate subpath.
        subpath: usize,
    },
    /// The operation removed every filled region.
    #[error("boolean operation produced an empty path")]
    EmptyResult,
    /// The polygon engine returned a non-finite point.
    #[error("boolean operation produced a non-finite point")]
    NonFiniteResult,
}

/// Applies one boolean operation to native path geometries in shared local
/// coordinates.
///
/// Curves are adaptively flattened with a fixed geometric tolerance before the
/// polygon overlay. The result uses the first path's fill rule and contains
/// only line segments. Callers combining shapes with different transforms
/// should transform each geometry into one coordinate space first.
///
/// # Errors
///
/// Returns [`BooleanPathError`] when an input is invalid, open, degenerate, or
/// the selected operation has no filled result.
pub fn boolean_path_operation(
    paths: &[PathGeometry], operation: BooleanPathOperation,
) -> Result<PathGeometry, BooleanPathError> {
    if paths.len() < 2 {
        return Err(BooleanPathError::TooFewPaths);
    }

    let fill_rule = paths[0].fill_rule;
    let overlay_fill_rule = match fill_rule {
        PathFillRule::NonZero => FillRule::NonZero,
        PathFillRule::EvenOdd => FillRule::EvenOdd,
    };
    let overlay_rule = match operation {
        BooleanPathOperation::Union => OverlayRule::Union,
        BooleanPathOperation::Intersection => OverlayRule::Intersect,
        BooleanPathOperation::Difference => OverlayRule::Difference,
        BooleanPathOperation::Exclusion => OverlayRule::Xor,
    };

    let mut result = vec![contours_for_path(&paths[0], 0)?];
    for (path_index, path) in paths.iter().enumerate().skip(1) {
        let clip = vec![contours_for_path(path, path_index)?];
        result = result.overlay(&clip, overlay_rule, overlay_fill_rule);
    }

    let subpaths = result
        .into_iter()
        .flat_map(|shape| shape.into_iter())
        .map(|contour| {
            let points = contour
                .into_iter()
                .map(|point| Vec2 { x: point[0], y: point[1] })
                .collect::<Vec<_>>();
            if points.iter().any(|point| !point.x.is_finite() || !point.y.is_finite()) {
                return Err(BooleanPathError::NonFiniteResult);
            }
            Ok(PathSubpath { segments: points_to_segments(points), closed: true, handle_modes: None })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if subpaths.is_empty() {
        return Err(BooleanPathError::EmptyResult);
    }
    let geometry = PathGeometry { subpaths, fill_rule };
    validate_path_geometry(&geometry)
        .map_err(|error| BooleanPathError::InvalidGeometry { path: 0, message: error.to_string() })?;
    Ok(geometry)
}

const BOOLEAN_FLATTEN_TOLERANCE: f64 = 0.1;

fn contours_for_path(geometry: &PathGeometry, path_index: usize) -> Result<Vec<Vec<[f64; 2]>>, BooleanPathError> {
    validate_path_geometry(geometry)
        .map_err(|error| BooleanPathError::InvalidGeometry { path: path_index, message: error.to_string() })?;
    let flattened = flatten_path(geometry, BOOLEAN_FLATTEN_TOLERANCE);
    flattened
        .subpaths
        .into_iter()
        .enumerate()
        .map(|(subpath_index, subpath)| {
            if !subpath.closed {
                return Err(BooleanPathError::OpenSubpath { path: path_index, subpath: subpath_index });
            }
            let points = subpath
                .points
                .into_iter()
                .map(|point| [point.x, point.y])
                .collect::<Vec<_>>();
            if points.len() < 3 || points.windows(2).all(|pair| pair[0] == pair[1]) {
                return Err(BooleanPathError::DegenerateSubpath { path: path_index, subpath: subpath_index });
            }
            Ok(points)
        })
        .collect()
}

fn points_to_segments(points: Vec<Vec2>) -> Vec<PathSegment> {
    let mut segments = Vec::with_capacity(points.len());
    if let Some(first) = points.first().copied() {
        segments.push(PathSegment::Move { to: first });
        segments.extend(points.into_iter().skip(1).map(|to| PathSegment::Line { to }));
    }
    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rectangle(x: f64, y: f64, width: f64, height: f64, fill_rule: PathFillRule) -> PathGeometry {
        PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x, y } },
                    PathSegment::Line { to: Vec2 { x: x + width, y } },
                    PathSegment::Line { to: Vec2 { x: x + width, y: y + height } },
                    PathSegment::Line { to: Vec2 { x, y: y + height } },
                ],
                closed: true,
                handle_modes: None,
            }],
            fill_rule,
        }
    }

    #[test]
    fn combines_overlapping_rectangles_deterministically() {
        let result = boolean_path_operation(
            &[
                rectangle(0.0, 0.0, 10.0, 10.0, PathFillRule::EvenOdd),
                rectangle(5.0, 0.0, 10.0, 10.0, PathFillRule::EvenOdd),
            ],
            BooleanPathOperation::Union,
        )
        .expect("overlapping rectangles should combine");

        assert_eq!(result.fill_rule, PathFillRule::EvenOdd);
        assert_eq!(result.subpaths.len(), 1);
        assert_eq!(result.subpaths[0].segments.len(), 4);
        assert!(validate_path_geometry(&result).is_ok());
    }

    #[test]
    fn preserves_nested_compound_geometry_and_fill_rule() {
        let outer = rectangle(0.0, 0.0, 20.0, 20.0, PathFillRule::EvenOdd);
        let inner = rectangle(5.0, 5.0, 10.0, 10.0, PathFillRule::EvenOdd);
        let result = boolean_path_operation(&[outer, inner], BooleanPathOperation::Difference)
            .expect("nested difference should produce a ring");

        assert_eq!(result.fill_rule, PathFillRule::EvenOdd);
        assert_eq!(result.subpaths.len(), 2);
        assert!(result.subpaths.iter().all(|subpath| subpath.closed));
    }

    #[test]
    fn combines_compound_input_with_another_path() {
        let mut compound = rectangle(0.0, 0.0, 20.0, 20.0, PathFillRule::EvenOdd);
        let inner = rectangle(5.0, 5.0, 10.0, 10.0, PathFillRule::EvenOdd);
        compound.subpaths.push(inner.subpaths[0].clone());
        let result = boolean_path_operation(
            &[compound, rectangle(10.0, 0.0, 20.0, 20.0, PathFillRule::EvenOdd)],
            BooleanPathOperation::Union,
        )
        .expect("compound input should combine");
        assert!(result.subpaths.len() >= 2);
        assert!(validate_path_geometry(&result).is_ok());
    }

    #[test]
    fn resolves_self_intersecting_input() {
        let bow = PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Line { to: Vec2 { x: 10.0, y: 10.0 } },
                    PathSegment::Line { to: Vec2 { x: 0.0, y: 10.0 } },
                    PathSegment::Line { to: Vec2 { x: 10.0, y: 0.0 } },
                ],
                closed: true,
                handle_modes: None,
            }],
            fill_rule: PathFillRule::EvenOdd,
        };
        let result = boolean_path_operation(
            &[bow, rectangle(-1.0, -1.0, 12.0, 12.0, PathFillRule::EvenOdd)],
            BooleanPathOperation::Intersection,
        )
        .expect("self-intersecting input should be normalized");
        assert!(validate_path_geometry(&result).is_ok());
    }

    #[test]
    fn rejects_open_and_empty_results() {
        let mut open = rectangle(0.0, 0.0, 10.0, 10.0, PathFillRule::NonZero);
        open.subpaths[0].closed = false;
        assert!(matches!(
            boolean_path_operation(
                &[open, rectangle(1.0, 1.0, 2.0, 2.0, PathFillRule::NonZero)],
                BooleanPathOperation::Union
            ),
            Err(BooleanPathError::OpenSubpath { .. })
        ));
        assert_eq!(
            boolean_path_operation(
                &[
                    rectangle(0.0, 0.0, 1.0, 1.0, PathFillRule::NonZero),
                    rectangle(0.0, 0.0, 1.0, 1.0, PathFillRule::NonZero),
                ],
                BooleanPathOperation::Difference
            ),
            Err(BooleanPathError::EmptyResult)
        );
    }
}
