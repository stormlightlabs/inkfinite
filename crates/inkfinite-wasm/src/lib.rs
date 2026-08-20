//! Browser-facing bindings for Rust-owned SVG import and rendering.
//!
//! The worker calls [`import_svg`] with transferred UTF-8 bytes and
//! [`render_svg`] with one canonical snapshot. Both functions return JSON
//! envelopes so failures retain their structured code and message across the
//! WebAssembly boundary.

use std::collections::BTreeSet;

use inkfinite_core::proto::Bounds;
use inkfinite_core::render::{SvgRenderError, SvgRenderOptions, SvgRenderWarning, render_svg as render_native_svg};
use inkfinite_core::svg_import::{SvgImport, SvgImportError, SvgImportNode, import_svg as parse_svg};
use inkfinite_core::{AssetId, LayerId, PageId, ShapeId};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// The result envelope exchanged between the SVG worker and the browser.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SvgImportResponse {
    /// A normalized import and the image nodes that the current browser model omits.
    Success {
        /// The normalized Rust import tree.
        import: Box<SvgImport>,
        /// Number of embedded image nodes in the tree.
        omitted_image_count: usize,
    },
    /// A structured failure that did not mutate a document.
    Error {
        /// Import failure details.
        error: SvgImportFailure,
    },
}

/// A stable error crossing the WASM boundary.
#[derive(Debug, Serialize)]
pub struct SvgImportFailure {
    /// Machine-readable failure category.
    pub code: &'static str,
    /// Human-readable failure detail.
    pub message: String,
}

/// The result envelope exchanged for deterministic browser SVG rendering.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SvgRenderResponse {
    /// The rendered SVG and any non-fatal resource warnings.
    Success {
        /// Complete deterministic SVG markup.
        svg: String,
        /// Warnings emitted while resolving render resources.
        warnings: Vec<SvgRenderWarningResponse>,
    },
    /// The snapshot or render request could not be processed.
    Error {
        /// Render failure details.
        error: SvgRenderFailure,
    },
}

/// A stable render error crossing the WASM boundary.
#[derive(Debug, Serialize)]
pub struct SvgRenderFailure {
    /// Machine-readable failure category.
    pub code: &'static str,
    /// Human-readable failure detail.
    pub message: String,
}

/// A render warning with a stable browser-facing code.
#[derive(Debug, Serialize)]
pub struct SvgRenderWarningResponse {
    /// Machine-readable warning category.
    pub code: &'static str,
    /// Human-readable warning detail.
    pub message: String,
}

#[derive(Debug, Default, Deserialize)]
struct SvgRenderOptionsInput {
    page_id: Option<String>,
    #[serde(default)]
    layer_ids: Vec<String>,
    #[serde(default)]
    selection: Vec<String>,
    region: Option<Bounds>,
    #[serde(default)]
    available_font_families: Vec<String>,
    #[serde(default)]
    available_asset_ids: Vec<String>,
}

impl From<SvgRenderOptionsInput> for SvgRenderOptions {
    fn from(input: SvgRenderOptionsInput) -> Self {
        Self {
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

/// Renders a canonical document snapshot without requiring a WASM runtime.
#[must_use]
pub fn render_svg_json(snapshot_json: &str, options_json: &str) -> String {
    let snapshot = match serde_json::from_str(snapshot_json) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return serialize_response(SvgRenderResponse::Error {
                error: SvgRenderFailure { code: "invalid_snapshot", message: error.to_string() },
            });
        }
    };
    let options_source = if options_json.trim().is_empty() { "{}" } else { options_json };
    let options = match serde_json::from_str::<SvgRenderOptionsInput>(options_source) {
        Ok(options) => options.into(),
        Err(error) => {
            return serialize_response(SvgRenderResponse::Error {
                error: SvgRenderFailure { code: "invalid_options", message: error.to_string() },
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

fn serialize_response<T: Serialize>(response: T) -> String {
    serde_json::to_string(&response).unwrap_or_else(|error| {
        format!(
            r#"{{"status":"error","error":{{"code":"serialization","message":"{}"}}}}"#,
            escape_json_string(&error.to_string())
        )
    })
}

fn render_failure(error: &SvgRenderError) -> SvgRenderFailure {
    let code = match error {
        SvgRenderError::PageNotFound { .. } => "page_not_found",
        SvgRenderError::InvalidRegion => "invalid_region",
        SvgRenderError::InvalidShapeProperties { .. } => "invalid_shape_properties",
    };
    SvgRenderFailure { code, message: error.to_string() }
}

fn render_warning(warning: &SvgRenderWarning) -> SvgRenderWarningResponse {
    let code = match warning {
        SvgRenderWarning::MissingFont { .. } => "missing_font",
        SvgRenderWarning::MissingAsset { .. } => "missing_asset",
        SvgRenderWarning::UnresolvedExternalAsset { .. } => "unresolved_external_asset",
    };
    SvgRenderWarningResponse { code, message: warning.to_string() }
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
    SvgImportFailure { code, message: error.to_string() }
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
}
