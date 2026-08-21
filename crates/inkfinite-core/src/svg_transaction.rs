//! Transaction construction for importing normalized SVG content.
//!
//! The parser deliberately stops before document mutation. This module turns
//! its normalized tree into one ordered transaction so file, desktop, and CLI
//! callers share the same validation and history path.

use std::collections::BTreeSet;

use serde_json::json;
use thiserror::Error;

use crate::proto::{Operation, TransactionDraft, TransactionId};
use crate::svg_import::{SvgAsset, SvgGroup, SvgImport, SvgImportNode};
use crate::{
    ActorId, AssetId, AssetRecord, AssetSource, DocumentSnapshot, LayerId, Origin, PageId, Provenance, RecordVersion,
    SemanticMetadata, ShapeId, ShapeParent, ShapeRecord, SiblingAnchor, Timestamp,
};

/// Inputs that identify the document location and history metadata for an SVG import.
#[derive(Clone, Debug)]
pub struct SvgImportTransactionOptions {
    /// Actor that owns the transaction.
    pub actor_id: ActorId,
    /// Provenance origin for the created records.
    pub origin: Origin,
    /// Page that owns the target layer.
    pub page_id: PageId,
    /// Layer that receives the imported root container.
    pub layer_id: LayerId,
    /// Stable transaction identifier.
    pub transaction_id: TransactionId,
    /// Human-readable transaction description.
    pub description: String,
    /// Source filename retained in provenance and used for the root name.
    pub source_name: Option<String>,
    /// Client-recorded transaction time.
    pub timestamp: Timestamp,
}

/// One validated-ready SVG import transaction and its import diagnostics.
#[derive(Clone, Debug, PartialEq)]
pub struct SvgImportTransaction {
    /// The single transaction containing source assets and native shapes.
    pub transaction: TransactionDraft,
    /// Native shape IDs created by the transaction, in creation order.
    pub shape_ids: Vec<ShapeId>,
    /// Asset IDs included by the transaction, including retained source data.
    pub asset_ids: Vec<AssetId>,
    /// Number of image nodes omitted because their source data could not be represented.
    pub omitted_image_count: usize,
}

/// A target or asset conflict found while building an SVG transaction.
#[derive(Clone, Debug, Error, PartialEq)]
pub enum SvgImportTransactionError {
    /// The selected page does not exist.
    #[error("SVG import target page {0} does not exist")]
    MissingPage(PageId),
    /// The selected layer does not exist.
    #[error("SVG import target layer {0} does not exist")]
    MissingLayer(LayerId),
    /// The selected layer belongs to another page.
    #[error("SVG import target layer {layer} does not belong to page {page}")]
    LayerPageMismatch { page: PageId, layer: LayerId },
    /// The document already contains a different asset at the imported ID.
    #[error("document already contains a different asset at {0}")]
    AssetConflict(AssetId),
}

/// Builds one transaction from a normalized SVG import and a current snapshot.
///
/// The root SVG becomes a container on `layer_id`. Nested groups become child
/// containers, while supported elements become ordinary native shapes. Assets
/// are created before the shape tree and existing identical content-addressed
/// assets are reused.
///
/// # Errors
///
/// Returns [`SvgImportTransactionError`] when the target page or layer is
/// missing, or an existing asset ID has different contents.
pub fn build_svg_import_transaction(
    snapshot: &DocumentSnapshot, import: &SvgImport, options: SvgImportTransactionOptions,
) -> Result<SvgImportTransaction, SvgImportTransactionError> {
    let page = snapshot
        .document
        .pages
        .get(&options.page_id)
        .ok_or_else(|| SvgImportTransactionError::MissingPage(options.page_id.clone()))?;
    let layer = snapshot
        .document
        .layers
        .get(&options.layer_id)
        .ok_or_else(|| SvgImportTransactionError::MissingLayer(options.layer_id.clone()))?;
    if layer.page_id != page.id {
        return Err(SvgImportTransactionError::LayerPageMismatch { page: page.id.clone(), layer: layer.id.clone() });
    }

    let mut operations = Vec::new();
    let mut asset_ids = Vec::new();
    for asset in std::iter::once(&import.source_asset).chain(import.assets.iter()) {
        if let Some(existing) = snapshot.document.assets.get(&asset.id) {
            if !same_asset(existing, asset) {
                return Err(SvgImportTransactionError::AssetConflict(asset.id.clone()));
            }
            asset_ids.push(asset.id.clone());
            continue;
        }
        operations.push(Operation::CreateAsset { asset: asset_record(asset, &options) });
        asset_ids.push(asset.id.clone());
    }

    let mut ids = ShapeIdAllocator::new(&snapshot.document.shapes, &import.source_asset.id);
    let root_id = ids.next();
    let root_name = options
        .source_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| import.source_asset.name.strip_prefix("source-").map(str::to_owned))
        .unwrap_or_else(|| "Imported SVG".into());
    operations.push(Operation::CreateShape {
        shape: group_record(
            root_id.clone(),
            ShapeParent::Layer(options.layer_id.clone()),
            &import.root,
            root_name,
            &options,
        ),
        anchor: SiblingAnchor::Last,
    });

    let mut shape_ids = vec![root_id.clone()];
    append_group(
        &mut operations,
        &mut shape_ids,
        &mut ids,
        &import.root,
        &root_id,
        &options,
    );

    Ok(SvgImportTransaction {
        transaction: TransactionDraft {
            id: options.transaction_id,
            actor_id: options.actor_id,
            origin: options.origin,
            base_heads: snapshot.heads.clone(),
            description: options.description,
            operations,
            timestamp: options.timestamp,
        },
        shape_ids,
        asset_ids,
        omitted_image_count: 0,
    })
}

