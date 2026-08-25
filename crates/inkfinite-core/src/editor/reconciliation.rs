//! Editor patch translation into canonical transaction operations.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::boolean::{BooleanPathOperation, boolean_path_operation};
use crate::engine::geometry::{Affine, decompose_transform, parent_world_transform, world_transform};
use crate::path::{PathTopologyOperation, apply_path_topology_operations};
use crate::proto::{
    LayerContentsDisposition, LayerPatch, Operation, ShapePatch as NativeShapePatch, TransactionDraft, TransactionId,
};
use crate::{
    ActorId, AssetRecord, BindingRecord, Document, DocumentSnapshot, LayerId, LayerRecord, Origin, PageId, PageRecord,
    PathGeometry, PathSegment, PathSubpath, Provenance, RecordVersion, SemanticMetadata, ShapeId, ShapeKind,
    ShapeParent, ShapeProperties, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform,
};

use super::projection::native_properties;
use super::{EditorShapeDraft, EditorTransform};

/// Semantic editor changes that can be reconciled into native operations.
///
/// Shape transforms are world-space transforms from [`EditorShape::transform`].
/// The reconciler converts them back to parent-relative canonical transforms.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum EditorPatch {
    /// Change fields on an existing shape. A supplied transform is world-space.
    Shape {
        /// Shape to change.
        shape_id: ShapeId,
        /// Replacement world-space transform.
        transform: Option<EditorTransform>,
        /// Replacement editor properties.
        #[ts(type = "ShapeProperties | null")]
        properties: Option<ShapeProperties>,
        /// Replacement semantic metadata.
        metadata: Option<SemanticMetadata>,
        /// Replacement visual style.
        style: Option<ShapeStyle>,
        /// Replacement parent, when reparenting is part of the edit.
        parent: Option<ShapeParent>,
        /// Replacement sibling placement.
        anchor: Option<SiblingAnchor<ShapeId>>,
    },
    /// Convert one shape while retaining its identity, hierarchy, transform,
    /// semantic metadata, and common style.
    ConvertShape {
        /// Shape to convert.
        shape_id: ShapeId,
        /// Replacement registry kind.
        kind: ShapeKind,
        /// Replacement editor properties.
        #[ts(type = "ShapeProperties")]
        properties: ShapeProperties,
        /// Optional replacement visual style.
        style: Option<ShapeStyle>,
    },
    /// Apply canonical topology operations to one native path.
    PathTopology {
        /// Path shape to edit.
        shape_id: ShapeId,
        /// Ordered operations applied to the path in one transaction.
        operations: Vec<PathTopologyOperation>,
    },
    /// Combine selected native paths into the first selected path.
    BooleanPaths {
        /// Paths to combine in selection order.
        shape_ids: Vec<ShapeId>,
        /// Boolean operation applied to the selected filled regions.
        operation: BooleanPathOperation,
    },
    /// Create a page and its later layer records.
    CreatePage {
        /// New page record.
        page: PageRecord,
        /// Placement relative to an existing page.
        anchor: SiblingAnchor<PageId>,
    },
    /// Delete a page and all records it owns.
    DeletePage {
        /// Page to delete.
        page_id: PageId,
    },
    /// Create an empty layer.
    CreateLayer {
        /// New layer record.
        layer: LayerRecord,
        /// Placement relative to an existing layer.
        anchor: SiblingAnchor<LayerId>,
    },
    /// Delete a layer and handle its children explicitly.
    DeleteLayer {
        /// Layer to delete.
        layer_id: LayerId,
        /// Handling for shapes owned by the layer.
        contents: LayerContentsDisposition,
    },
    /// Create one shape from editor-owned semantic fields.
    CreateShape {
        /// New shape fields.
        shape: EditorShapeDraft,
        /// Parent in the native hierarchy.
        parent: ShapeParent,
        /// World-space transform for the new shape.
        transform: EditorTransform,
        /// Sibling placement.
        anchor: SiblingAnchor<ShapeId>,
    },
    /// Delete a shape and its descendants.
    DeleteShape {
        /// Shape to delete.
        shape_id: ShapeId,
    },
    /// Rename a page.
    RenamePage {
        /// Page to rename.
        page_id: PageId,
        /// Replacement page name.
        name: String,
    },
    /// Change mutable layer fields.
    PatchLayer {
        /// Layer to change.
        layer_id: LayerId,
        /// Replacement fields.
        patch: LayerPatch,
    },
    /// Reorder a layer within its page.
    ReorderLayer {
        /// Layer to move.
        layer_id: LayerId,
        /// Replacement placement.
        anchor: SiblingAnchor<LayerId>,
    },
    /// Create a binding.
    CreateBinding {
        /// Binding record to create.
        binding: BindingRecord,
    },
    /// Delete a binding.
    DeleteBinding {
        /// Binding to delete.
        binding_id: crate::BindingId,
    },
    /// Create an embedded asset.
    CreateAsset {
        /// Complete asset record.
        asset: AssetRecord,
    },
    /// Delete an embedded asset.
    DeleteAsset {
        /// Asset to delete.
        asset_id: crate::AssetId,
    },
}

