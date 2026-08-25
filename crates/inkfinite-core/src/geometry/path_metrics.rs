//! Geometric measurements shared by native paths and semantic connectors.
//!
//! Curves are flattened adaptively from their control geometry. The tolerance
//! is a maximum distance from the control polygon to its chord, rather than a
//! fixed number of samples, so short and long curves receive appropriate
//! detail.

use crate::engine::geometry::Affine;
use crate::{PathGeometry, PathSegment, PathSubpath, Vec2};

/// Default geometric error used by interactive path measurements.
pub const DEFAULT_PATH_METRIC_TOLERANCE: f64 = 0.25;

/// A flattened native path, retaining one polyline for each subpath.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema, ts_rs::TS)]
pub struct FlattenedPath {
    /// Flattened points in each source subpath's order.
    pub subpaths: Vec<FlattenedSubpath>,
    /// Sum of all flattened subpath lengths.
    pub length: f64,
}

/// One flattened path subpath.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema, ts_rs::TS)]
pub struct FlattenedSubpath {
    /// Points suitable for drawing or distance queries.
    pub points: Vec<Vec2>,
    /// Whether the final point is connected to the first point.
    pub closed: bool,
    /// Length of this flattened subpath.
    pub length: f64,
}

/// A point and its source location on a native path.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema, ts_rs::TS)]
pub struct PathMetricPoint {
    /// Point on the measured path.
    pub point: Vec2,
    /// Unit tangent at the point, or the zero vector for a fully degenerate path.
    pub tangent: Vec2,
    /// Distance from the beginning of the complete path.
    pub distance: f64,
    /// Source subpath index.
    pub subpath_index: usize,
    /// Source segment index. The subpath length is used for its implicit closing line.
    pub segment_index: usize,
    /// Bézier parameter within the source segment.
    pub t: f64,
}

/// The nearest measured point and its distance from the query point.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema, ts_rs::TS)]
pub struct PathNearestPoint {
    /// Point on the measured path.
    pub point: Vec2,
    /// Unit tangent at the point, or the zero vector for a degenerate path.
    pub tangent: Vec2,
    /// Distance from the beginning of the complete path.
    pub distance: f64,
    /// Euclidean distance from the query point to `point`.
    pub distance_to_path: f64,
    /// Source subpath index.
    pub subpath_index: usize,
    /// Source segment index. The subpath length is used for its implicit closing line.
    pub segment_index: usize,
    /// Bézier parameter within the source segment.
    pub t: f64,
}

/// Flattens native path geometry using an adaptive geometric tolerance.
#[must_use]
pub fn flatten_path(geometry: &PathGeometry, tolerance: f64) -> FlattenedPath {
    flatten_path_with_transform(geometry, Affine::IDENTITY, tolerance)
}

/// Flattens native path geometry after applying an affine transform.
#[must_use]
pub fn flatten_path_with_transform(geometry: &PathGeometry, transform: Affine, tolerance: f64) -> FlattenedPath {
    let metrics = build_metrics(geometry, transform, tolerance);
    FlattenedPath {
        length: metrics.length,
        subpaths: metrics
            .subpaths
            .into_iter()
            .map(|subpath| FlattenedSubpath {
                points: subpath.samples.into_iter().map(|sample| sample.point).collect(),
                closed: subpath.closed,
                length: subpath.length,
            })
            .collect(),
    }
}

/// Returns the measured length of all subpaths in source order.
#[must_use]
pub fn path_length(geometry: &PathGeometry, tolerance: f64) -> f64 {
    build_metrics(geometry, Affine::IDENTITY, tolerance).length
}

/// Returns the measured length after applying an affine transform.
#[must_use]
pub fn path_length_with_transform(geometry: &PathGeometry, transform: Affine, tolerance: f64) -> f64 {
    build_metrics(geometry, transform, tolerance).length
}

/// Returns the point, tangent, and source location at a distance along a path.
///
/// Distances outside the path are clamped to its endpoints. Independent
/// subpaths are traversed in their stored order without adding a connector
/// between them.
#[must_use]
pub fn point_at_distance(geometry: &PathGeometry, distance: f64, tolerance: f64) -> Option<PathMetricPoint> {
    point_at_distance_with_transform(geometry, Affine::IDENTITY, distance, tolerance)
}

