//! Canonical native path topology operations.
//!
//! These operations are shared by interactive editors and other document
//! clients. They mutate normalized geometry only; callers remain responsible
//! for applying the resulting properties through the transaction engine.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::{PathGeometry, PathHandleMode, PathSegment, PathSubpath, Vec2};

/// Curve kind used when converting a straight path segment.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PathCurveKind {
    /// A quadratic Bézier with one control point.
    Quadratic,
    /// A cubic Bézier with two control points.
    Cubic,
}

/// One deterministic edit to normalized path topology.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum PathTopologyOperation {
    /// Split a segment at a parameter strictly between zero and one.
    AddAnchor {
        /// Subpath containing the segment.
        subpath_index: usize,
        /// Segment whose destination anchor is split.
        segment_index: usize,
        /// Curve parameter at which the new anchor is inserted.
        t: f64,
    },
    /// Remove the anchor identified by a segment destination.
    DeleteAnchor {
        /// Subpath containing the anchor.
        subpath_index: usize,
        /// Segment whose destination anchor is removed.
        segment_index: usize,
    },
    /// Convert a straight segment into a quadratic or cubic curve.
    ConvertToCurve {
        /// Subpath containing the segment.
        subpath_index: usize,
        /// Segment to convert.
        segment_index: usize,
        /// Curve representation to create.
        curve: PathCurveKind,
    },
    /// Discard curve controls and retain the segment destination.
    ConvertToLine {
        /// Subpath containing the segment.
        subpath_index: usize,
        /// Segment to convert.
        segment_index: usize,
    },
    /// Make a closed subpath open by removing its implicit closing edge.
    OpenPath {
        /// Subpath to open.
        subpath_index: usize,
    },
    /// Make an open subpath closed with an implicit edge to its move point.
    ClosePath {
        /// Subpath to close.
        subpath_index: usize,
    },
    /// Join the selected endpoints of two open subpaths into one open subpath.
    JoinEndpoints {
        /// First subpath containing an endpoint.
        first_subpath_index: usize,
        /// Whether the first endpoint is the move-point endpoint.
        first_at_start: bool,
        /// Second subpath containing an endpoint.
        second_subpath_index: usize,
        /// Whether the second endpoint is the move-point endpoint.
        second_at_start: bool,
    },
    /// Make the handles at an anchor independent.
    BreakHandles {
        /// Subpath containing the anchor.
        subpath_index: usize,
        /// Anchor segment index whose handles are changed.
        segment_index: usize,
    },
    /// Align the handles at an anchor and mark them as joined.
    JoinHandles {
        /// Subpath containing the anchor.
        subpath_index: usize,
        /// Anchor segment index whose handles are changed.
        segment_index: usize,
    },
}

/// Failure returned when a path topology operation cannot preserve normalized geometry.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PathTopologyError {
    /// The operation refers to an unknown subpath.
    #[error("path subpath {0} does not exist")]
    UnknownSubpath(usize),
    /// The operation refers to an unknown segment.
    #[error("path subpath {subpath} segment {segment} does not exist")]
    UnknownSegment { subpath: usize, segment: usize },
    /// The operation targets the move segment instead of an anchor-ending segment.
    #[error("path subpath {subpath} segment {segment} is not an editable segment")]
    MoveSegment { subpath: usize, segment: usize },
    /// The split parameter is outside the interior of the segment.
    #[error("path split parameter must be finite and strictly between zero and one")]
    InvalidParameter,
    /// The operation requires a closed subpath.
    #[error("path subpath {subpath} is already open")]
    AlreadyOpen { subpath: usize },
    /// The operation requires an open subpath.
    #[error("path subpath {subpath} is already closed")]
    AlreadyClosed { subpath: usize },
    /// Joining an endpoint to another endpoint in the same subpath is not supported.
    #[error("path subpath {subpath} cannot join an endpoint to itself")]
    SameSubpath { subpath: usize },
    /// Joining requires open subpaths.
    #[error("path subpath {subpath} is closed and cannot be joined")]
    ClosedSubpath { subpath: usize },
    /// Removing this anchor would leave no move segment.
    #[error("path subpath {subpath} cannot delete its only anchor")]
    OnlyAnchor { subpath: usize },
    /// The supplied geometry could not be used as normalized path data.
    #[error("invalid path geometry: {0}")]
    InvalidGeometry(String),
}

