//! Browser-facing bindings for the Rust-owned SVG import contract.
//!
//! The worker calls [`import_svg`] with transferred UTF-8 bytes. The function
//! always returns a JSON envelope so parse failures retain their structured
//! error code and message across the WebAssembly boundary.

use inkfinite_core::svg_import::{SvgImport, SvgImportError, SvgImportNode, import_svg as parse_svg};
use serde::Serialize;
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
}
