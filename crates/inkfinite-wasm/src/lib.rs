//! Browser-facing bindings for Rust-owned SVG import and rendering.
//!
//! The worker calls [`import_svg`] with transferred UTF-8 bytes and
//! [`render_svg`] with one canonical snapshot. Both functions return JSON
//! envelopes so failures retain their structured code and message across the
//! WebAssembly boundary.

use std::collections::BTreeSet;

use inkfinite_core::editor::{
    EditorReconciliationError, EditorReconciliationRequest, project_editor as project_native,
    reconcile_editor_patches as reconcile_native,
};
use inkfinite_core::engine::{EngineError, TransactionEngine};
use inkfinite_core::proto::{TransactionDraft, TransactionId};
use inkfinite_core::render::{SvgRenderError, SvgRenderOptions, SvgRenderWarning, render_svg as render_native_svg};
use inkfinite_core::svg_import::{SvgImportError, SvgImportNode, import_svg as parse_svg};
use inkfinite_core::svg_transaction::{SvgImportTransactionOptions, build_svg_import_transaction};
use inkfinite_core::wasm::{
    WasmDocumentMutationResponse as DocumentMutationResponse, WasmDocumentSessionFailure as DocumentSessionFailure,
    WasmDocumentSessionState as DocumentSessionState, WasmEditorProjectionFailure as EditorProjectionFailure,
    WasmEditorProjectionResponse as EditorProjectionResponse,
    WasmEditorReconciliationFailure as EditorReconciliationFailure,
    WasmEditorReconciliationResponse as EditorReconciliationResponse,
    WasmSvgImportCommitResponse as SvgImportCommitResponse, WasmSvgImportFailure as SvgImportFailure,
    WasmSvgImportResponse as SvgImportResponse, WasmSvgRenderFailure as SvgRenderFailure,
    WasmSvgRenderOptions as SvgRenderOptionsInput, WasmSvgRenderResponse as SvgRenderResponse,
    WasmSvgRenderWarning as SvgRenderWarningResponse,
};
use inkfinite_core::{
    ActorId, AssetId, DocumentId, DocumentSnapshot, INKFINITE_FORMAT_ID, INKFINITE_FORMAT_VERSION, LayerId, Origin,
    PageId, ShapeId, Timestamp,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// A stateful Rust document engine owned by one browser worker.
///
/// The session keeps Automerge state and actor-scoped history alive between
/// calls. IndexedDB stores the bytes returned by [`Self::save`]; it does not
/// participate in document mutation or validation.
#[wasm_bindgen]
pub struct DocumentSession {
    engine: TransactionEngine,
    actor_id: ActorId,
}

#[wasm_bindgen]
impl DocumentSession {
    /// Returns the current snapshot and actor-scoped history capabilities.
    pub fn state_json(&mut self) -> Result<String, JsValue> {
        let snapshot = self
            .engine
            .snapshot()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        serialize_result(&DocumentSessionState {
            editor_projection: project_native(&snapshot),
            can_undo: self.engine.can_undo(&self.actor_id),
            can_redo: self.engine.can_redo(&self.actor_id),
            snapshot,
        })
    }

    /// Returns the canonical Automerge bytes for IndexedDB persistence.
    pub fn save(&mut self) -> Result<Vec<u8>, JsValue> {
        self.engine
            .save()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Applies one validated transaction draft to the session.
    pub fn apply_transaction(&mut self, transaction_json: &str) -> String {
        let transaction = match serde_json::from_str::<TransactionDraft>(transaction_json) {
            Ok(transaction) => transaction,
            Err(error) => {
                return serialize_response(DocumentMutationResponse::Error {
                    error: invalid_json_failure("invalid_transaction", &error),
                });
            }
        };
        if transaction.actor_id != self.actor_id {
            return serialize_response(DocumentMutationResponse::Error {
                error: DocumentSessionFailure {
                    code: "actor_mismatch".into(),
                    message: "transaction actor does not belong to this session".into(),
                },
            });
        }
        match self.engine.commit(transaction) {
            Ok(commit) => serialize_response(DocumentMutationResponse::Success { commit }),
            Err(error) => serialize_response(DocumentMutationResponse::Error { error: engine_failure(&error) }),
        }
    }

    /// Reconciles and commits semantic editor patches against the current state.
    pub fn apply_editor_patches(&mut self, request_json: &str) -> String {
        let request = match serde_json::from_str::<EditorReconciliationRequest>(request_json) {
            Ok(request) => request,
            Err(error) => {
                return serialize_response(DocumentMutationResponse::Error {
                    error: invalid_json_failure("invalid_request", &error),
                });
            }
        };
        if request.actor_id != self.actor_id {
            return serialize_response(DocumentMutationResponse::Error {
                error: DocumentSessionFailure {
                    code: "actor_mismatch".into(),
                    message: "editor request actor does not belong to this session".into(),
                },
            });
        }
        let snapshot = match self.engine.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return serialize_response(DocumentMutationResponse::Error { error: engine_failure(&error) }),
        };
        let transaction = match reconcile_native(&snapshot, request) {
            Ok(transaction) => transaction,
            Err(error) => {
                return serialize_response(DocumentMutationResponse::Error {
                    error: DocumentSessionFailure { code: "editor_reconciliation".into(), message: error.to_string() },
                });
            }
        };
        if transaction.operations.is_empty() {
            return serialize_response(DocumentMutationResponse::Error {
                error: DocumentSessionFailure {
                    code: "no_changes".into(),
                    message: "editor patches contain no document changes".into(),
                },
            });
        }
        match self.engine.commit(transaction) {
            Ok(commit) => serialize_response(DocumentMutationResponse::Success { commit }),
            Err(error) => serialize_response(DocumentMutationResponse::Error { error: engine_failure(&error) }),
        }
    }

    /// Imports and commits one SVG as a single native transaction.
    pub fn import_svg_document(
        &mut self, source: &[u8], source_name: &str, page_id: &str, layer_id: &str, timestamp: f64,
    ) -> String {
        let import = match parse_svg(source) {
            Ok(import) => import,
            Err(error) => {
                let error = failure(&error);
                return serialize_response(SvgImportCommitResponse::Error {
                    error: DocumentSessionFailure { code: error.code, message: error.message },
                });
            }
        };
        let snapshot = match self.engine.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return serialize_response(SvgImportCommitResponse::Error { error: engine_failure(&error) });
            }
        };
        let page_id = if page_id.trim().is_empty() {
            match snapshot.document.page_ids.first() {
                Some(page_id) => page_id.clone(),
                None => {
                    return serialize_response(SvgImportCommitResponse::Error {
                        error: DocumentSessionFailure {
                            code: "missing_page".into(),
                            message: "document has no page for SVG import".into(),
                        },
                    });
                }
            }
        } else {
            PageId::from(page_id)
        };
        let page = match snapshot.document.pages.get(&page_id) {
            Some(page) => page,
            None => {
                return serialize_response(SvgImportCommitResponse::Error {
                    error: DocumentSessionFailure {
                        code: "missing_page".into(),
                        message: format!("SVG import page {page_id} does not exist"),
                    },
                });
            }
        };
        let layer_id = if layer_id.trim().is_empty() {
            match page.layer_ids.first() {
                Some(layer_id) => layer_id.clone(),
                None => {
                    return serialize_response(SvgImportCommitResponse::Error {
                        error: DocumentSessionFailure {
                            code: "missing_layer".into(),
                            message: format!("SVG import page {page_id} has no layer"),
                        },
                    });
                }
            }
        } else {
            LayerId::from(layer_id)
        };
        let source_name = (!source_name.trim().is_empty()).then(|| source_name.to_owned());
        let transaction = match build_svg_import_transaction(
            &snapshot,
            &import,
            SvgImportTransactionOptions {
                actor_id: self.actor_id.clone(),
                origin: Origin::Human,
                page_id,
                layer_id,
                transaction_id: TransactionId(format!(
                    "transaction:svg-import:{}",
                    import.source_asset.digest.replace(':', "-")
                )),
                description: source_name
                    .as_deref()
                    .map(|name| format!("Import SVG {name}"))
                    .unwrap_or_else(|| "Import SVG".into()),
                source_name,
                timestamp: Timestamp(timestamp as i64),
            },
        ) {
            Ok(transaction) => transaction,
            Err(error) => {
                return serialize_response(SvgImportCommitResponse::Error {
                    error: DocumentSessionFailure { code: "svg_import".into(), message: error.to_string() },
                });
            }
        };
        let shape_ids = transaction.shape_ids;
        let asset_id = import.source_asset.id.clone();
        let omitted_image_count = transaction.omitted_image_count;
        let warnings = import.warnings;
        if let Err(error) = self.engine.commit(transaction.transaction) {
            return serialize_response(SvgImportCommitResponse::Error { error: engine_failure(&error) });
        }
        let state = match self.session_state() {
            Ok(state) => state,
            Err(error) => {
                return serialize_response(SvgImportCommitResponse::Error { error: engine_failure(&error) });
            }
        };
        serialize_response(SvgImportCommitResponse::Success {
            state: Box::new(state),
            warnings,
            omitted_image_count,
            shape_ids,
            source_asset_id: asset_id,
        })
    }

    /// Compensates the latest transaction committed by this session actor.
    pub fn undo(&mut self) -> String {
        match self.engine.undo(&self.actor_id) {
            Ok(commit) => serialize_response(DocumentMutationResponse::Success { commit }),
            Err(error) => serialize_response(DocumentMutationResponse::Error { error: engine_failure(&error) }),
        }
    }

    /// Reapplies the latest transaction compensated by this session actor.
    pub fn redo(&mut self) -> String {
        match self.engine.redo(&self.actor_id) {
            Ok(commit) => serialize_response(DocumentMutationResponse::Success { commit }),
            Err(error) => serialize_response(DocumentMutationResponse::Error { error: engine_failure(&error) }),
        }
    }

    /// Reports whether the session actor can undo its latest transaction.
    #[must_use]
    pub fn can_undo(&self) -> bool {
        self.engine.can_undo(&self.actor_id)
    }

    /// Reports whether the session actor can redo its latest compensated transaction.
    #[must_use]
    pub fn can_redo(&self) -> bool {
        self.engine.can_redo(&self.actor_id)
    }

    fn session_state(&mut self) -> Result<DocumentSessionState, EngineError> {
        let snapshot = self.engine.snapshot()?;
        Ok(DocumentSessionState {
            editor_projection: project_native(&snapshot),
            can_undo: self.engine.can_undo(&self.actor_id),
            can_redo: self.engine.can_redo(&self.actor_id),
            snapshot,
        })
    }
}

