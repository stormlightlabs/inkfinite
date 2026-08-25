//! Canonical document contracts and their supporting value types.

mod document;
mod geometry;
mod ids;
mod registry;
mod validation;

pub use document::*;
pub use geometry::*;
pub use ids::*;
pub use registry::*;
pub use validation::{normalize_shape_properties, reference_properties_from_properties, validate_shape_properties};

/// Stable format identifier for an Inkfinite document snapshot.
pub const INKFINITE_FORMAT_ID: &str = "inkfinite.document";

/// First version of the Rust-owned Inkfinite document contract.
pub const INKFINITE_FORMAT_VERSION: u32 = 2;