/// Applies one canonical topology operation in place.
///
/// The caller should run [`crate::validate_path_geometry`] after applying a
/// sequence of operations. This function preserves all segment coordinates
/// not needed by the requested topology change.
///
/// # Errors
///
/// Returns [`PathTopologyError`] when the target or split parameter is invalid.
pub fn apply_path_topology_operation(
    geometry: &mut PathGeometry, operation: &PathTopologyOperation,
) -> Result<(), PathTopologyError> {
    crate::validate_path_geometry(geometry).map_err(|error| PathTopologyError::InvalidGeometry(error.to_string()))?;
    match operation {
        PathTopologyOperation::AddAnchor { subpath_index, segment_index, t } => {
            split_segment(geometry, *subpath_index, *segment_index, *t)
        }
        PathTopologyOperation::DeleteAnchor { subpath_index, segment_index } => {
            delete_anchor(geometry, *subpath_index, *segment_index)
        }
        PathTopologyOperation::ConvertToCurve { subpath_index, segment_index, curve } => {
            convert_to_curve(geometry, *subpath_index, *segment_index, *curve)
        }
        PathTopologyOperation::ConvertToLine { subpath_index, segment_index } => {
            convert_to_line(geometry, *subpath_index, *segment_index)
        }
        PathTopologyOperation::OpenPath { subpath_index } => open_path(geometry, *subpath_index),
        PathTopologyOperation::ClosePath { subpath_index } => close_path(geometry, *subpath_index),
        PathTopologyOperation::JoinEndpoints {
            first_subpath_index,
            first_at_start,
            second_subpath_index,
            second_at_start,
        } => join_endpoints(
            geometry,
            *first_subpath_index,
            *first_at_start,
            *second_subpath_index,
            *second_at_start,
        ),
        PathTopologyOperation::BreakHandles { subpath_index, segment_index } => {
            set_handle_mode(geometry, *subpath_index, *segment_index, PathHandleMode::Broken)
        }
        PathTopologyOperation::JoinHandles { subpath_index, segment_index } => {
            join_handles(geometry, *subpath_index, *segment_index)
        }
    }
}

/// Applies a sequence of canonical topology operations in order.
///
/// # Errors
///
/// Returns the first topology error or a normalized-geometry validation error.
pub fn apply_path_topology_operations(
    geometry: &mut PathGeometry, operations: &[PathTopologyOperation],
) -> Result<(), PathTopologyError> {
    let mut candidate = geometry.clone();
    for operation in operations {
        apply_path_topology_operation(&mut candidate, operation)?;
    }
    crate::validate_path_geometry(&candidate).map_err(|error| PathTopologyError::InvalidGeometry(error.to_string()))?;
    *geometry = candidate;
    Ok(())
}

fn open_path(geometry: &mut PathGeometry, subpath_index: usize) -> Result<(), PathTopologyError> {
    let subpath = subpath_mut(geometry, subpath_index)?;
    if !subpath.closed {
        return Err(PathTopologyError::AlreadyOpen { subpath: subpath_index });
    }
    subpath.closed = false;
    Ok(())
}

fn close_path(geometry: &mut PathGeometry, subpath_index: usize) -> Result<(), PathTopologyError> {
    let subpath = subpath_mut(geometry, subpath_index)?;
    if subpath.closed {
        return Err(PathTopologyError::AlreadyClosed { subpath: subpath_index });
    }
    subpath.closed = true;
    Ok(())
}