fn render_options(input: SvgRenderOptionsInput) -> SvgRenderOptions {
    SvgRenderOptions {
        page_id: input.page_id.map(PageId::from),
        layer_ids: input.layer_ids.into_iter().map(LayerId::from).collect::<BTreeSet<_>>(),
        selection: input.selection.into_iter().map(ShapeId::from).collect::<BTreeSet<_>>(),
        region: input.region,
        available_font_families: input.available_font_families.into_iter().collect::<BTreeSet<_>>(),
        available_asset_ids: input
            .available_asset_ids
            .into_iter()
            .map(AssetId::from)
            .collect::<BTreeSet<_>>(),
    }
}

/// Creates a stateful browser session from a canonical materialized snapshot.
#[wasm_bindgen]
pub fn create_document(snapshot_json: &str, actor_id: &str) -> Result<DocumentSession, JsValue> {
    let snapshot = serde_json::from_str::<DocumentSnapshot>(snapshot_json)
        .map_err(|error| JsValue::from_str(&format!("invalid snapshot: {error}")))?;
    if snapshot.format.as_str() != INKFINITE_FORMAT_ID || snapshot.format_version != INKFINITE_FORMAT_VERSION {
        return Err(JsValue::from_str("unsupported document format"));
    }
    if actor_id.trim().is_empty() {
        return Err(JsValue::from_str("actor id must not be empty"));
    }
    let actor_id = ActorId::from(actor_id);
    let engine = TransactionEngine::create(
        DocumentId::from(snapshot.document_id.as_str()),
        actor_id.clone(),
        snapshot.document,
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(DocumentSession { engine, actor_id })
}

/// Opens a stateful browser session from canonical Automerge bytes.
#[wasm_bindgen]
pub fn open_document(bytes: &[u8], actor_id: &str) -> Result<DocumentSession, JsValue> {
    if actor_id.trim().is_empty() {
        return Err(JsValue::from_str("actor id must not be empty"));
    }
    let actor_id = ActorId::from(actor_id);
    let engine =
        TransactionEngine::load(bytes, actor_id.clone()).map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(DocumentSession { engine, actor_id })
}

/// Imports UTF-8 SVG bytes and returns the serialized response envelope.
#[must_use]
pub fn import_svg_json(source: &[u8]) -> String {
    let response = match parse_svg(source) {
        Ok(import) => {
            SvgImportResponse::Success { omitted_image_count: count_images(&import.root), import: Box::new(import) }
        }
        Err(error) => SvgImportResponse::Error { error: failure(&error) },
    };

    match serde_json::to_string(&response) {
        Ok(serialized) => serialized,
        Err(error) => format!(
            r#"{{"status":"error","error":{{"code":"serialization","message":"{}"}}}}"#,
            escape_json_string(&error.to_string())
        ),
    }
}

/// Imports transferred UTF-8 SVG bytes from JavaScript.
#[wasm_bindgen]
pub fn import_svg(source: &[u8]) -> String {
    import_svg_json(source)
}

/// Renders a canonical document snapshot with the Rust SVG renderer.
///
/// Both arguments are JSON strings so the browser crosses the WASM boundary
/// with one coarse operation. The response is always a JSON envelope and does
/// not mutate the supplied snapshot.
#[wasm_bindgen]
pub fn render_svg(snapshot_json: &str, options_json: &str) -> String {
    render_svg_json(snapshot_json, options_json)
}

/// Projects a canonical snapshot without requiring a WASM runtime.
#[must_use]
pub fn project_editor_json(snapshot_json: &str) -> String {
    let snapshot = match serde_json::from_str::<DocumentSnapshot>(snapshot_json) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return serialize_response(EditorProjectionResponse::Error {
                error: EditorProjectionFailure { code: "invalid_snapshot".into(), message: error.to_string() },
            });
        }
    };
    serialize_response(EditorProjectionResponse::Success { projection: project_native(&snapshot) })
}