/// Returns a path point after applying an affine transform.
#[must_use]
pub fn point_at_distance_with_transform(
    geometry: &PathGeometry, transform: Affine, distance: f64, tolerance: f64,
) -> Option<PathMetricPoint> {
    let metrics = build_metrics(geometry, transform, tolerance);
    let target = clamp_distance(distance, metrics.length);
    let mut offset = 0.0;
    for (subpath_index, subpath) in metrics.subpaths.iter().enumerate() {
        if target <= offset + subpath.length || subpath_index + 1 == metrics.subpaths.len() {
            return Some(location_at_subpath_distance(
                subpath,
                subpath_index,
                target - offset,
                offset,
            ));
        }
        offset += subpath.length;
    }
    None
}

/// Returns the unit tangent at a distance along a path.
#[must_use]
pub fn tangent_at_distance(geometry: &PathGeometry, distance: f64, tolerance: f64) -> Option<Vec2> {
    point_at_distance(geometry, distance, tolerance).map(|point| point.tangent)
}

/// Returns the unit tangent after applying an affine transform.
#[must_use]
pub fn tangent_at_distance_with_transform(
    geometry: &PathGeometry, transform: Affine, distance: f64, tolerance: f64,
) -> Option<Vec2> {
    point_at_distance_with_transform(geometry, transform, distance, tolerance).map(|point| point.tangent)
}

/// Finds the closest point on a flattened path and its distance along the path.
#[must_use]
pub fn nearest_point(geometry: &PathGeometry, query: Vec2, tolerance: f64) -> Option<PathNearestPoint> {
    nearest_point_with_transform(geometry, Affine::IDENTITY, query, tolerance)
}

/// Finds the closest point after applying an affine transform.
#[must_use]
pub fn nearest_point_with_transform(
    geometry: &PathGeometry, transform: Affine, query: Vec2, tolerance: f64,
) -> Option<PathNearestPoint> {
    let metrics = build_metrics(geometry, transform, tolerance);
    let mut best: Option<PathNearestPoint> = None;
    let mut offset = 0.0;
    for (subpath_index, subpath) in metrics.subpaths.iter().enumerate() {
        for edge in &subpath.edges {
            let (_, ratio) = project_to_segment(query, edge.start.point, edge.end.point);
            let t = edge.t_start + (edge.t_end - edge.t_start) * ratio;
            let point = curve_point(edge.curve, t);
            let distance_to_path = point_distance(query, point);
            let distance = offset + edge.start_distance + edge.length * ratio;
            let candidate = PathNearestPoint {
                point,
                tangent: tangent_for_edge(edge, t, subpath),
                distance,
                distance_to_path,
                subpath_index,
                segment_index: edge.segment_index,
                t: edge.t_start + (edge.t_end - edge.t_start) * ratio,
            };
            if best.is_none_or(|current| {
                distance_to_path < current.distance_to_path - 1e-12
                    || ((distance_to_path - current.distance_to_path).abs() <= 1e-12 && distance < current.distance)
            }) {
                best = Some(candidate);
            }
        }
        if subpath.edges.is_empty()
            && let Some(sample) = subpath.samples.first()
        {
            let distance_to_path = point_distance(query, sample.point);
            let candidate = PathNearestPoint {
                point: sample.point,
                tangent: Vec2 { x: 0.0, y: 0.0 },
                distance: offset,
                distance_to_path,
                subpath_index,
                segment_index: 0,
                t: 0.0,
            };
            if best.is_none_or(|current| distance_to_path < current.distance_to_path) {
                best = Some(candidate);
            }
        }
        offset += subpath.length;
    }
    best
}