fn join_endpoints(
    geometry: &mut PathGeometry, first_subpath_index: usize, first_at_start: bool, second_subpath_index: usize,
    second_at_start: bool,
) -> Result<(), PathTopologyError> {
    if first_subpath_index == second_subpath_index {
        return Err(PathTopologyError::SameSubpath { subpath: first_subpath_index });
    }
    let first = geometry
        .subpaths
        .get(first_subpath_index)
        .ok_or(PathTopologyError::UnknownSubpath(first_subpath_index))?;
    let second = geometry
        .subpaths
        .get(second_subpath_index)
        .ok_or(PathTopologyError::UnknownSubpath(second_subpath_index))?;
    if first.closed {
        return Err(PathTopologyError::ClosedSubpath { subpath: first_subpath_index });
    }
    if second.closed {
        return Err(PathTopologyError::ClosedSubpath { subpath: second_subpath_index });
    }

    let mut first = first.clone();
    let mut second = second.clone();
    if first_at_start {
        first = reverse_subpath(first);
    }
    if !second_at_start {
        second = reverse_subpath(second);
    }

    let first_end = first
        .segments
        .last()
        .map(segment_to)
        .ok_or_else(|| PathTopologyError::InvalidGeometry("cannot join an empty subpath".into()))?;
    let second_start = second
        .segments
        .first()
        .map(segment_to)
        .ok_or_else(|| PathTopologyError::InvalidGeometry("cannot join an empty subpath".into()))?;
    let first_modes = handle_modes(&first);
    let second_modes = handle_modes(&second);
    let has_handle_modes = first.handle_modes.is_some() || second.handle_modes.is_some();

    let mut merged_segments = first.segments;
    let mut merged_modes = first_modes;
    if !same_point(first_end, second_start) {
        merged_segments.push(PathSegment::Line { to: second_start });
        merged_modes.push(second_modes[0]);
    }
    merged_segments.extend(second.segments.into_iter().skip(1));
    merged_modes.extend(second_modes.into_iter().skip(1));

    let merged = PathSubpath {
        segments: merged_segments,
        closed: false,
        handle_modes: has_handle_modes.then_some(merged_modes),
    };
    let target_index = first_subpath_index.min(second_subpath_index);
    let removed_index = first_subpath_index.max(second_subpath_index);
    geometry.subpaths[target_index] = merged;
    geometry.subpaths.remove(removed_index);
    Ok(())
}

fn reverse_subpath(subpath: PathSubpath) -> PathSubpath {
    let original = subpath.segments;
    let mut segments = Vec::with_capacity(original.len());
    if let Some(last) = original.last() {
        segments.push(PathSegment::Move { to: segment_to(last) });
        for index in (1..original.len()).rev() {
            let start = segment_to(&original[index - 1]);
            segments.push(reverse_segment(original[index], start));
        }
    }
    PathSubpath {
        segments,
        closed: subpath.closed,
        handle_modes: subpath.handle_modes.map(|modes| modes.into_iter().rev().collect()),
    }
}

fn reverse_segment(segment: PathSegment, start: Vec2) -> PathSegment {
    match segment {
        PathSegment::Move { .. } => PathSegment::Move { to: start },
        PathSegment::Line { .. } => PathSegment::Line { to: start },
        PathSegment::Quadratic { control, .. } => PathSegment::Quadratic { control, to: start },
        PathSegment::Cubic { control_1, control_2, .. } => {
            PathSegment::Cubic { control_1: control_2, control_2: control_1, to: start }
        }
    }
}

fn handle_modes(subpath: &PathSubpath) -> Vec<PathHandleMode> {
    subpath
        .handle_modes
        .clone()
        .unwrap_or_else(|| vec![PathHandleMode::Broken; subpath.segments.len()])
}

fn same_point(left: Vec2, right: Vec2) -> bool {
    left.x == right.x && left.y == right.y
}