/// Request metadata used to turn editor patches into one transaction draft.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorReconciliationRequest {
    /// Ordered semantic editor changes.
    pub patches: Vec<EditorPatch>,
    /// Actor committing the resulting transaction.
    pub actor_id: ActorId,
    /// Origin retained in transaction history.
    pub origin: Origin,
    /// Stable transaction identifier.
    pub transaction_id: TransactionId,
    /// Human-readable history description.
    pub description: String,
    /// Client timestamp.
    pub timestamp: Timestamp,
}

/// Failure while translating an editor patch into a native transaction.
#[derive(Debug, Error, PartialEq)]
pub enum EditorReconciliationError {
    /// The patch referred to a missing shape.
    #[error("editor patch refers to unknown shape {0}")]
    UnknownShape(ShapeId),
    /// The patch referred to a missing page.
    #[error("editor patch refers to unknown page {0}")]
    UnknownPage(PageId),
    /// The patch referred to a missing layer.
    #[error("editor patch refers to unknown layer {0}")]
    UnknownLayer(LayerId),
    /// The patch referred to a missing parent shape.
    #[error("editor patch refers to unknown parent shape {0}")]
    UnknownParent(ShapeId),
    /// The patch referred to a missing binding.
    #[error("editor patch refers to unknown binding {0}")]
    UnknownBinding(crate::BindingId),
    /// The patch referred to a missing asset.
    #[error("editor patch refers to unknown asset {0}")]
    UnknownAsset(crate::AssetId),
    /// A parent transform could not be inverted.
    #[error("parent transform for shape {shape_id} is singular")]
    SingularParent {
        /// Shape whose parent could not be inverted.
        shape_id: ShapeId,
    },
    /// A world transform cannot be represented by the native transform model.
    #[error("world transform for shape {shape_id} contains unsupported shear")]
    UnsupportedShear {
        /// Shape whose transform could not be decomposed.
        shape_id: ShapeId,
    },
    /// A path topology operation was invalid for the selected shape.
    #[error("path topology operation for shape {shape_id} failed: {message}")]
    PathTopology {
        /// Shape whose geometry was targeted.
        shape_id: ShapeId,
        /// Canonical geometry error.
        message: String,
    },
    /// A boolean path operation could not produce a valid native result.
    #[error("boolean path operation failed: {message}")]
    BooleanPaths {
        /// Canonical geometry error.
        message: String,
    },
}