/// Projects a canonical document snapshot into the flat editor view.
#[wasm_bindgen]
pub fn project_editor(snapshot_json: &str) -> String {
    project_editor_json(snapshot_json)
}

/// Reconciles semantic editor patches without requiring a WASM runtime.
#[must_use]
pub fn reconcile_editor_patches_json(snapshot_json: &str, request_json: &str) -> String {
    let snapshot = match serde_json::from_str::<DocumentSnapshot>(snapshot_json) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return serialize_response(EditorReconciliationResponse::Error {
                error: EditorReconciliationFailure { code: "invalid_snapshot".into(), message: error.to_string() },
            });
        }
    };
    let request = match serde_json::from_str::<EditorReconciliationRequest>(request_json) {
        Ok(request) => request,
        Err(error) => {
            return serialize_response(EditorReconciliationResponse::Error {
                error: EditorReconciliationFailure { code: "invalid_request".into(), message: error.to_string() },
            });
        }
    };
    match reconcile_native(&snapshot, request) {
        Ok(transaction) => serialize_response(EditorReconciliationResponse::Success { transaction }),
        Err(error) => serialize_response(EditorReconciliationResponse::Error { error: reconciliation_failure(&error) }),
    }
}

/// Reconciles semantic editor patches into one native transaction draft.
#[wasm_bindgen]
pub fn reconcile_editor_patches(snapshot_json: &str, request_json: &str) -> String {
    reconcile_editor_patches_json(snapshot_json, request_json)
}

