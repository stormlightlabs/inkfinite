//! Geometry services and canonical geometry algorithms.
//!
//! The root crate re-exports the original module paths for compatibility. New
//! code can use this namespace to find path, routing, boolean, layout, and
//! connector geometry together.

pub mod boolean;
pub mod connector;
pub mod layout;
pub mod path;
pub mod path_metrics;
pub mod routing;

pub use boolean::{BooleanPathError, BooleanPathOperation, boolean_path_operation};
pub use connector::{
    ArrowGeometryError, ResolvedArrowGeometry, resolve_arrow_geometry, resolve_arrow_geometry_for_shape,
};
pub use layout::{
    GraphLayoutAlgorithm, GraphLayoutDirection, GraphLayoutEdge, GraphLayoutGraph, GraphLayoutNode, GraphLayoutOptions,
    GraphLayoutResult,
};
pub use path::{PathCurveKind, PathTopologyError, PathTopologyOperation, apply_path_topology_operations};
pub use path_metrics::{
    DEFAULT_PATH_METRIC_TOLERANCE, FlattenedPath, FlattenedSubpath, PathMetricPoint, PathNearestPoint, flatten_path,
    flatten_path_with_transform, nearest_point, nearest_point_with_transform, path_length, path_length_with_transform,
    point_at_distance, point_at_distance_with_transform, tangent_at_distance, tangent_at_distance_with_transform,
    trim_path,
};