/// Reconciles semantic editor changes into one minimal native transaction.
///
/// The returned draft retains the inspected snapshot heads and uses record
/// versions on the first operation touching each record. The transaction
/// engine remains responsible for final validation and atomic commit.
///
/// # Errors
///
/// Returns an error when a patch refers to missing hierarchy records or asks
/// for a world transform that cannot be represented by a native transform.
pub fn reconcile_editor_patches(
    snapshot: &DocumentSnapshot, request: EditorReconciliationRequest,
) -> Result<TransactionDraft, EditorReconciliationError> {
    let document = &snapshot.document;
    let mut operations = Vec::new();
    let mut created_layers = BTreeSet::new();
    let mut created_shapes = BTreeMap::new();
    let mut touched_layers = BTreeSet::new();
    let mut touched_pages = BTreeSet::new();
    let default_metadata = default_metadata(&request);

    for patch in request.patches {
        match patch {
            EditorPatch::CreatePage { page, anchor } => operations.push(Operation::CreatePage { page, anchor }),
            EditorPatch::DeletePage { page_id } => {
                let page = document
                    .pages
                    .get(&page_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownPage(page_id.clone()))?;
                let expected_version = (!touched_pages.contains(&page_id)).then_some(page.version);
                operations.push(Operation::DeletePage { page_id, expected_version });
            }
            EditorPatch::CreateLayer { layer, anchor } => {
                created_layers.insert(layer.id.clone());
                touched_pages.insert(layer.page_id.clone());
                operations.push(Operation::CreateLayer { layer, anchor });
            }
            EditorPatch::DeleteLayer { layer_id, contents } => {
                let layer = document
                    .layers
                    .get(&layer_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownLayer(layer_id.clone()))?;
                let expected_version = (!touched_layers.contains(&layer_id)).then_some(layer.version);
                touched_pages.insert(layer.page_id.clone());
                operations.push(Operation::DeleteLayer { layer_id: layer_id.clone(), contents, expected_version });
                touched_layers.insert(layer_id);
            }
            EditorPatch::Shape { shape_id, transform, properties, metadata, style, parent, anchor } => {
                reconcile_shape(
                    document,
                    shape_id,
                    ReconcileShapeOptions { transform, properties, metadata, style, parent: parent.as_ref(), anchor },
                    &created_layers,
                    &created_shapes,
                    &mut operations,
                )?;
            }
            EditorPatch::ConvertShape { shape_id, kind, properties, style } => {
                let shape = document
                    .shapes
                    .get(&shape_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_id.clone()))?;
                operations.push(Operation::ConvertShape {
                    shape_id,
                    kind: kind.to_string(),
                    properties: native_properties(&properties),
                    style,
                    expected_version: Some(shape.version),
                });
            }
            EditorPatch::PathTopology { shape_id, operations: topology } => {
                reconcile_path_topology(document, shape_id, &topology, &mut operations)?;
            }
            EditorPatch::BooleanPaths { shape_ids, operation } => {
                reconcile_boolean_paths(document, &shape_ids, operation, &mut operations)?;
            }
            EditorPatch::CreateShape { shape, parent, transform, anchor } => {
                let local_transform = local_transform(
                    document,
                    &shape.id,
                    &parent,
                    transform,
                    &created_layers,
                    &created_shapes,
                )?;
                let metadata = shape.metadata.unwrap_or_else(|| default_metadata.clone());
                let native_shape = ShapeRecord {
                    id: shape.id,
                    kind: shape.kind,
                    parent,
                    transform: local_transform,
                    child_ids: Vec::new(),
                    layout: shape.layout,
                    properties: native_properties(&shape.properties),
                    metadata,
                    style: shape.style,
                    version: RecordVersion(1),
                };
                created_shapes.insert(native_shape.id.clone(), transform);
                operations.push(Operation::CreateShape { shape: native_shape, anchor });
            }
            EditorPatch::DeleteShape { shape_id } => {
                let shape = document
                    .shapes
                    .get(&shape_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_id.clone()))?;
                operations.push(Operation::DeleteShape { shape_id, expected_version: Some(shape.version) });
            }
            EditorPatch::RenamePage { page_id, name } => {
                let page = document
                    .pages
                    .get(&page_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownPage(page_id.clone()))?;
                if page.name != name {
                    let expected_version = (!touched_pages.contains(&page_id)).then_some(page.version);
                    operations.push(Operation::RenamePage { page_id, name, expected_version });
                }
            }
            EditorPatch::PatchLayer { layer_id, patch } => {
                let layer = document
                    .layers
                    .get(&layer_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownLayer(layer_id.clone()))?;
                if layer_patch_changes(layer, &patch) {
                    let expected_version = (!touched_layers.contains(&layer_id)).then_some(layer.version);
                    operations.push(Operation::PatchLayer { layer_id: layer_id.clone(), patch, expected_version });
                    touched_layers.insert(layer_id);
                }
            }
            EditorPatch::ReorderLayer { layer_id, anchor } => {
                let layer = document
                    .layers
                    .get(&layer_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownLayer(layer_id.clone()))?;
                let expected_version = (!touched_layers.contains(&layer_id)).then_some(layer.version);
                touched_pages.insert(layer.page_id.clone());
                operations.push(Operation::ReorderLayer { layer_id: layer_id.clone(), anchor, expected_version });
                touched_layers.insert(layer_id);
            }
            EditorPatch::CreateBinding { binding } => operations.push(Operation::CreateBinding { binding }),
            EditorPatch::DeleteBinding { binding_id } => {
                let binding = document
                    .bindings
                    .get(&binding_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownBinding(binding_id.clone()))?;
                operations.push(Operation::DeleteBinding { binding_id, expected_version: Some(binding.version) });
            }
            EditorPatch::CreateAsset { asset } => operations.push(Operation::CreateAsset { asset }),
            EditorPatch::DeleteAsset { asset_id } => {
                let asset = document
                    .assets
                    .get(&asset_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownAsset(asset_id.clone()))?;
                operations.push(Operation::DeleteAsset { asset_id, expected_version: Some(asset.version) });
            }
        }
    }

    Ok(TransactionDraft {
        id: request.transaction_id,
        actor_id: request.actor_id,
        origin: request.origin,
        base_heads: snapshot.heads.clone(),
        description: request.description,
        operations,
        timestamp: request.timestamp,
    })
}