/// Trims a path to the inclusive distance interval `[start, end]`.
///
/// Curve commands remain curve commands; trimming uses de Casteljau subdivision
/// rather than replacing the result with sampled line segments. `None` is
/// returned when the source has no geometry or the interval contains no path.
#[must_use]
pub fn trim_path(geometry: &PathGeometry, start: f64, end: f64, tolerance: f64) -> Option<PathGeometry> {
    let metrics = build_metrics(geometry, Affine::IDENTITY, tolerance);
    if metrics.subpaths.is_empty() || metrics.length <= 0.0 {
        return geometry.subpaths.first().map(|subpath| PathGeometry {
            subpaths: vec![PathSubpath {
                segments: subpath.segments.first().copied().into_iter().collect(),
                closed: false,
                handle_modes: None,
            }],
            fill_rule: geometry.fill_rule,
        });
    }
    let start = clamp_distance(start, metrics.length);
    let end = clamp_distance(end, metrics.length);
    if end < start {
        return None;
    }
    if start <= 0.0 && end >= metrics.length {
        return Some(geometry.clone());
    }

    let mut result = Vec::new();
    let mut offset = 0.0;
    for (subpath_index, metric_subpath) in metrics.subpaths.iter().enumerate() {
        let local_start = (start - offset).max(0.0);
        let local_end = (end - offset).min(metric_subpath.length);
        if local_end < local_start {
            offset += metric_subpath.length;
            continue;
        }
        let source = &geometry.subpaths[subpath_index];
        let mut segments = Vec::new();
        for range in &metric_subpath.ranges {
            let from = local_start.max(range.start_distance);
            let to = local_end.min(range.end_distance);
            if to < from
                || (to - from).abs() <= f64::EPSILON
                || range.end_distance - range.start_distance <= f64::EPSILON
            {
                continue;
            }
            let range_length = range.end_distance - range.start_distance;
            let t0 = range.t_start + (range.t_end - range.t_start) * ((from - range.start_distance) / range_length);
            let t1 = range.t_start + (range.t_end - range.t_start) * ((to - range.start_distance) / range_length);
            let curve = source_curve(source, range.segment_index);
            let piece = trim_curve(curve, t0.clamp(0.0, 1.0), t1.clamp(0.0, 1.0));
            if segments.is_empty() {
                segments.push(PathSegment::Move { to: curve_point(curve, t0.clamp(0.0, 1.0)) });
            }
            segments.push(curve_to_path_segment(piece));
        }
        if segments.is_empty() {
            let point = location_at_subpath_distance(metric_subpath, subpath_index, local_start, offset).point;
            segments.push(PathSegment::Move { to: point });
        }
        result.push(PathSubpath { segments, closed: false, handle_modes: None });
        offset += metric_subpath.length;
    }
    (!result.is_empty()).then_some(PathGeometry { subpaths: result, fill_rule: geometry.fill_rule })
}

#[derive(Clone, Copy)]
struct Sample {
    point: Vec2,
    segment_index: usize,
    t: f64,
}

#[derive(Clone, Copy)]
enum Curve {
    Line {
        start: Vec2,
        end: Vec2,
    },
    Quadratic {
        start: Vec2,
        control: Vec2,
        end: Vec2,
    },
    Cubic {
        start: Vec2,
        control_1: Vec2,
        control_2: Vec2,
        end: Vec2,
    },
}

#[derive(Clone, Copy)]
struct Edge {
    start: Sample,
    end: Sample,
    start_distance: f64,
    length: f64,
    segment_index: usize,
    t_start: f64,
    t_end: f64,
    curve: Curve,
}

struct SegmentRange {
    segment_index: usize,
    start_distance: f64,
    end_distance: f64,
    t_start: f64,
    t_end: f64,
}

struct MetricSubpath {
    samples: Vec<Sample>,
    edges: Vec<Edge>,
    ranges: Vec<SegmentRange>,
    closed: bool,
    length: f64,
}

struct Metrics {
    subpaths: Vec<MetricSubpath>,
    length: f64,
}

fn build_metrics(geometry: &PathGeometry, transform: Affine, tolerance: f64) -> Metrics {
    let tolerance = if tolerance.is_finite() && tolerance > 0.0 { tolerance } else { DEFAULT_PATH_METRIC_TOLERANCE };
    let subpaths = geometry
        .subpaths
        .iter()
        .map(|subpath| build_subpath(subpath, transform, tolerance))
        .collect::<Vec<_>>();
    let length = subpaths.iter().map(|subpath| subpath.length).sum();
    Metrics { subpaths, length }
}