fn split_segment(
    geometry: &mut PathGeometry, subpath_index: usize, segment_index: usize, t: f64,
) -> Result<(), PathTopologyError> {
    validate_parameter(t)?;
    let subpath = subpath_mut(geometry, subpath_index)?;
    if segment_index == 0 {
        return Err(PathTopologyError::MoveSegment { subpath: subpath_index, segment: segment_index });
    }
    let closing = segment_index == subpath.segments.len() && subpath.closed;
    let segment = if closing {
        PathSegment::Line { to: segment_to(&subpath.segments[0]) }
    } else {
        *subpath
            .segments
            .get(segment_index)
            .ok_or(PathTopologyError::UnknownSegment { subpath: subpath_index, segment: segment_index })?
    };
    let start = if closing {
        segment_to(
            subpath
                .segments
                .last()
                .ok_or(PathTopologyError::UnknownSubpath(subpath_index))?,
        )
    } else {
        segment_start(subpath, segment_index)?
    };
    let (first, second) = match segment {
        PathSegment::Line { to } => {
            let middle = lerp(start, to, t);
            (PathSegment::Line { to: middle }, PathSegment::Line { to })
        }
        PathSegment::Quadratic { control, to } => {
            let first_control = lerp(start, control, t);
            let second_control = lerp(control, to, t);
            let middle = lerp(first_control, second_control, t);
            (
                PathSegment::Quadratic { control: first_control, to: middle },
                PathSegment::Quadratic { control: second_control, to },
            )
        }
        PathSegment::Cubic { control_1, control_2, to } => {
            let first_control = lerp(start, control_1, t);
            let bridge = lerp(control_1, control_2, t);
            let second_control = lerp(control_2, to, t);
            let first_bridge = lerp(first_control, bridge, t);
            let second_bridge = lerp(bridge, second_control, t);
            let middle = lerp(first_bridge, second_bridge, t);
            (
                PathSegment::Cubic { control_1: first_control, control_2: first_bridge, to: middle },
                PathSegment::Cubic { control_1: second_bridge, control_2: second_control, to },
            )
        }
        PathSegment::Move { .. } => {
            return Err(PathTopologyError::MoveSegment { subpath: subpath_index, segment: segment_index });
        }
    };
    if closing {
        subpath.segments.push(first);
        if let Some(modes) = &mut subpath.handle_modes {
            modes.push(PathHandleMode::Joined);
        }
    } else {
        subpath.segments[segment_index] = first;
        subpath.segments.insert(segment_index + 1, second);
        if let Some(modes) = &mut subpath.handle_modes {
            modes.insert(segment_index + 1, PathHandleMode::Joined);
        }
    }
    Ok(())
}

fn delete_anchor(
    geometry: &mut PathGeometry, subpath_index: usize, segment_index: usize,
) -> Result<(), PathTopologyError> {
    let subpath = subpath_mut(geometry, subpath_index)?;
    if subpath.segments.len() == 1 {
        return Err(PathTopologyError::OnlyAnchor { subpath: subpath_index });
    }
    if segment_index >= subpath.segments.len() {
        return Err(PathTopologyError::UnknownSegment { subpath: subpath_index, segment: segment_index });
    }
    if segment_index == 0 {
        let new_start = segment_to(&subpath.segments[1]);
        subpath.segments[0] = PathSegment::Move { to: new_start };
        subpath.segments.remove(1);
        if let Some(modes) = &mut subpath.handle_modes {
            let replacement = modes.get(1).copied().unwrap_or(PathHandleMode::Broken);
            modes[0] = replacement;
            modes.remove(1);
        }
    } else {
        subpath.segments.remove(segment_index);
        if let Some(modes) = &mut subpath.handle_modes {
            modes.remove(segment_index);
        }
    }
    Ok(())
}

fn convert_to_curve(
    geometry: &mut PathGeometry, subpath_index: usize, segment_index: usize, curve: PathCurveKind,
) -> Result<(), PathTopologyError> {
    let subpath = subpath_mut(geometry, subpath_index)?;
    if segment_index == 0 {
        return Err(PathTopologyError::MoveSegment { subpath: subpath_index, segment: segment_index });
    }
    let segment = *subpath
        .segments
        .get(segment_index)
        .ok_or(PathTopologyError::UnknownSegment { subpath: subpath_index, segment: segment_index })?;
    let PathSegment::Line { to } = segment else {
        return Ok(());
    };
    let start = segment_start(subpath, segment_index)?;
    subpath.segments[segment_index] = match curve {
        PathCurveKind::Quadratic => PathSegment::Quadratic { control: lerp(start, to, 0.5), to },
        PathCurveKind::Cubic => {
            PathSegment::Cubic { control_1: lerp(start, to, 1.0 / 3.0), control_2: lerp(start, to, 2.0 / 3.0), to }
        }
    };
    Ok(())
}