fn reconcile_path_topology(
    document: &Document, shape_id: ShapeId, topology: &[PathTopologyOperation], operations: &mut Vec<Operation>,
) -> Result<(), EditorReconciliationError> {
    let shape = document
        .shapes
        .get(&shape_id)
        .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_id.clone()))?;
    if shape.kind.as_str() != crate::PATH_KIND {
        return Err(EditorReconciliationError::PathTopology {
            shape_id,
            message: "topology operations require a path shape".into(),
        });
    }
    if topology.is_empty() {
        return Ok(());
    }
    let mut geometry = crate::path_geometry_from_properties(&shape.properties).map_err(|error| {
        EditorReconciliationError::PathTopology { shape_id: shape.id.clone(), message: error.to_string() }
    })?;
    apply_path_topology_operations(&mut geometry, topology).map_err(|error| {
        EditorReconciliationError::PathTopology { shape_id: shape.id.clone(), message: error.to_string() }
    })?;
    let mut properties = shape.properties.clone();
    properties.insert(
        "subpaths".into(),
        serde_json::to_value(geometry.subpaths).map_err(|error| EditorReconciliationError::PathTopology {
            shape_id: shape.id.clone(),
            message: error.to_string(),
        })?,
    );
    properties.insert(
        "fill_rule".into(),
        serde_json::to_value(geometry.fill_rule).map_err(|error| EditorReconciliationError::PathTopology {
            shape_id: shape.id.clone(),
            message: error.to_string(),
        })?,
    );
    if properties != shape.properties {
        operations.push(Operation::PatchShape {
            shape_id: shape.id.clone(),
            patch: NativeShapePatch { properties: Some(properties), ..NativeShapePatch::default() },
            expected_version: Some(shape.version),
        });
    }
    Ok(())
}