fn append_group(
    operations: &mut Vec<Operation>, shape_ids: &mut Vec<ShapeId>, ids: &mut ShapeIdAllocator, group: &SvgGroup,
    parent_id: &ShapeId, options: &SvgImportTransactionOptions,
) {
    for node in &group.children {
        match node {
            SvgImportNode::Group(child) => {
                let id = ids.next();
                let name = child
                    .source_id
                    .clone()
                    .unwrap_or_else(|| format!("Imported group {}", shape_ids.len()));
                operations.push(Operation::CreateShape {
                    shape: group_record(id.clone(), ShapeParent::Shape(parent_id.clone()), child, name, options),
                    anchor: SiblingAnchor::Last,
                });
                shape_ids.push(id.clone());
                append_group(operations, shape_ids, ids, child, &id, options);
            }
            SvgImportNode::Shape(shape) => {
                let id = ids.next();
                operations.push(Operation::CreateShape {
                    shape: ShapeRecord {
                        id: id.clone(),
                        kind: shape.kind.clone(),
                        parent: ShapeParent::Shape(parent_id.clone()),
                        transform: shape.transform,
                        child_ids: Vec::new(),
                        layout: None,
                        properties: shape.properties.clone(),
                        metadata: metadata(
                            shape.source_id.clone().unwrap_or_else(|| "Imported SVG shape".into()),
                            options,
                        ),
                        style: shape.style,
                        version: RecordVersion(1),
                    },
                    anchor: SiblingAnchor::Last,
                });
                shape_ids.push(id);
            }
            SvgImportNode::Image(image) => {
                let id = ids.next();
                let mut properties = image.properties.clone();
                properties.insert("asset_id".into(), json!(image.asset_id));
                operations.push(Operation::CreateShape {
                    shape: ShapeRecord {
                        id: id.clone(),
                        kind: crate::ShapeKind::from(crate::IMAGE_KIND),
                        parent: ShapeParent::Shape(parent_id.clone()),
                        transform: image.transform,
                        child_ids: Vec::new(),
                        layout: None,
                        properties,
                        metadata: metadata(
                            image.source_id.clone().unwrap_or_else(|| "Imported SVG image".into()),
                            options,
                        ),
                        style: image.style,
                        version: RecordVersion(1),
                    },
                    anchor: SiblingAnchor::Last,
                });
                shape_ids.push(id);
            }
        }
    }
}

fn group_record(
    id: ShapeId, parent: ShapeParent, group: &SvgGroup, name: String, options: &SvgImportTransactionOptions,
) -> ShapeRecord {
    ShapeRecord {
        id,
        kind: crate::ShapeKind::from(crate::CONTAINER_KIND),
        parent,
        transform: group.transform,
        child_ids: Vec::new(),
        layout: None,
        properties: group.properties.clone(),
        metadata: metadata(name, options),
        style: group.style,
        version: RecordVersion(1),
    }
}

fn metadata(name: String, options: &SvgImportTransactionOptions) -> SemanticMetadata {
    SemanticMetadata {
        name: Some(name),
        role: None,
        description: Some("Imported from SVG".into()),
        tags: vec!["svg-import".into()],
        locked: false,
        agent_editable: true,
        provenance: Provenance {
            actor_id: options.actor_id.clone(),
            origin: options.origin.clone(),
            timestamp: options.timestamp,
            source: options.source_name.clone(),
        },
    }
}