/// Renders a canonical document snapshot without requiring a WASM runtime.
#[must_use]
pub fn render_svg_json(snapshot_json: &str, options_json: &str) -> String {
    let snapshot = match serde_json::from_str(snapshot_json) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return serialize_response(SvgRenderResponse::Error {
                error: SvgRenderFailure { code: "invalid_snapshot".into(), message: error.to_string() },
            });
        }
    };
    let options_source = if options_json.trim().is_empty() { "{}" } else { options_json };
    let options = match serde_json::from_str::<SvgRenderOptionsInput>(options_source) {
        Ok(options) => render_options(options),
        Err(error) => {
            return serialize_response(SvgRenderResponse::Error {
                error: SvgRenderFailure { code: "invalid_options".into(), message: error.to_string() },
            });
        }
    };

    match render_native_svg(&snapshot, &options) {
        Ok(output) => serialize_response(SvgRenderResponse::Success {
            svg: output.svg,
            warnings: output.warnings.iter().map(render_warning).collect(),
        }),
        Err(error) => serialize_response(SvgRenderResponse::Error { error: render_failure(&error) }),
    }
}

fn serialize_result<T: Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn invalid_json_failure(code: &'static str, error: &serde_json::Error) -> DocumentSessionFailure {
    DocumentSessionFailure { code: code.into(), message: error.to_string() }
}