fn build_subpath(subpath: &PathSubpath, transform: Affine, tolerance: f64) -> MetricSubpath {
    let Some(PathSegment::Move { to }) = subpath.segments.first() else {
        return MetricSubpath {
            samples: Vec::new(),
            edges: Vec::new(),
            ranges: Vec::new(),
            closed: subpath.closed,
            length: 0.0,
        };
    };
    let start = Sample { point: transform.point(*to), segment_index: 0, t: 0.0 };
    let mut result = MetricSubpath {
        samples: vec![start],
        edges: Vec::new(),
        ranges: Vec::new(),
        closed: subpath.closed,
        length: 0.0,
    };
    let mut current = start;
    for segment_index in 1..subpath.segments.len() {
        let curve = source_curve_with_transform(subpath, segment_index, transform);
        let ends = flatten_curve(curve, segment_index, tolerance);
        let mut segment_start = Sample { point: current.point, segment_index, t: 0.0 };
        for end in ends {
            append_edge(&mut result, segment_start, end, curve);
            segment_start = end;
            current = end;
        }
    }
    if subpath.closed {
        let closing = Curve::Line { start: current.point, end: start.point };
        let closing_start = Sample { point: current.point, segment_index: subpath.segments.len(), t: 0.0 };
        let end = Sample { point: start.point, segment_index: subpath.segments.len(), t: 1.0 };
        append_edge(&mut result, closing_start, end, closing);
    }
    result.ranges = ranges_from_edges(&result.edges);
    result
}

fn append_edge(subpath: &mut MetricSubpath, start: Sample, end: Sample, curve: Curve) {
    let length = point_distance(start.point, end.point);
    let edge = Edge {
        start,
        end,
        start_distance: subpath.length,
        length,
        segment_index: end.segment_index,
        t_start: start.t,
        t_end: end.t,
        curve,
    };
    subpath.edges.push(edge);
    subpath.samples.push(end);
    subpath.length += length;
}

fn ranges_from_edges(edges: &[Edge]) -> Vec<SegmentRange> {
    let mut ranges: Vec<SegmentRange> = Vec::new();
    for edge in edges {
        if let Some(last) = ranges.last_mut()
            && last.segment_index == edge.segment_index
        {
            last.end_distance = edge.start_distance + edge.length;
            last.t_end = edge.t_end;
            continue;
        }
        ranges.push(SegmentRange {
            segment_index: edge.segment_index,
            start_distance: edge.start_distance,
            end_distance: edge.start_distance + edge.length,
            t_start: edge.t_start,
            t_end: edge.t_end,
        });
    }
    ranges
}

fn source_curve_with_transform(subpath: &PathSubpath, segment_index: usize, transform: Affine) -> Curve {
    let segment = source_curve(subpath, segment_index);
    transform_curve(segment, transform)
}

fn source_curve(subpath: &PathSubpath, segment_index: usize) -> Curve {
    if segment_index == subpath.segments.len() {
        let start = subpath
            .segments
            .last()
            .map(segment_to)
            .unwrap_or(Vec2 { x: 0.0, y: 0.0 });
        let end = subpath.segments.first().map(segment_to).unwrap_or(start);
        return Curve::Line { start, end };
    }
    let segment = subpath.segments.get(segment_index).copied();
    let start = segment_index
        .checked_sub(1)
        .and_then(|index| subpath.segments.get(index))
        .map(segment_to)
        .unwrap_or_else(|| {
            segment
                .map(|segment| segment_to(&segment))
                .unwrap_or(Vec2 { x: 0.0, y: 0.0 })
        });
    match segment {
        Some(PathSegment::Line { to }) => Curve::Line { start, end: to },
        Some(PathSegment::Quadratic { control, to }) => Curve::Quadratic { start, control, end: to },
        Some(PathSegment::Cubic { control_1, control_2, to }) => Curve::Cubic { start, control_1, control_2, end: to },
        Some(PathSegment::Move { to }) => Curve::Line { start, end: to },
        None => Curve::Line { start, end: start },
    }
}

fn transform_curve(curve: Curve, transform: Affine) -> Curve {
    match curve {
        Curve::Line { start, end } => Curve::Line { start: transform.point(start), end: transform.point(end) },
        Curve::Quadratic { start, control, end } => Curve::Quadratic {
            start: transform.point(start),
            control: transform.point(control),
            end: transform.point(end),
        },
        Curve::Cubic { start, control_1, control_2, end } => Curve::Cubic {
            start: transform.point(start),
            control_1: transform.point(control_1),
            control_2: transform.point(control_2),
            end: transform.point(end),
        },
    }
}