fn reconcile_boolean_paths(
    document: &Document, shape_ids: &[ShapeId], operation: BooleanPathOperation, operations: &mut Vec<Operation>,
) -> Result<(), EditorReconciliationError> {
    if shape_ids.len() < 2 {
        return Err(EditorReconciliationError::BooleanPaths { message: "at least two paths are required".into() });
    }
    if shape_ids.iter().collect::<BTreeSet<_>>().len() != shape_ids.len() {
        return Err(EditorReconciliationError::BooleanPaths { message: "paths must be distinct".into() });
    }
    let first = document
        .shapes
        .get(&shape_ids[0])
        .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_ids[0].clone()))?;
    let first_page = shape_page_id(document, first);
    let mut geometries = Vec::with_capacity(shape_ids.len());
    for (index, shape_id) in shape_ids.iter().enumerate() {
        let shape = document
            .shapes
            .get(shape_id)
            .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_id.clone()))?;
        if shape.kind.as_str() != crate::PATH_KIND {
            return Err(EditorReconciliationError::BooleanPaths {
                message: format!("shape {} is not a path", shape.id),
            });
        }
        if shape_page_id(document, shape) != first_page {
            return Err(EditorReconciliationError::BooleanPaths {
                message: "boolean paths must be on one page".into(),
            });
        }
        let geometry = crate::path_geometry_from_properties(&shape.properties)
            .map_err(|error| EditorReconciliationError::BooleanPaths { message: format!("path {index}: {error}") })?;
        let flattened = crate::flatten_path_with_transform(
            &geometry,
            world_transform(document, shape),
            crate::DEFAULT_PATH_METRIC_TOLERANCE.min(0.1),
        );
        let subpaths = flattened
            .subpaths
            .into_iter()
            .map(|subpath| PathSubpath {
                segments: subpath
                    .points
                    .into_iter()
                    .enumerate()
                    .map(|(point_index, point)| {
                        if point_index == 0 { PathSegment::Move { to: point } } else { PathSegment::Line { to: point } }
                    })
                    .collect(),
                closed: subpath.closed,
                handle_modes: None,
            })
            .collect();
        geometries.push(PathGeometry { subpaths, fill_rule: geometry.fill_rule });
    }

    let combined = boolean_path_operation(&geometries, operation)
        .map_err(|error| EditorReconciliationError::BooleanPaths { message: error.to_string() })?;
    let inverse =
        world_transform(document, first)
            .inverse()
            .ok_or_else(|| EditorReconciliationError::BooleanPaths {
                message: format!("shape {} has a singular transform", first.id),
            })?;
    let local = transform_path_geometry(&combined, inverse);
    let mut properties = first.properties.clone();
    properties.insert(
        "subpaths".into(),
        serde_json::to_value(local.subpaths)
            .map_err(|error| EditorReconciliationError::BooleanPaths { message: error.to_string() })?,
    );
    properties.insert(
        "fill_rule".into(),
        serde_json::to_value(local.fill_rule)
            .map_err(|error| EditorReconciliationError::BooleanPaths { message: error.to_string() })?,
    );
    operations.push(Operation::PatchShape {
        shape_id: first.id.clone(),
        patch: NativeShapePatch { properties: Some(properties), ..NativeShapePatch::default() },
        expected_version: Some(first.version),
    });
    for shape_id in shape_ids.iter().skip(1) {
        let shape = document
            .shapes
            .get(shape_id)
            .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_id.clone()))?;
        operations.push(Operation::DeleteShape { shape_id: shape.id.clone(), expected_version: Some(shape.version) });
    }
    Ok(())
}

fn shape_page_id(document: &Document, shape: &ShapeRecord) -> Option<PageId> {
    match &shape.parent {
        ShapeParent::Layer(layer_id) => document.layers.get(layer_id).map(|layer| layer.page_id.clone()),
        ShapeParent::Shape(parent_id) => document
            .shapes
            .get(parent_id)
            .and_then(|parent| shape_page_id(document, parent)),
    }
}

fn transform_path_geometry(geometry: &PathGeometry, transform: Affine) -> PathGeometry {
    let transform_point = |point| transform.point(point);
    PathGeometry {
        fill_rule: geometry.fill_rule,
        subpaths: geometry
            .subpaths
            .iter()
            .map(|subpath| PathSubpath {
                closed: subpath.closed,
                handle_modes: None,
                segments: subpath
                    .segments
                    .iter()
                    .map(|segment| match *segment {
                        PathSegment::Move { to } => PathSegment::Move { to: transform_point(to) },
                        PathSegment::Line { to } => PathSegment::Line { to: transform_point(to) },
                        PathSegment::Quadratic { control, to } => {
                            PathSegment::Quadratic { control: transform_point(control), to: transform_point(to) }
                        }
                        PathSegment::Cubic { control_1, control_2, to } => PathSegment::Cubic {
                            control_1: transform_point(control_1),
                            control_2: transform_point(control_2),
                            to: transform_point(to),
                        },
                    })
                    .collect(),
            })
            .collect(),
    }
}

struct ReconcileShapeOptions<'a> {
    transform: Option<EditorTransform>,
    properties: Option<ShapeProperties>,
    metadata: Option<SemanticMetadata>,
    style: Option<ShapeStyle>,
    parent: Option<&'a ShapeParent>,
    anchor: Option<SiblingAnchor<ShapeId>>,
}

