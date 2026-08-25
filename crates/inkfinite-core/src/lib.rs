//! Transport-independent contracts and services for Inkfinite.

#![forbid(unsafe_code)]

mod model;
pub use model::*;

pub mod geometry;
pub mod boolean {
    pub use crate::geometry::boolean::*;
}
pub mod connector {
    pub use crate::geometry::connector::*;
}
pub mod graph_layout {
    pub use crate::geometry::layout::*;
}
pub mod path {
    pub use crate::geometry::path::*;
}
pub mod path_metrics {
    pub use crate::geometry::path_metrics::*;
}
pub mod routing {
    pub use crate::geometry::routing::*;
}

pub mod crdt;
pub mod editor;
pub mod engine;
pub mod file;
pub mod ipc;
pub mod performance;
pub mod proto;
pub mod render;
pub mod session;
pub mod svg_import;
pub mod svg_transaction;
pub mod sync;
pub mod wasm;

pub use geometry::boolean::{BooleanPathError, BooleanPathOperation, boolean_path_operation};
pub use geometry::connector::{
    ArrowGeometryError, ResolvedArrowGeometry, resolve_arrow_geometry, resolve_arrow_geometry_for_shape,
};
pub use geometry::layout::{
    GraphLayoutAlgorithm, GraphLayoutDirection, GraphLayoutEdge, GraphLayoutGraph, GraphLayoutNode, GraphLayoutOptions,
    GraphLayoutResult,
};
pub use geometry::path_metrics::{
    DEFAULT_PATH_METRIC_TOLERANCE, FlattenedPath, FlattenedSubpath, PathMetricPoint, PathNearestPoint, flatten_path,
    flatten_path_with_transform, nearest_point, nearest_point_with_transform, path_length, path_length_with_transform,
    point_at_distance, point_at_distance_with_transform, tangent_at_distance, tangent_at_distance_with_transform,
    trim_path,
};