struct FlattenContext {
    segment_index: usize,
    tolerance: f64,
    output: Vec<Sample>,
}

fn flatten_curve(curve: Curve, segment_index: usize, tolerance: f64) -> Vec<Sample> {
    if let Curve::Line { end, .. } = curve {
        return vec![Sample { point: end, segment_index, t: 1.0 }];
    }
    let mut context = FlattenContext { segment_index, tolerance, output: Vec::new() };
    flatten_curve_recursive(curve, 0.0, 1.0, 0, &mut context);
    context.output
}

fn flatten_curve_recursive(curve: Curve, t_start: f64, t_end: f64, depth: u8, context: &mut FlattenContext) {
    let flatness = match curve {
        Curve::Line { .. } => 0.0,
        Curve::Quadratic { start, control, end } => point_line_distance(control, start, end),
        Curve::Cubic { start, control_1, control_2, end } => {
            point_line_distance(control_1, start, end).max(point_line_distance(control_2, start, end))
        }
    };
    if depth >= 24 || flatness <= context.tolerance {
        context
            .output
            .push(Sample { point: curve_point(curve, 1.0), segment_index: context.segment_index, t: t_end });
        return;
    }
    let (left, right) = split_curve(curve, 0.5);
    let middle = (t_start + t_end) / 2.0;
    flatten_curve_recursive(left, t_start, middle, depth + 1, context);
    flatten_curve_recursive(right, middle, t_end, depth + 1, context);
}

fn location_at_subpath_distance(
    subpath: &MetricSubpath, subpath_index: usize, distance: f64, path_offset: f64,
) -> PathMetricPoint {
    let distance = clamp_distance(distance, subpath.length);
    let edge_index = subpath
        .edges
        .iter()
        .position(|edge| distance <= edge.start_distance + edge.length)
        .unwrap_or_else(|| subpath.edges.len().saturating_sub(1));
    let Some(edge) = subpath.edges.get(edge_index) else {
        let sample = subpath.samples.first().copied().unwrap_or(Sample {
            point: Vec2 { x: 0.0, y: 0.0 },
            segment_index: 0,
            t: 0.0,
        });
        return PathMetricPoint {
            point: sample.point,
            tangent: Vec2 { x: 0.0, y: 0.0 },
            distance: path_offset,
            subpath_index,
            segment_index: sample.segment_index,
            t: sample.t,
        };
    };
    let ratio = if edge.length <= f64::EPSILON {
        0.0
    } else {
        ((distance - edge.start_distance) / edge.length).clamp(0.0, 1.0)
    };
    let t = edge.t_start + (edge.t_end - edge.t_start) * ratio;
    let point = curve_point(edge.curve, t);
    PathMetricPoint {
        point,
        tangent: tangent_for_edge(edge, t, subpath),
        distance: path_offset + edge.start_distance + edge.length * ratio,
        subpath_index,
        segment_index: edge.segment_index,
        t,
    }
}

fn tangent_for_edge(edge: &Edge, t: f64, subpath: &MetricSubpath) -> Vec2 {
    let tangent = match edge.curve {
        Curve::Line { start, end } => subtract(end, start),
        Curve::Quadratic { start, control, end } => add(
            scale(subtract(control, start), 1.0 - t),
            scale(subtract(end, control), t),
        ),
        Curve::Cubic { start, control_1, control_2, end } => {
            let inverse = 1.0 - t;
            add(
                add(
                    scale(subtract(control_1, start), inverse * inverse),
                    scale(subtract(control_2, control_1), 2.0 * inverse * t),
                ),
                scale(subtract(end, control_2), t * t),
            )
        }
    };
    let tangent = normalize(tangent);
    if tangent.x != 0.0 || tangent.y != 0.0 {
        return tangent;
    }
    for candidate in &subpath.edges {
        let fallback = match candidate.curve {
            Curve::Line { start, end } => subtract(end, start),
            _ => subtract(candidate.end.point, candidate.start.point),
        };
        let fallback = normalize(fallback);
        if fallback.x != 0.0 || fallback.y != 0.0 {
            return fallback;
        }
    }
    Vec2 { x: 0.0, y: 0.0 }
}