fn convert_to_line(
    geometry: &mut PathGeometry, subpath_index: usize, segment_index: usize,
) -> Result<(), PathTopologyError> {
    let subpath = subpath_mut(geometry, subpath_index)?;
    if segment_index == 0 {
        return Err(PathTopologyError::MoveSegment { subpath: subpath_index, segment: segment_index });
    }
    let segment = subpath
        .segments
        .get_mut(segment_index)
        .ok_or(PathTopologyError::UnknownSegment { subpath: subpath_index, segment: segment_index })?;
    let to = match *segment {
        PathSegment::Move { .. } => {
            return Err(PathTopologyError::MoveSegment { subpath: subpath_index, segment: segment_index });
        }
        PathSegment::Line { to } | PathSegment::Quadratic { to, .. } | PathSegment::Cubic { to, .. } => to,
    };
    *segment = PathSegment::Line { to };
    Ok(())
}

fn set_handle_mode(
    geometry: &mut PathGeometry, subpath_index: usize, segment_index: usize, mode: PathHandleMode,
) -> Result<(), PathTopologyError> {
    let subpath = subpath_mut(geometry, subpath_index)?;
    if segment_index >= subpath.segments.len() {
        return Err(PathTopologyError::UnknownSegment { subpath: subpath_index, segment: segment_index });
    }
    ensure_handle_modes(subpath)[segment_index] = mode;
    Ok(())
}

fn join_handles(
    geometry: &mut PathGeometry, subpath_index: usize, segment_index: usize,
) -> Result<(), PathTopologyError> {
    let subpath = subpath_mut(geometry, subpath_index)?;
    if segment_index >= subpath.segments.len() {
        return Err(PathTopologyError::UnknownSegment { subpath: subpath_index, segment: segment_index });
    }
    if segment_index > 0 && segment_index + 1 < subpath.segments.len() {
        let anchor = segment_to(&subpath.segments[segment_index]);
        let incoming = match subpath.segments[segment_index] {
            PathSegment::Cubic { control_2, .. } => Some(control_2),
            _ => None,
        };
        let outgoing = match subpath.segments[segment_index + 1] {
            PathSegment::Cubic { control_1, .. } => Some(control_1),
            _ => None,
        };
        if let (Some(incoming), Some(outgoing)) = (incoming, outgoing) {
            let mut direction = subtract(outgoing, anchor);
            let outgoing_length = length(direction);
            if outgoing_length <= f64::EPSILON {
                direction = subtract(anchor, incoming);
            }
            let direction_length = length(direction);
            if direction_length > f64::EPSILON {
                direction = scale(direction, 1.0 / direction_length);
                let incoming_length = length(subtract(incoming, anchor));
                let outgoing_length = length(subtract(outgoing, anchor));
                if let PathSegment::Cubic { control_2, .. } = &mut subpath.segments[segment_index] {
                    *control_2 = subtract(anchor, scale(direction, incoming_length));
                }
                if let PathSegment::Cubic { control_1, .. } = &mut subpath.segments[segment_index + 1] {
                    *control_1 = add(anchor, scale(direction, outgoing_length));
                }
            }
        }
    }
    ensure_handle_modes(subpath)[segment_index] = PathHandleMode::Joined;
    Ok(())
}

fn subpath_mut(geometry: &mut PathGeometry, index: usize) -> Result<&mut PathSubpath, PathTopologyError> {
    geometry
        .subpaths
        .get_mut(index)
        .ok_or(PathTopologyError::UnknownSubpath(index))
}

fn segment_start(subpath: &PathSubpath, segment_index: usize) -> Result<Vec2, PathTopologyError> {
    if segment_index == 0 {
        return Err(PathTopologyError::MoveSegment { subpath: 0, segment: segment_index });
    }
    subpath
        .segments
        .get(segment_index - 1)
        .map(segment_to)
        .ok_or(PathTopologyError::UnknownSegment { subpath: 0, segment: segment_index })
}

fn segment_to(segment: &PathSegment) -> Vec2 {
    match *segment {
        PathSegment::Move { to }
        | PathSegment::Line { to }
        | PathSegment::Quadratic { to, .. }
        | PathSegment::Cubic { to, .. } => to,
    }
}