fn engine_failure(error: &EngineError) -> DocumentSessionFailure {
    let code = match error {
        EngineError::Crdt(_) => "crdt",
        EngineError::Sync(_) => "sync",
        EngineError::Schema(_) => "schema",
        EngineError::StaleHeads => "stale_heads",
        EngineError::Precondition(_) => "precondition",
        EngineError::Permission(_) => "permission",
        EngineError::Invariant(_) => "invariant",
        EngineError::EmptyHistory { action, .. } => {
            if *action == "undo" {
                "empty_undo"
            } else {
                "empty_redo"
            }
        }
    };
    DocumentSessionFailure { code: code.into(), message: error.to_string() }
}

fn serialize_response<T: Serialize>(response: T) -> String {
    serde_json::to_string(&response).unwrap_or_else(|error| {
        format!(
            r#"{{"status":"error","error":{{"code":"serialization","message":"{}"}}}}"#,
            escape_json_string(&error.to_string())
        )
    })
}

fn reconciliation_failure(error: &EditorReconciliationError) -> EditorReconciliationFailure {
    let code = match error {
        EditorReconciliationError::UnknownShape(_) => "unknown_shape",
        EditorReconciliationError::UnknownPage(_) => "unknown_page",
        EditorReconciliationError::UnknownLayer(_) => "unknown_layer",
        EditorReconciliationError::UnknownParent(_) => "unknown_parent",
        EditorReconciliationError::UnknownBinding(_) => "unknown_binding",
        EditorReconciliationError::SingularParent { .. } => "singular_parent",
        EditorReconciliationError::UnsupportedShear { .. } => "unsupported_shear",
    };
    EditorReconciliationFailure { code: code.into(), message: error.to_string() }
}

fn render_failure(error: &SvgRenderError) -> SvgRenderFailure {
    let code = match error {
        SvgRenderError::PageNotFound { .. } => "page_not_found",
        SvgRenderError::InvalidRegion => "invalid_region",
        SvgRenderError::InvalidShapeProperties { .. } => "invalid_shape_properties",
    };
    SvgRenderFailure { code: code.into(), message: error.to_string() }
}