fn project_to_segment(point: Vec2, start: Vec2, end: Vec2) -> (Vec2, f64) {
    let direction = subtract(end, start);
    let length_squared = dot(direction, direction);
    if length_squared <= f64::EPSILON {
        return (start, 0.0);
    }
    let ratio = dot(subtract(point, start), direction) / length_squared;
    let ratio = ratio.clamp(0.0, 1.0);
    (lerp(start, end, ratio), ratio)
}

fn trim_curve(curve: Curve, start: f64, end: f64) -> Curve {
    if start <= f64::EPSILON && end >= 1.0 - f64::EPSILON {
        return curve;
    }
    let (_, right) = split_curve(curve, start);
    let ratio = if start >= 1.0 - f64::EPSILON { 0.0 } else { (end - start) / (1.0 - start) };
    let (middle, _) = split_curve(right, ratio.clamp(0.0, 1.0));
    middle
}

fn split_curve(curve: Curve, t: f64) -> (Curve, Curve) {
    let t = t.clamp(0.0, 1.0);
    match curve {
        Curve::Line { start, end } => {
            let middle = lerp(start, end, t);
            (Curve::Line { start, end: middle }, Curve::Line { start: middle, end })
        }
        Curve::Quadratic { start, control, end } => {
            let first = lerp(start, control, t);
            let second = lerp(control, end, t);
            let middle = lerp(first, second, t);
            (
                Curve::Quadratic { start, control: first, end: middle },
                Curve::Quadratic { start: middle, control: second, end },
            )
        }
        Curve::Cubic { start, control_1, control_2, end } => {
            let first = lerp(start, control_1, t);
            let bridge = lerp(control_1, control_2, t);
            let last = lerp(control_2, end, t);
            let first_bridge = lerp(first, bridge, t);
            let second_bridge = lerp(bridge, last, t);
            let middle = lerp(first_bridge, second_bridge, t);
            (
                Curve::Cubic { start, control_1: first, control_2: first_bridge, end: middle },
                Curve::Cubic { start: middle, control_1: second_bridge, control_2: last, end },
            )
        }
    }
}

fn curve_to_path_segment(curve: Curve) -> PathSegment {
    match curve {
        Curve::Line { end, .. } => PathSegment::Line { to: end },
        Curve::Quadratic { control, end, .. } => PathSegment::Quadratic { control, to: end },
        Curve::Cubic { control_1, control_2, end, .. } => PathSegment::Cubic { control_1, control_2, to: end },
    }
}