fn ensure_handle_modes(subpath: &mut PathSubpath) -> &mut Vec<PathHandleMode> {
    subpath
        .handle_modes
        .get_or_insert_with(|| vec![PathHandleMode::Broken; subpath.segments.len()])
}

fn validate_parameter(t: f64) -> Result<(), PathTopologyError> {
    if t.is_finite() && t > 0.0 && t < 1.0 { Ok(()) } else { Err(PathTopologyError::InvalidParameter) }
}

fn lerp(start: Vec2, end: Vec2, t: f64) -> Vec2 {
    Vec2 { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
}

fn subtract(left: Vec2, right: Vec2) -> Vec2 {
    Vec2 { x: left.x - right.x, y: left.y - right.y }
}

fn add(left: Vec2, right: Vec2) -> Vec2 {
    Vec2 { x: left.x + right.x, y: left.y + right.y }
}

fn scale(point: Vec2, factor: f64) -> Vec2 {
    Vec2 { x: point.x * factor, y: point.y * factor }
}

fn length(point: Vec2) -> f64 {
    point.x.hypot(point.y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry() -> PathGeometry {
        PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Line { to: Vec2 { x: 30.0, y: 0.0 } },
                    PathSegment::Cubic {
                        control_1: Vec2 { x: 40.0, y: 0.0 },
                        control_2: Vec2 { x: 50.0, y: 20.0 },
                        to: Vec2 { x: 60.0, y: 20.0 },
                    },
                ],
                closed: false,
                handle_modes: None,
            }],
            fill_rule: crate::PathFillRule::NonZero,
        }
    }

    #[test]
    fn splits_lines_and_curves_with_de_casteljau_geometry() {
        let mut line = geometry();
        apply_path_topology_operation(
            &mut line,
            &PathTopologyOperation::AddAnchor { subpath_index: 0, segment_index: 1, t: 0.5 },
        )
        .expect("line split");
        assert_eq!(
            line.subpaths[0].segments[1],
            PathSegment::Line { to: Vec2 { x: 15.0, y: 0.0 } }
        );
        assert_eq!(line.subpaths[0].segments.len(), 4);

        let mut curve = geometry();
        apply_path_topology_operation(
            &mut curve,
            &PathTopologyOperation::AddAnchor { subpath_index: 0, segment_index: 2, t: 0.5 },
        )
        .expect("curve split");
        assert_eq!(curve.subpaths[0].segments.len(), 4);
        assert!(matches!(curve.subpaths[0].segments[2], PathSegment::Cubic { .. }));
        assert!(crate::validate_path_geometry(&curve).is_ok());
    }

    #[test]
    fn converts_segments_and_deletes_anchors() {
        let mut geometry = geometry();
        apply_path_topology_operation(
            &mut geometry,
            &PathTopologyOperation::ConvertToCurve {
                subpath_index: 0,
                segment_index: 1,
                curve: PathCurveKind::Quadratic,
            },
        )
        .expect("line to curve");
        assert!(matches!(
            geometry.subpaths[0].segments[1],
            PathSegment::Quadratic { .. }
        ));
        apply_path_topology_operation(
            &mut geometry,
            &PathTopologyOperation::ConvertToLine { subpath_index: 0, segment_index: 2 },
        )
        .expect("curve to line");
        assert!(matches!(geometry.subpaths[0].segments[2], PathSegment::Line { .. }));
        apply_path_topology_operation(
            &mut geometry,
            &PathTopologyOperation::DeleteAnchor { subpath_index: 0, segment_index: 1 },
        )
        .expect("delete anchor");
        assert_eq!(geometry.subpaths[0].segments.len(), 2);
        assert!(crate::validate_path_geometry(&geometry).is_ok());
    }

    #[test]
    fn joins_and_breaks_cubic_handles() {
        let mut geometry = geometry();
        apply_path_topology_operation(
            &mut geometry,
            &PathTopologyOperation::JoinHandles { subpath_index: 0, segment_index: 1 },
        )
        .expect("join handles");
        assert_eq!(
            geometry.subpaths[0].handle_modes.as_ref().unwrap()[1],
            PathHandleMode::Joined
        );
        apply_path_topology_operation(
            &mut geometry,
            &PathTopologyOperation::BreakHandles { subpath_index: 0, segment_index: 1 },
        )
        .expect("break handles");
        assert_eq!(
            geometry.subpaths[0].handle_modes.as_ref().unwrap()[1],
            PathHandleMode::Broken
        );
    }

    #[test]
    fn opens_and_closes_subpaths_without_changing_compound_fill_rule() {
        let mut geometry = PathGeometry {
            subpaths: vec![
                PathSubpath {
                    segments: vec![
                        PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                        PathSegment::Line { to: Vec2 { x: 10.0, y: 0.0 } },
                    ],
                    closed: false,
                    handle_modes: None,
                },
                PathSubpath {
                    segments: vec![
                        PathSegment::Move { to: Vec2 { x: 20.0, y: 20.0 } },
                        PathSegment::Line { to: Vec2 { x: 30.0, y: 20.0 } },
                    ],
                    closed: true,
                    handle_modes: None,
                },
            ],
            fill_rule: crate::PathFillRule::EvenOdd,
        };
        apply_path_topology_operation(&mut geometry, &PathTopologyOperation::ClosePath { subpath_index: 0 })
            .expect("close path");
        apply_path_topology_operation(&mut geometry, &PathTopologyOperation::OpenPath { subpath_index: 1 })
            .expect("open path");
        assert!(geometry.subpaths[0].closed);
        assert!(!geometry.subpaths[1].closed);
        assert_eq!(geometry.fill_rule, crate::PathFillRule::EvenOdd);
        assert!(crate::validate_path_geometry(&geometry).is_ok());
    }

    #[test]
    fn joins_open_endpoints_and_reverses_selected_orientations() {
        let mut geometry = PathGeometry {
            subpaths: vec![
                PathSubpath {
                    segments: vec![
                        PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                        PathSegment::Line { to: Vec2 { x: 10.0, y: 0.0 } },
                    ],
                    closed: false,
                    handle_modes: None,
                },
                PathSubpath {
                    segments: vec![
                        PathSegment::Move { to: Vec2 { x: 20.0, y: 0.0 } },
                        PathSegment::Line { to: Vec2 { x: 30.0, y: 0.0 } },
                    ],
                    closed: false,
                    handle_modes: None,
                },
            ],
            fill_rule: crate::PathFillRule::NonZero,
        };
        apply_path_topology_operation(
            &mut geometry,
            &PathTopologyOperation::JoinEndpoints {
                first_subpath_index: 0,
                first_at_start: true,
                second_subpath_index: 1,
                second_at_start: false,
            },
        )
        .expect("join endpoints");

        assert_eq!(geometry.subpaths.len(), 1);
        assert_eq!(
            geometry.subpaths[0].segments,
            vec![
                PathSegment::Move { to: Vec2 { x: 10.0, y: 0.0 } },
                PathSegment::Line { to: Vec2 { x: 0.0, y: 0.0 } },
                PathSegment::Line { to: Vec2 { x: 30.0, y: 0.0 } },
                PathSegment::Line { to: Vec2 { x: 20.0, y: 0.0 } },
            ]
        );
        assert_eq!(geometry.fill_rule, crate::PathFillRule::NonZero);
        assert!(crate::validate_path_geometry(&geometry).is_ok());
    }

    #[test]
    fn rejects_invalid_path_topology_operations() {
        let mut geometry = geometry();
        assert_eq!(
            apply_path_topology_operation(&mut geometry, &PathTopologyOperation::OpenPath { subpath_index: 0 }),
            Err(PathTopologyError::AlreadyOpen { subpath: 0 })
        );
        assert_eq!(
            apply_path_topology_operation(
                &mut geometry,
                &PathTopologyOperation::JoinEndpoints {
                    first_subpath_index: 0,
                    first_at_start: false,
                    second_subpath_index: 0,
                    second_at_start: true,
                }
            ),
            Err(PathTopologyError::SameSubpath { subpath: 0 })
        );

        geometry.subpaths[0].handle_modes = Some(Vec::new());
        assert!(matches!(
            apply_path_topology_operation(&mut geometry, &PathTopologyOperation::ClosePath { subpath_index: 0 }),
            Err(PathTopologyError::InvalidGeometry(_))
        ));
    }
}