fn reconcile_shape(
    document: &Document, shape_id: ShapeId, options: ReconcileShapeOptions<'_>, created_layers: &BTreeSet<LayerId>,
    created_shapes: &BTreeMap<ShapeId, EditorTransform>, operations: &mut Vec<Operation>,
) -> Result<(), EditorReconciliationError> {
    let ReconcileShapeOptions { transform, properties, metadata, style, parent, anchor } = options;
    let shape = document
        .shapes
        .get(&shape_id)
        .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_id.clone()))?;
    let target_parent = parent.cloned().unwrap_or_else(|| shape.parent.clone());
    let parent_changed = parent.is_some_and(|value| value != &shape.parent);
    let reorder = anchor.is_some();
    let mut shape_patch = NativeShapePatch::default();

    if let Some(world) = transform {
        let local = local_transform(
            document,
            &shape_id,
            &target_parent,
            world,
            created_layers,
            created_shapes,
        )?;
        let current_world = world_transform(document, shape);
        if !same_affine(current_world, world.into()) || parent_changed {
            shape_patch.transform = Some(local);
        }
    }
    if let Some(properties) = properties {
        let properties = native_properties(&properties);
        if properties != shape.properties {
            shape_patch.properties = Some(properties);
        }
    }
    if let Some(metadata) = metadata
        && metadata != shape.metadata
    {
        shape_patch.metadata = Some(metadata);
    }
    if let Some(style) = style
        && style != shape.style
    {
        shape_patch.style = Some(style);
    }

    let mut used_version = false;
    if parent_changed || reorder {
        operations.push(Operation::ReparentShape {
            shape_id: shape_id.clone(),
            parent: target_parent,
            anchor: anchor.unwrap_or(SiblingAnchor::Last),
            expected_version: Some(shape.version),
        });
        used_version = true;
    }
    if shape_patch.transform.is_some()
        || shape_patch.properties.is_some()
        || shape_patch.metadata.is_some()
        || shape_patch.style.is_some()
        || shape_patch.layout.is_some()
    {
        operations.push(Operation::PatchShape {
            shape_id,
            patch: shape_patch,
            expected_version: (!used_version).then_some(shape.version),
        });
    }
    Ok(())
}

fn local_transform(
    document: &Document, shape_id: &ShapeId, parent: &ShapeParent, world: EditorTransform,
    created_layers: &BTreeSet<LayerId>, created_shapes: &BTreeMap<ShapeId, EditorTransform>,
) -> Result<Transform, EditorReconciliationError> {
    let parent_world = match parent {
        ShapeParent::Layer(layer_id) => {
            if created_layers.contains(layer_id) {
                Affine::IDENTITY
            } else {
                parent_world_transform(document, parent)
                    .ok_or_else(|| EditorReconciliationError::UnknownLayer(layer_id.clone()))?
            }
        }
        ShapeParent::Shape(parent_id) => {
            if let Some(parent_world) = created_shapes.get(parent_id) {
                (*parent_world).into()
            } else {
                if !document.shapes.contains_key(parent_id) {
                    return Err(EditorReconciliationError::UnknownParent(parent_id.clone()));
                }
                parent_world_transform(document, parent)
                    .ok_or_else(|| EditorReconciliationError::UnknownParent(parent_id.clone()))?
            }
        }
    };
    let Some(inverse) = parent_world.inverse() else {
        return Err(EditorReconciliationError::SingularParent { shape_id: shape_id.clone() });
    };
    decompose_transform(inverse.then(world.into()))
        .ok_or_else(|| EditorReconciliationError::UnsupportedShear { shape_id: shape_id.clone() })
}

fn same_affine(left: Affine, right: Affine) -> bool {
    [
        (left.a, right.a),
        (left.b, right.b),
        (left.c, right.c),
        (left.d, right.d),
        (left.e, right.e),
        (left.f, right.f),
    ]
    .into_iter()
    .all(|(left, right)| (left - right).abs() <= 1e-9 * (1.0 + left.abs().max(right.abs())))
}

fn layer_patch_changes(layer: &crate::LayerRecord, patch: &LayerPatch) -> bool {
    patch.name.as_ref().is_some_and(|name| name != &layer.name)
        || patch.visible.is_some_and(|visible| visible != layer.visible)
        || patch.locked.is_some_and(|locked| locked != layer.locked)
        || patch.opacity.is_some_and(|opacity| opacity != layer.opacity)
}

fn default_metadata(request: &EditorReconciliationRequest) -> SemanticMetadata {
    SemanticMetadata {
        name: None,
        title: None,
        role: None,
        description: None,
        body: None,
        tags: Vec::new(),
        source: None,
        link: None,
        custom_metadata: BTreeMap::new(),
        locked: false,
        agent_editable: true,
        provenance: Provenance {
            actor_id: request.actor_id.clone(),
            origin: request.origin.clone(),
            timestamp: request.timestamp,
            source: None,
        },
    }
}