fn curve_point(curve: Curve, t: f64) -> Vec2 {
    match curve {
        Curve::Line { start, end } => lerp(start, end, t),
        Curve::Quadratic { start, control, end } => {
            let inverse = 1.0 - t;
            Vec2 {
                x: inverse * inverse * start.x + 2.0 * inverse * t * control.x + t * t * end.x,
                y: inverse * inverse * start.y + 2.0 * inverse * t * control.y + t * t * end.y,
            }
        }
        Curve::Cubic { start, control_1, control_2, end } => {
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
    }
}

fn segment_to(segment: &PathSegment) -> Vec2 {
    match *segment {
        PathSegment::Move { to }
        | PathSegment::Line { to }
        | PathSegment::Quadratic { to, .. }
        | PathSegment::Cubic { to, .. } => to,
    }
}

fn clamp_distance(distance: f64, length: f64) -> f64 {
    if !distance.is_finite() {
        return if distance.is_sign_negative() { 0.0 } else { length };
    }
    distance.clamp(0.0, length)
}

fn point_line_distance(point: Vec2, start: Vec2, end: Vec2) -> f64 {
    point_distance(point, project_to_segment(point, start, end).0)
}

fn point_distance(left: Vec2, right: Vec2) -> f64 {
    subtract(left, right).x.hypot(subtract(left, right).y)
}

fn normalize(point: Vec2) -> Vec2 {
    let length = point_distance(point, Vec2 { x: 0.0, y: 0.0 });
    if length <= f64::EPSILON { Vec2 { x: 0.0, y: 0.0 } } else { scale(point, 1.0 / length) }
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

fn dot(left: Vec2, right: Vec2) -> f64 {
    left.x * right.x + left.y * right.y
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PathFillRule, PathSegment, PathSubpath};

    fn line() -> PathGeometry {
        PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Line { to: Vec2 { x: 100.0, y: 0.0 } },
                ],
                closed: false,
                handle_modes: None,
            }],
            fill_rule: PathFillRule::NonZero,
        }
    }

    #[test]
    fn flattens_curves_from_geometric_tolerance() {
        let geometry = PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Quadratic { control: Vec2 { x: 50.0, y: 100.0 }, to: Vec2 { x: 100.0, y: 0.0 } },
                    PathSegment::Cubic {
                        control_1: Vec2 { x: 120.0, y: 100.0 },
                        control_2: Vec2 { x: 180.0, y: 100.0 },
                        to: Vec2 { x: 200.0, y: 0.0 },
                    },
                ],
                closed: false,
                handle_modes: None,
            }],
            fill_rule: PathFillRule::NonZero,
        };
        let coarse = flatten_path(&geometry, 10.0);
        let fine = flatten_path(&geometry, 0.1);
        assert!(fine.subpaths[0].points.len() > coarse.subpaths[0].points.len());
        assert_eq!(fine.subpaths[0].points.first(), Some(&Vec2 { x: 0.0, y: 0.0 }));
        assert_eq!(fine.subpaths[0].points.last(), Some(&Vec2 { x: 200.0, y: 0.0 }));
    }

    #[test]
    fn measures_and_queries_a_line() {
        let geometry = line();
        assert_eq!(path_length(&geometry, 0.1), 100.0);
        let at = point_at_distance(&geometry, 25.0, 0.1).expect("point on line");
        assert_eq!(at.point, Vec2 { x: 25.0, y: 0.0 });
        assert_eq!(at.tangent, Vec2 { x: 1.0, y: 0.0 });
        let nearest = nearest_point(&geometry, Vec2 { x: 40.0, y: 20.0 }, 0.1).expect("nearest point");
        assert_eq!(nearest.point, Vec2 { x: 40.0, y: 0.0 });
        assert_eq!(nearest.distance, 40.0);
        assert_eq!(nearest.distance_to_path, 20.0);
    }

    #[test]
    fn queries_curve_tangents_and_trims_without_sampling_commands() {
        let geometry = PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Quadratic { control: Vec2 { x: 50.0, y: 100.0 }, to: Vec2 { x: 100.0, y: 0.0 } },
                ],
                closed: false,
                handle_modes: None,
            }],
            fill_rule: PathFillRule::NonZero,
        };
        let halfway = point_at_distance(&geometry, path_length(&geometry, 0.01) / 2.0, 0.01).expect("curve point");
        assert!(halfway.tangent.x > 0.99);
        assert!(halfway.tangent.y.abs() < 1e-9);
        let trimmed = trim_path(&geometry, 10.0, 60.0, 0.1).expect("trimmed curve");
        assert!(matches!(trimmed.subpaths[0].segments[1], PathSegment::Quadratic { .. }));
    }

    #[test]
    fn transforms_metrics_and_handles_degenerate_segments() {
        let geometry = PathGeometry {
            subpaths: vec![PathSubpath {
                segments: vec![
                    PathSegment::Move { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Line { to: Vec2 { x: 0.0, y: 0.0 } },
                    PathSegment::Line { to: Vec2 { x: 10.0, y: 0.0 } },
                ],
                closed: false,
                handle_modes: None,
            }],
            fill_rule: PathFillRule::NonZero,
        };
        let transform = Affine { a: 0.0, b: 2.0, c: -3.0, d: 0.0, e: 5.0, f: 7.0 };
        assert_eq!(path_length_with_transform(&geometry, transform, 0.1), 20.0);
        let point = point_at_distance_with_transform(&geometry, transform, 10.0, 0.1).expect("transformed point");
        assert_eq!(point.point, Vec2 { x: 5.0, y: 17.0 });
        assert_eq!(point.tangent, Vec2 { x: 0.0, y: 1.0 });
        assert_eq!(
            nearest_point_with_transform(&geometry, transform, Vec2 { x: 8.0, y: 17.0 }, 0.1)
                .unwrap()
                .distance,
            10.0
        );
    }
}
