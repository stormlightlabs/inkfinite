//! Projection and reconciliation between native documents and editor state.
//!
//! The editor works with a flat depth-first shape list, while the canonical
//! document stores containers and parent-relative transforms. The child
//! modules keep the public editor boundary intact while separating its data
//! types, projection, and transaction translation.

mod model;
mod projection;
mod reconciliation;
#[cfg(test)]
mod tests;

pub use model::*;
pub use projection::{native_properties, project_editor};
pub use reconciliation::{
    EditorPatch, EditorReconciliationError, EditorReconciliationRequest, reconcile_editor_patches,
};