fn render_warning(warning: &SvgRenderWarning) -> SvgRenderWarningResponse {
    let code = match warning {
        SvgRenderWarning::MissingFont { .. } => "missing_font",
        SvgRenderWarning::MissingAsset { .. } => "missing_asset",
        SvgRenderWarning::UnresolvedExternalAsset { .. } => "unresolved_external_asset",
    };
    SvgRenderWarningResponse { code: code.into(), message: warning.to_string() }
}

fn count_images(group: &inkfinite_core::svg_import::SvgGroup) -> usize {
    group
        .children
        .iter()
        .map(|node| match node {
            SvgImportNode::Group(child) => count_images(child),
            SvgImportNode::Image(_) => 1,
            SvgImportNode::Shape(_) => 0,
        })
        .sum()
}

fn failure(error: &SvgImportError) -> SvgImportFailure {
    let code = match error {
        SvgImportError::InputTooLarge { .. } => "input_too_large",
        SvgImportError::InvalidUtf8(_) => "invalid_utf8",
        SvgImportError::Xml(_) => "invalid_xml",
        SvgImportError::MissingRoot => "missing_root",
        SvgImportError::InvalidAttribute { .. } => "invalid_attribute",
        SvgImportError::InvalidPath { .. } => "invalid_path",
        SvgImportError::UnsupportedTransform { .. } => "unsupported_transform",
        SvgImportError::InvalidImage { .. } => "invalid_image",
    };
    SvgImportFailure { code: code.into(), message: error.to_string() }
}

