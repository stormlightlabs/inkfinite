//! JSON contracts exchanged by the browser document-engine adapter.
//!
//! These types are generated into `@inkfinite/bindings` so the worker and the
//! Rust/WASM boundary use the same request and response shapes.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::editor::EditorProjection;
use crate::proto::{Bounds, CommitResult, TransactionDraft};
use crate::svg_import::{SvgImport, SvgImportWarning};
use crate::{AssetId, DocumentSnapshot, FlattenedPath, ResolvedArrowGeometry, ShapeId};

/// A structured failure returned by a browser document-engine operation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmDocumentSessionFailure {
    /// Machine-readable failure category.
    pub code: String,
    /// Human-readable failure detail.
    pub message: String,
}

/// State returned after opening or changing a browser document session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmDocumentSessionState {
    /// Current canonical materialized snapshot.
    pub snapshot: DocumentSnapshot,
    /// Current Rust-owned editor projection.
    pub editor_projection: EditorProjection,
    /// Whether the session actor can compensate its latest transaction.
    pub can_undo: bool,
    /// Whether the session actor can reapply its latest compensated transaction.
    pub can_redo: bool,
}

/// Result of a stateful browser document mutation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmDocumentMutationResponse {
    /// A validated transaction or history compensation was committed.
    Success {
        /// Materialized commit metadata.
        commit: CommitResult,
    },
    /// The mutation was rejected without changing the session.
    Error {
        /// Mutation failure details.
        error: WasmDocumentSessionFailure,
    },
}

/// A structured arrow geometry resolution failure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmArrowGeometryFailure {
    /// Machine-readable failure category.
    pub code: String,
    /// Human-readable failure detail.
    pub message: String,
}

/// Result of resolving one arrow through the Rust/WASM geometry boundary.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmArrowGeometryResponse {
    /// Native path geometry resolved from the supplied snapshot.
    Success {
        /// Resolved arrow shaft and waypoints.
        geometry: ResolvedArrowGeometry,
    },
    /// The snapshot or shape could not be resolved.
    Error {
        /// Resolution failure details.
        error: WasmArrowGeometryFailure,
    },
}

/// Result of measuring one native path through the Rust/WASM geometry boundary.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmPathMetricsResponse {
    /// Adaptively flattened path metrics.
    Success {
        /// Flattened path and its measured length.
        metrics: FlattenedPath,
    },
    /// The path geometry could not be decoded or validated.
    Error {
        /// Measurement failure details.
        error: WasmPathMetricsFailure,
    },
}

/// A structured native path metrics failure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmPathMetricsFailure {
    /// Machine-readable failure category.
    pub code: String,
    /// Human-readable failure detail.
    pub message: String,
}

/// Options accepted by the deterministic browser SVG renderer.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct WasmSvgRenderOptions {
    /// Page to render, or the first page when omitted.
    pub page_id: Option<String>,
    /// Layers to include.
    pub layer_ids: Vec<String>,
    /// Shapes to include.
    pub selection: Vec<String>,
    /// Optional clipping region.
    pub region: Option<Bounds>,
    /// Font families available to the browser renderer.
    pub available_font_families: Vec<String>,
    /// Asset IDs available to the browser renderer.
    pub available_asset_ids: Vec<String>,
}

/// A normalized SVG import failure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmSvgImportFailure {
    /// Machine-readable failure category.
    pub code: String,
    /// Human-readable failure detail.
    pub message: String,
}

/// Result of parsing SVG bytes without mutating a document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmSvgImportResponse {
    /// Normalized import tree and retained assets.
    Success {
        /// The normalized Rust import tree.
        import: Box<SvgImport>,
        /// Number of embedded image nodes omitted because their source data could not be represented.
        omitted_image_count: usize,
    },
    /// The source could not be imported.
    Error {
        /// Import failure details.
        error: WasmSvgImportFailure,
    },
}

/// Result of importing SVG bytes into a browser document session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmSvgImportCommitResponse {
    /// Imported content committed as one native transaction.
    Success {
        /// Session state after the import.
        state: Box<WasmDocumentSessionState>,
        /// Non-fatal parser warnings.
        warnings: Vec<SvgImportWarning>,
        /// Number of embedded image nodes omitted because their source data could not be represented.
        omitted_image_count: usize,
        /// Native shape IDs created by the transaction.
        shape_ids: Vec<ShapeId>,
        /// Retained source asset ID.
        source_asset_id: AssetId,
    },
    /// The import was rejected without changing the session.
    Error {
        /// Import failure details.
        error: WasmDocumentSessionFailure,
    },
}

/// A deterministic SVG render warning.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmSvgRenderWarning {
    /// Machine-readable warning category.
    pub code: String,
    /// Human-readable warning detail.
    pub message: String,
}

/// A deterministic SVG render failure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmSvgRenderFailure {
    /// Machine-readable failure category.
    pub code: String,
    /// Human-readable failure detail.
    pub message: String,
}

/// Result of rendering a canonical browser snapshot.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmSvgRenderResponse {
    /// Deterministic SVG and non-fatal resource warnings.
    Success {
        /// Complete SVG markup.
        svg: String,
        /// Renderer warnings.
        warnings: Vec<WasmSvgRenderWarning>,
    },
    /// The snapshot or render request was invalid.
    Error {
        /// Render failure details.
        error: WasmSvgRenderFailure,
    },
}

/// An editor projection failure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmEditorProjectionFailure {
    /// Machine-readable failure category.
    pub code: String,
    /// Human-readable failure detail.
    pub message: String,
}

/// Result of projecting a canonical browser snapshot.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmEditorProjectionResponse {
    /// Rust-owned flat editor projection.
    Success {
        /// Projected editor records and order.
        projection: EditorProjection,
    },
    /// The snapshot could not be decoded or projected.
    Error {
        /// Projection failure details.
        error: WasmEditorProjectionFailure,
    },
}

/// An editor reconciliation failure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WasmEditorReconciliationFailure {
    /// Machine-readable failure category.
    pub code: String,
    /// Human-readable failure detail.
    pub message: String,
}

/// Result of translating semantic editor patches into a native transaction.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum WasmEditorReconciliationResponse {
    /// Native transaction draft ready for the document session.
    Success {
        /// Transaction draft using the supplied causal heads.
        transaction: TransactionDraft,
    },
    /// The patches could not be translated.
    Error {
        /// Reconciliation failure details.
        error: WasmEditorReconciliationFailure,
    },
}