fn asset_record(asset: &SvgAsset, options: &SvgImportTransactionOptions) -> AssetRecord {
    AssetRecord {
        id: asset.id.clone(),
        name: asset.name.clone(),
        media_type: asset.media_type.clone(),
        digest: asset.digest.clone(),
        source: AssetSource::Embedded { bytes: asset.bytes.clone() },
        provenance: Provenance {
            actor_id: options.actor_id.clone(),
            origin: options.origin.clone(),
            timestamp: options.timestamp,
            source: options.source_name.clone(),
        },
        version: RecordVersion(1),
    }
}

fn same_asset(existing: &AssetRecord, imported: &SvgAsset) -> bool {
    existing.media_type == imported.media_type
        && existing.digest == imported.digest
        && matches!(&existing.source, AssetSource::Embedded { bytes } if bytes == &imported.bytes)
}

struct ShapeIdAllocator {
    existing: BTreeSet<ShapeId>,
    prefix: String,
    next_index: usize,
}

impl ShapeIdAllocator {
    fn new(existing: &std::collections::BTreeMap<ShapeId, ShapeRecord>, source_id: &AssetId) -> Self {
        Self {
            existing: existing.keys().cloned().collect(),
            prefix: format!("shape:svg:{}", source_id.as_str().trim_start_matches("asset:")),
            next_index: 0,
        }
    }

    fn next(&mut self) -> ShapeId {
        loop {
            self.next_index += 1;
            let candidate = ShapeId::from(format!("{}:{}", self.prefix, self.next_index));
            if self.existing.insert(candidate.clone()) {
                return candidate;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::svg_import::import_svg;
    use crate::{DocumentId, Origin, Timestamp, blank_document};

    fn snapshot() -> DocumentSnapshot {
        let document_id = DocumentId::from("document:svg");
        let document = blank_document(&document_id, None);
        DocumentSnapshot {
            format: crate::FormatId::from(crate::INKFINITE_FORMAT_ID),
            format_version: crate::INKFINITE_FORMAT_VERSION,
            document_id,
            heads: vec![crate::ChangeHash::from("hash:one")],
            document,
        }
    }

    #[test]
    fn builds_one_transaction_for_nested_svg_content_and_source_asset() {
        let source = r#"<svg viewBox="0 0 100 80"><g id="group"><rect id="box" width="20" height="30"/></g></svg>"#;
        let import = import_svg(source).expect("SVG should import");
        let current = snapshot();
        let page_id = current.document.page_ids[0].clone();
        let layer_id = current.document.pages[&page_id].layer_ids[0].clone();
        let transaction = build_svg_import_transaction(
            &current,
            &import,
            SvgImportTransactionOptions {
                actor_id: ActorId::from("actor:test"),
                origin: Origin::Human,
                page_id,
                layer_id,
                transaction_id: TransactionId("transaction:svg".into()),
                description: "Import SVG".into(),
                source_name: Some("icon.svg".into()),
                timestamp: Timestamp(1),
            },
        )
        .expect("transaction should build");

        assert_eq!(transaction.transaction.operations.len(), 4);
        assert_eq!(transaction.shape_ids.len(), 3);
        assert_eq!(transaction.asset_ids.len(), 1);
        assert!(
            transaction
                .transaction
                .operations
                .iter()
                .all(|operation| matches!(operation, Operation::CreateAsset { .. } | Operation::CreateShape { .. }))
        );
    }

    #[test]
    fn maps_embedded_svg_images_to_native_shapes_and_assets() {
        let source = r#"<svg><image id="photo" href="data:image/png;base64,AA==" width="10" height="20"/></svg>"#;
        let import = import_svg(source).expect("SVG image should import");
        let current = snapshot();
        let page_id = current.document.page_ids[0].clone();
        let layer_id = current.document.pages[&page_id].layer_ids[0].clone();
        let transaction = build_svg_import_transaction(
            &current,
            &import,
            SvgImportTransactionOptions {
                actor_id: ActorId::from("actor:test"),
                origin: Origin::Human,
                page_id,
                layer_id,
                transaction_id: TransactionId("transaction:image".into()),
                description: "Import SVG image".into(),
                source_name: Some("photo.svg".into()),
                timestamp: Timestamp(1),
            },
        )
        .expect("image transaction should build");

        assert_eq!(transaction.omitted_image_count, 0);
        assert_eq!(transaction.asset_ids.len(), 2);
        assert_eq!(transaction.shape_ids.len(), 2);
        assert!(transaction.transaction.operations.iter().any(|operation| matches!(
            operation,
            Operation::CreateShape { shape, .. } if shape.kind.as_str() == crate::IMAGE_KIND
        )));
    }
}