fn escape_json_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn returns_normalized_success_and_image_count() {
        let response: Value =
            serde_json::from_str(&import_svg_json(br#"<svg><g><rect width="10" height="4"/></g></svg>"#))
                .expect("response should be JSON");
        assert_eq!(response["status"], "success");
        assert_eq!(response["omitted_image_count"], 0);
        assert_eq!(response["import"]["root"]["children"][0]["kind"], "group");
    }

    #[test]
    fn returns_structured_errors() {
        let response: Value = serde_json::from_str(&import_svg_json(b"<svg")).expect("response should be JSON");
        assert_eq!(response["status"], "error");
        assert_eq!(response["error"]["code"], "invalid_xml");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty())
        );
    }

    #[test]
    fn renders_a_canonical_snapshot_with_rust() {
        let snapshot = serde_json::json!({
            "format": "inkfinite.document",
            "format_version": 2,
            "document_id": "document:wasm",
            "heads": [],
            "document": {
                "pages": {
                    "page:one": {
                        "id": "page:one",
                        "name": "Page 1",
                        "layer_ids": ["layer:one"],
                        "version": 1
                    }
                },
                "page_ids": ["page:one"],
                "layers": {
                    "layer:one": {
                        "id": "layer:one",
                        "page_id": "page:one",
                        "name": "Default",
                        "shape_ids": ["shape:rect"],
                        "visible": true,
                        "locked": false,
                        "opacity": 1,
                        "version": 1
                    }
                },
                "shapes": {
                    "shape:rect": {
                        "id": "shape:rect",
                        "kind": "rect",
                        "parent": {"kind": "layer", "id": "layer:one"},
                        "transform": {
                            "translation": {"x": 10, "y": 20},
                            "rotation": 0,
                            "scale_x": 1,
                            "scale_y": 1
                        },
                        "child_ids": [],
                        "layout": null,
                        "properties": {"w": 40, "h": 20, "fill": "red", "stroke": "none", "radius": 0},
                        "metadata": {
                            "name": null,
                            "role": null,
                            "description": null,
                            "tags": [],
                            "locked": false,
                            "agent_editable": true,
                            "provenance": {
                                "actor_id": "browser",
                                "origin": "human",
                                "timestamp": 0,
                                "source": null
                            }
                        },
                        "style": {"opacity": 1, "fill_opacity": null, "stroke_opacity": null},
                        "version": 1
                    }
                },
                "bindings": {},
                "assets": {}
            }
        });
        let first = render_svg_json(&snapshot.to_string(), "{}");
        let second = render_svg_json(&snapshot.to_string(), "{}");
        assert_eq!(first, second);
        let response: Value = serde_json::from_str(&first).expect("render response should be JSON");
        assert_eq!(response["status"], "success");
        assert!(response["svg"].as_str().is_some_and(|svg| svg.contains("<rect")));
    }

    #[test]
    fn reports_invalid_render_snapshots() {
        let response: Value =
            serde_json::from_str(&render_svg_json("{}", "[")).expect("render response should be JSON");
        assert_eq!(response["status"], "error");
        assert_eq!(response["error"]["code"], "invalid_snapshot");
    }

    #[test]
    fn projects_and_reconciles_editor_changes() {
        let snapshot = serde_json::json!({
            "format": "inkfinite.document",
            "format_version": 2,
            "document_id": "document:wasm-editor",
            "heads": ["head:one"],
            "document": {
                "pages": {"page:one": {"id": "page:one", "name": "Page 1", "layer_ids": ["layer:one"], "version": 1}},
                "page_ids": ["page:one"],
                "layers": {"layer:one": {"id": "layer:one", "page_id": "page:one", "name": "Default", "shape_ids": ["shape:rect"], "visible": true, "locked": false, "opacity": 1, "version": 1}},
                "shapes": {"shape:rect": {
                    "id": "shape:rect", "kind": "rect", "parent": {"kind": "layer", "id": "layer:one"},
                    "transform": {"translation": {"x": 10, "y": 20}, "rotation": 0, "scale_x": 1, "scale_y": 1},
                    "child_ids": [], "layout": null, "properties": {"width": 40, "height": 20},
                    "metadata": {"name": null, "role": null, "description": null, "tags": [], "locked": false, "agent_editable": true,
                        "provenance": {"actor_id": "browser", "origin": "human", "timestamp": 0, "source": null}},
                    "style": {"opacity": 1, "fill_opacity": null, "stroke_opacity": null}, "version": 1
                }},
                "bindings": {}, "assets": {}
            }
        });
        let projection: Value =
            serde_json::from_str(&project_editor_json(&snapshot.to_string())).expect("projection JSON");
        assert_eq!(projection["status"], "success");
        assert_eq!(projection["projection"]["shapes"]["shape:rect"]["x"], 10.0);

        let request = serde_json::json!({
            "patches": [{
                "type": "shape", "shape_id": "shape:rect",
                "transform": {"a": 1, "b": 0, "c": 0, "d": 1, "e": 15, "f": 20},
                "properties": null, "metadata": null, "style": null, "parent": null, "anchor": null
            }],
            "actor_id": "browser", "origin": "human", "transaction_id": "transaction:editor",
            "description": "Move rectangle", "timestamp": 1
        });
        let reconciled: Value = serde_json::from_str(&reconcile_editor_patches_json(
            &snapshot.to_string(),
            &request.to_string(),
        ))
        .expect("reconciliation JSON");
        assert_eq!(reconciled["status"], "success");
        assert_eq!(
            reconciled["transaction"]["operations"].as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(reconciled["transaction"]["base_heads"][0], "head:one");
    }

    #[test]
    fn stateful_session_commits_saves_and_replays_history() {
        let snapshot = serde_json::json!({
            "format": "inkfinite.document",
            "format_version": 2,
            "document_id": "document:session",
            "heads": [],
            "document": {
                "pages": {"page:one": {"id": "page:one", "name": "Page 1", "layer_ids": ["layer:one"], "version": 1}},
                "page_ids": ["page:one"],
                "layers": {"layer:one": {"id": "layer:one", "page_id": "page:one", "name": "Default", "shape_ids": [], "visible": true, "locked": false, "opacity": 1, "version": 1}},
                "shapes": {}, "bindings": {}, "assets": {}
            }
        });
        let mut session = create_document(&snapshot.to_string(), "browser").expect("session should open");
        let request = serde_json::json!({
            "patches": [{
                "type": "create_shape",
                "shape": {"id": "shape:rect", "kind": "rect", "properties": {"w": 20, "h": 10}, "metadata": null, "style": {"opacity": 1, "fill_opacity": null, "stroke_opacity": null}, "layout": null},
                "parent": {"kind": "layer", "id": "layer:one"},
                "transform": {"a": 1, "b": 0, "c": 0, "d": 1, "e": 4, "f": 5},
                "anchor": {"position": "last"}
            }, {
                "type": "create_shape",
                "shape": {"id": "shape:path", "kind": "path", "properties": {
                    "subpaths": [{"segments": [
                        {"type": "move", "to": {"x": 0, "y": 0}},
                        {"type": "line", "to": {"x": 20, "y": 10}}
                    ], "closed": false}],
                    "fill_rule": "nonzero"
                }, "metadata": null, "style": {"opacity": 1, "fill_opacity": null, "stroke_opacity": null}, "layout": null},
                "parent": {"kind": "layer", "id": "layer:one"},
                "transform": {"a": 1, "b": 0, "c": 0, "d": 1, "e": 30, "f": 5},
                "anchor": {"position": "last"}
            }, {
                "type": "create_shape",
                "shape": {"id": "shape:stroke", "kind": "stroke", "properties": {
                    "points": [[0, 0], [20, 10]],
                    "style": {"color": "#000000", "opacity": 1},
                    "brush": {"size": 8, "thinning": 0.5, "smoothing": 0.5, "streamline": 0.5, "simulatePressure": true}
                }, "metadata": null, "style": {"opacity": 1, "fill_opacity": null, "stroke_opacity": null}, "layout": null},
                "parent": {"kind": "layer", "id": "layer:one"},
                "transform": {"a": 1, "b": 0, "c": 0, "d": 1, "e": 60, "f": 5},
                "anchor": {"position": "last"}
            }],
            "actor_id": "browser", "origin": "human", "transaction_id": "transaction:create", "description": "Create geometry", "timestamp": 1
        });
        let response: Value =
            serde_json::from_str(&session.apply_editor_patches(&request.to_string())).expect("commit response");
        assert_eq!(response["status"], "success");
        let state: Value =
            serde_json::from_str(&session.state_json().expect("state should serialize")).expect("state JSON");
        assert!(state["editor_projection"].is_object());
        assert!(state["snapshot"]["document"]["shapes"]["shape:rect"].is_object());
        assert!(state["snapshot"]["document"]["shapes"]["shape:path"].is_object());
        assert_eq!(
            state["snapshot"]["document"]["shapes"]["shape:stroke"]["properties"]["brush"]["simulatePressure"],
            true
        );
        assert!(session.can_undo());
        let saved = session.save().expect("session should save");
        let mut reopened = open_document(&saved, "browser").expect("saved bytes should reopen");
        assert!(serde_json::from_str::<Value>(&reopened.state_json().expect("reopened state"))
            .expect("state JSON")["snapshot"]["document"]["shapes"]["shape:rect"]
            .is_object());
        let undo: Value = serde_json::from_str(&session.undo()).expect("undo response");
        assert_eq!(undo["status"], "success");
        assert!(!session.can_undo());
        let redo: Value = serde_json::from_str(&session.redo()).expect("redo response");
        assert_eq!(redo["status"], "success");
        assert!(session.can_undo());

        let imported: Value = serde_json::from_str(&session.import_svg_document(
            br#"<svg viewBox="0 0 20 20"><g id="group"><rect id="box" width="10" height="8"/></g></svg>"#,
            "icon.svg",
            "page:one",
            "layer:one",
            1.0,
        ))
        .expect("SVG import response");
        assert_eq!(imported["status"], "success");
        assert_eq!(imported["shape_ids"].as_array().map(Vec::len), Some(3));
        assert!(imported["state"]["editor_projection"]["shapes"].is_object());
    }
}
