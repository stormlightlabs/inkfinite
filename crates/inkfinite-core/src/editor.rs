//! Projection and reconciliation between native documents and editor state.
//!
//! The editor works with a flat depth-first shape list, while the canonical
//! document stores containers and parent-relative transforms. This module is
//! the shared boundary between those representations: projections expose
//! world-space transforms, and editor patches are converted back into minimal
//! native operations.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::boolean::{BooleanPathOperation, boolean_path_operation};
use crate::connector::{ResolvedArrowGeometry, resolve_arrow_geometry_for_shape};
use crate::engine::geometry::{Affine, decompose_transform, parent_world_transform, world_transform};
use crate::path::{PathTopologyOperation, apply_path_topology_operations};
use crate::proto::{
    LayerContentsDisposition, LayerPatch, Operation, ShapePatch as NativeShapePatch, TransactionDraft, TransactionId,
};
use crate::{
    ActorId, AssetRecord, BindingAnchor, BindingRecord, CONTAINER_KIND, ContainerLayout, Document, DocumentSnapshot,
    LayerId, LayerRecord, Opacity, Origin, PageId, PageRecord, PathGeometry, PathSegment, PathSubpath, Provenance,
    RecordVersion, SemanticMetadata, ShapeId, ShapeKind, ShapeParent, ShapeProperties, ShapeRecord, ShapeStyle,
    SiblingAnchor, Timestamp, Transform,
};

/// Full affine transform used by the editor projection.
///
/// Unlike the canonical [`Transform`], this representation can retain the
/// result of composing ancestor transforms even when the composition includes
/// non-uniform scale and rotation.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorTransform {
    /// Horizontal scale and rotation component.
    pub a: f64,
    /// Vertical shear and rotation component.
    pub b: f64,
    /// Horizontal shear and rotation component.
    pub c: f64,
    /// Vertical scale and rotation component.
    pub d: f64,
    /// Horizontal translation.
    pub e: f64,
    /// Vertical translation.
    pub f: f64,
}

impl From<Affine> for EditorTransform {
    fn from(value: Affine) -> Self {
        Self { a: value.a, b: value.b, c: value.c, d: value.d, e: value.e, f: value.f }
    }
}

impl From<EditorTransform> for Affine {
    fn from(value: EditorTransform) -> Self {
        Self { a: value.a, b: value.b, c: value.c, d: value.d, e: value.e, f: value.f }
    }
}

/// One shape projected into the editor's flat depth-first shape collection.
///
/// Containers are included so the editor can select them as one object and
/// enter their child scope. They have no direct drawing primitive; their
/// descendants remain in the same depth-first order.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorShape {
    /// Stable shape identifier.
    pub id: ShapeId,
    /// Editor registry key.
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub kind: ShapeKind,
    /// Page containing the shape.
    pub page_id: PageId,
    /// Complete native-to-world transform.
    pub transform: EditorTransform,
    /// Legacy translation fields used by the current editor interaction model.
    pub x: f64,
    /// Legacy translation field used by the current editor interaction model.
    pub y: f64,
    /// Legacy rotation field used by the current editor interaction model.
    pub rot: f64,
    /// Immediate container parent, when the shape is inside a container.
    pub group_id: Option<ShapeId>,
    /// Owning editor layer.
    pub layer_id: LayerId,
    /// Complete-shape opacity.
    pub opacity: Opacity,
    /// Optional fill opacity.
    pub fill_opacity: Option<Opacity>,
    /// Optional stroke opacity.
    pub stroke_opacity: Option<Opacity>,
    /// Whether this shape and its descendants can be edited.
    pub locked: bool,
    /// Agent editability retained for editor policy surfaces.
    pub agent_editable: bool,
    /// Semantic fields exposed to card and inspector controls.
    pub metadata: SemanticMetadata,
    /// Kind-specific properties using editor property names.
    #[ts(type = "ShapeProperties")]
    pub props: ShapeProperties,
    /// Rust-resolved arrow geometry for interactive consumers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_geometry: Option<ResolvedArrowGeometry>,
}

/// A new shape supplied by an editor patch.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorShapeDraft {
    /// Stable shape identifier.
    pub id: ShapeId,
    /// Native registry key.
    pub kind: ShapeKind,
    /// Kind-specific properties using editor property names.
    #[ts(type = "ShapeProperties")]
    pub properties: ShapeProperties,
    /// Optional semantic metadata. Missing metadata receives editor defaults.
    pub metadata: Option<SemanticMetadata>,
    /// Common visual style.
    pub style: ShapeStyle,
    /// Optional container layout.
    pub layout: Option<ContainerLayout>,
}

/// Page represented in the flat editor document.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorPage {
    /// Stable page identifier.
    pub id: PageId,
    /// User-visible page name.
    pub name: String,
    /// Shape IDs in depth-first draw order, including containers.
    pub shape_ids: Vec<ShapeId>,
    /// Layer IDs in back-to-front order.
    pub layer_ids: Vec<LayerId>,
}

/// Layer represented in the flat editor document.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorLayer {
    /// Stable layer identifier.
    pub id: LayerId,
    /// Owning page identifier.
    pub page_id: PageId,
    /// User-visible layer name.
    pub name: String,
    /// Shape IDs in depth-first draw order, including containers.
    pub shape_ids: Vec<ShapeId>,
    /// Whether the layer participates in rendering.
    pub visible: bool,
    /// Whether the layer can be selected or changed.
    pub locked: bool,
    /// Inherited layer opacity.
    pub opacity: Opacity,
}

/// Binding represented in the editor's binding collection.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorBinding {
    /// Stable binding identifier.
    pub id: crate::BindingId,
    /// Editor binding kind.
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub kind: crate::BindingKind,
    /// Source arrow or connector.
    pub from_shape_id: ShapeId,
    /// Target shape.
    pub to_shape_id: ShapeId,
    /// Source handle.
    pub handle: String,
    /// Target anchor.
    pub anchor: BindingAnchor,
    /// Optional semantic relationship type.
    pub relation_type: Option<String>,
}

/// Ordering information accompanying an editor projection.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorOrder {
    /// Page IDs in document order.
    pub page_ids: Vec<PageId>,
    /// Flattened depth-first shape order by page.
    pub shape_order: BTreeMap<PageId, Vec<ShapeId>>,
    /// Layer records in their projected form.
    pub layers: BTreeMap<LayerId, EditorLayer>,
}

/// Native document projected into the editor's flat document shape.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorProjection {
    /// Projected pages.
    pub pages: BTreeMap<PageId, EditorPage>,
    /// Projected layers.
    pub layers: BTreeMap<LayerId, EditorLayer>,
    /// Shapes with composed world transforms, including containers.
    pub shapes: BTreeMap<ShapeId, EditorShape>,
    /// Projected bindings.
    pub bindings: BTreeMap<crate::BindingId, EditorBinding>,
    /// Stable ordering metadata.
    pub order: EditorOrder,
}

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

/// Projects a canonical document into the shared flat editor representation.
#[must_use]
pub fn project_editor(snapshot: &DocumentSnapshot) -> EditorProjection {
    let document = &snapshot.document;
    let mut pages = BTreeMap::new();
    let mut layers = BTreeMap::new();
    let mut shapes = BTreeMap::new();
    let mut shape_order = BTreeMap::new();

    for page_id in &document.page_ids {
        let Some(page) = document.pages.get(page_id) else { continue };
        let mut flattened = Vec::new();
        for layer_id in &page.layer_ids {
            let Some(layer) = document.layers.get(layer_id) else { continue };
            let mut layer_shapes = Vec::new();
            for shape_id in &layer.shape_ids {
                append_projected_shape(document, page, layer, shape_id, None, &mut layer_shapes, &mut shapes);
            }
            flattened.extend(layer_shapes.iter().cloned());
            layers.insert(
                layer.id.clone(),
                EditorLayer {
                    id: layer.id.clone(),
                    page_id: layer.page_id.clone(),
                    name: layer.name.clone(),
                    shape_ids: layer_shapes,
                    visible: layer.visible,
                    locked: layer.locked,
                    opacity: layer.opacity,
                },
            );
        }
        shape_order.insert(page.id.clone(), flattened.clone());
        pages.insert(
            page.id.clone(),
            EditorPage {
                id: page.id.clone(),
                name: page.name.clone(),
                shape_ids: flattened,
                layer_ids: page.layer_ids.clone(),
            },
        );
    }

    let bindings = document
        .bindings
        .values()
        .map(|binding| {
            (
                binding.id.clone(),
                EditorBinding {
                    id: binding.id.clone(),
                    kind: binding.kind.clone(),
                    from_shape_id: binding.source_shape_id.clone(),
                    to_shape_id: binding.target_shape_id.clone(),
                    handle: binding.source_handle.clone(),
                    anchor: binding.anchor,
                    relation_type: binding.relation_type.clone(),
                },
            )
        })
        .collect();

    EditorProjection {
        pages,
        layers: layers.clone(),
        shapes,
        bindings,
        order: EditorOrder { page_ids: document.page_ids.clone(), shape_order, layers },
    }
}

fn append_projected_shape(
    document: &Document, page: &crate::PageRecord, layer: &crate::LayerRecord, shape_id: &ShapeId,
    group_id: Option<ShapeId>, flattened: &mut Vec<ShapeId>, shapes: &mut BTreeMap<ShapeId, EditorShape>,
) {
    let Some(shape) = document.shapes.get(shape_id) else { return };
    flattened.push(shape.id.clone());
    let world = world_transform(document, shape);
    let properties = editor_properties(&shape.properties);
    shapes.insert(
        shape.id.clone(),
        EditorShape {
            id: shape.id.clone(),
            kind: shape.kind.clone(),
            page_id: page.id.clone(),
            transform: world.into(),
            x: world.e,
            y: world.f,
            rot: world.b.atan2(world.a),
            group_id: group_id.clone(),
            layer_id: layer.id.clone(),
            opacity: shape.style.opacity,
            fill_opacity: shape.style.fill_opacity,
            stroke_opacity: shape.style.stroke_opacity,
            locked: shape.metadata.locked,
            agent_editable: shape.metadata.agent_editable,
            metadata: shape.metadata.clone(),
            props: properties,
            resolved_geometry: (shape.kind.as_str() == crate::ARROW_KIND)
                .then(|| resolve_arrow_geometry_for_shape(document, shape).ok())
                .flatten(),
        },
    );
    let child_group = if shape.kind.as_str() == CONTAINER_KIND { Some(shape.id.clone()) } else { group_id };
    for child_id in &shape.child_ids {
        append_projected_shape(document, page, layer, child_id, child_group.clone(), flattened, shapes);
    }
}

/// Converts editor properties back to canonical property names.
#[must_use]
pub fn native_properties(properties: &ShapeProperties) -> ShapeProperties {
    let mut result = properties.clone();
    for (editor, native) in [
        ("w", "width"),
        ("h", "height"),
        ("md", "markdown"),
        ("bg", "background"),
        ("fontSize", "font_size"),
        ("fontFamily", "font_family"),
        ("assetId", "asset_id"),
        ("referenceType", "reference_type"),
        ("textPath", "text_path"),
    ] {
        if let Some(value) = result.remove(editor) {
            result.entry(native.into()).or_insert(value);
        }
    }
    result
}

fn editor_properties(properties: &ShapeProperties) -> ShapeProperties {
    let mut result = properties.clone();
    for (native, editor) in [
        ("width", "w"),
        ("height", "h"),
        ("markdown", "md"),
        ("background", "bg"),
        ("font_size", "fontSize"),
        ("font_family", "fontFamily"),
        ("asset_id", "assetId"),
        ("reference_type", "referenceType"),
        ("text_path", "textPath"),
    ] {
        if let Some(value) = result.remove(native) {
            result.entry(editor.into()).or_insert(value);
        }
    }
    result
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BindingId, BindingRecord, ChangeHash, DocumentId, RecordVersion, ShapeParent, Vec2, blank_document};
    use serde_json::Value;

    fn metadata() -> SemanticMetadata {
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
                actor_id: ActorId::from("actor:test"),
                origin: Origin::Human,
                timestamp: Timestamp(0),
                source: None,
            },
        }
    }

    fn style() -> ShapeStyle {
        ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None }
    }

    fn nested_snapshot() -> DocumentSnapshot {
        let document_id = DocumentId::from("document:editor");
        let mut document = blank_document(&document_id, None);
        let page_id = document.page_ids[0].clone();
        let layer_id = document.pages[&page_id].layer_ids[0].clone();
        let root_id = ShapeId::from("shape:root");
        let group_id = ShapeId::from("shape:group");
        let child_id = ShapeId::from("shape:child");
        document.layers.get_mut(&layer_id).unwrap().shape_ids = vec![root_id.clone()];
        document.shapes.insert(
            root_id.clone(),
            ShapeRecord {
                id: root_id.clone(),
                kind: ShapeKind::from(CONTAINER_KIND),
                parent: ShapeParent::Layer(layer_id.clone()),
                transform: Transform {
                    translation: Vec2 { x: 100.0, y: 50.0 },
                    rotation: 0.3,
                    scale_x: 2.0,
                    scale_y: 2.0,
                },
                child_ids: vec![group_id.clone()],
                layout: Some(ContainerLayout::Free),
                properties: BTreeMap::new(),
                metadata: metadata(),
                style: style(),
                version: RecordVersion(1),
            },
        );
        document.shapes.insert(
            group_id.clone(),
            ShapeRecord {
                id: group_id.clone(),
                kind: ShapeKind::from(CONTAINER_KIND),
                parent: ShapeParent::Shape(root_id),
                transform: Transform {
                    translation: Vec2 { x: 10.0, y: 20.0 },
                    rotation: -0.2,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                child_ids: vec![child_id.clone()],
                layout: Some(ContainerLayout::Free),
                properties: BTreeMap::new(),
                metadata: metadata(),
                style: style(),
                version: RecordVersion(1),
            },
        );
        document.shapes.insert(
            child_id.clone(),
            ShapeRecord {
                id: child_id,
                kind: ShapeKind::from("rect"),
                parent: ShapeParent::Shape(group_id),
                transform: Transform {
                    translation: Vec2 { x: 4.0, y: 8.0 },
                    rotation: 0.1,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                child_ids: Vec::new(),
                layout: None,
                properties: BTreeMap::from([
                    ("width".into(), Value::from(20.0)),
                    ("height".into(), Value::from(10.0)),
                ]),
                metadata: metadata(),
                style: style(),
                version: RecordVersion(1),
            },
        );
        DocumentSnapshot {
            format: crate::FormatId::from(crate::INKFINITE_FORMAT_ID),
            format_version: crate::INKFINITE_FORMAT_VERSION,
            document_id,
            heads: vec![ChangeHash::from("head:one")],
            document,
        }
    }

    fn request(patches: Vec<EditorPatch>) -> EditorReconciliationRequest {
        EditorReconciliationRequest {
            patches,
            actor_id: ActorId::from("actor:test"),
            origin: Origin::Human,
            transaction_id: TransactionId("transaction:editor".into()),
            description: "Editor change".into(),
            timestamp: Timestamp(1),
        }
    }

    #[test]
    fn projection_composes_ancestor_transforms_and_flattens_containers() {
        let snapshot = nested_snapshot();
        let projection = project_editor(&snapshot);
        let child = &projection.shapes[&ShapeId::from("shape:child")];
        let expected = world_transform(
            &snapshot.document,
            &snapshot.document.shapes[&ShapeId::from("shape:child")],
        );
        let actual: Affine = child.transform.into();
        assert!(same_affine(actual, expected));
        assert_eq!(child.group_id, Some(ShapeId::from("shape:group")));
        assert_eq!(projection.shapes.len(), 3);
        assert_eq!(child.props["w"], Value::from(20.0));
        assert!(!child.props.contains_key("width"));
    }

    #[test]
    fn projection_translates_native_property_names_for_editor_clients() {
        let mut snapshot = nested_snapshot();
        let child = snapshot
            .document
            .shapes
            .get_mut(&ShapeId::from("shape:child"))
            .expect("child fixture");
        child.properties.extend([
            ("markdown".into(), Value::from("# Notes")),
            ("background".into(), Value::from("#ffffff")),
            ("font_size".into(), Value::from(16.0)),
            ("font_family".into(), Value::from("sans-serif")),
            ("asset_id".into(), Value::from("asset:one")),
            ("reference_type".into(), Value::from("url")),
        ]);
        let native = child.properties.clone();

        let projection = project_editor(&snapshot);
        let props = &projection.shapes[&ShapeId::from("shape:child")].props;
        for editor_name in [
            "w",
            "h",
            "md",
            "bg",
            "fontSize",
            "fontFamily",
            "assetId",
            "referenceType",
        ] {
            assert!(props.contains_key(editor_name), "missing {editor_name}");
        }
        assert_eq!(native_properties(props), native);
    }

    #[test]
    fn projection_preserves_semantic_metadata() {
        let mut snapshot = nested_snapshot();
        let child_id = ShapeId::from("shape:child");
        let child = snapshot.document.shapes.get_mut(&child_id).expect("child fixture");
        child.metadata.name = Some("Gateway".into());
        child.metadata.role = Some("architecture.service".into());
        child.metadata.description = Some("Routes requests".into());
        child.metadata.tags = vec!["api".into(), "critical".into()];
        child.metadata.source = Some("architecture.md".into());
        child
            .metadata
            .custom_metadata
            .insert("owner".into(), Value::from("platform"));
        child.metadata.provenance.source = Some("seed".into());

        let projected = project_editor(&snapshot).shapes[&child_id].metadata.clone();
        assert_eq!(projected.name.as_deref(), Some("Gateway"));
        assert_eq!(projected.role.as_deref(), Some("architecture.service"));
        assert_eq!(projected.description.as_deref(), Some("Routes requests"));
        assert_eq!(projected.tags, ["api", "critical"]);
        assert_eq!(projected.source.as_deref(), Some("architecture.md"));
        assert_eq!(projected.custom_metadata["owner"], Value::from("platform"));
        assert_eq!(projected.provenance.source.as_deref(), Some("seed"));
    }

    #[test]
    fn reconciliation_emits_one_relative_patch_for_a_world_move() {
        let snapshot = nested_snapshot();
        let projection = project_editor(&snapshot);
        let child_id = ShapeId::from("shape:child");
        let mut moved: Affine = projection.shapes[&child_id].transform.into();
        moved.e += 5.0;
        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![EditorPatch::Shape {
                shape_id: child_id.clone(),
                transform: Some(moved.into()),
                properties: None,
                metadata: None,
                style: None,
                parent: None,
                anchor: None,
            }]),
        )
        .expect("world move should reconcile");
        assert_eq!(transaction.base_heads, snapshot.heads);
        assert_eq!(transaction.operations.len(), 1);
        let Operation::PatchShape { shape_id, patch, expected_version } = &transaction.operations[0] else {
            panic!("expected a shape patch")
        };
        assert_eq!(shape_id, &child_id);
        assert_eq!(expected_version, &Some(RecordVersion(1)));
        let local = patch.transform.expect("transform patch");
        let parent = world_transform(
            &snapshot.document,
            &snapshot.document.shapes[&ShapeId::from("shape:group")],
        );
        let expected = parent
            .inverse()
            .expect("parent is invertible")
            .point(Vec2 { x: moved.e, y: moved.f });
        assert!((local.translation.x - expected.x).abs() < 1e-9);
        assert!((local.translation.y - expected.y).abs() < 1e-9);
    }

    #[test]
    fn reconciliation_routes_path_topology_through_canonical_geometry() {
        let mut snapshot = nested_snapshot();
        let path_id = ShapeId::from("shape:child");
        let path = snapshot.document.shapes.get_mut(&path_id).unwrap();
        path.kind = ShapeKind::from(crate::PATH_KIND);
        path.properties = BTreeMap::from([
            (
                "subpaths".into(),
                serde_json::json!([{
                    "segments": [
                        { "type": "move", "to": { "x": 0.0, "y": 0.0 } },
                        { "type": "line", "to": { "x": 40.0, "y": 0.0 } },
                        { "type": "line", "to": { "x": 40.0, "y": 40.0 } }
                    ],
                    "closed": false
                }]),
            ),
            ("fill_rule".into(), serde_json::json!("nonzero")),
        ]);

        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![EditorPatch::PathTopology {
                shape_id: path_id.clone(),
                operations: vec![PathTopologyOperation::AddAnchor { subpath_index: 0, segment_index: 1, t: 0.5 }],
            }]),
        )
        .expect("path topology should reconcile");

        assert_eq!(transaction.operations.len(), 1);
        let Operation::PatchShape { shape_id, patch, .. } = &transaction.operations[0] else {
            panic!("expected a path property patch")
        };
        assert_eq!(shape_id, &path_id);
        let properties = patch.properties.as_ref().expect("topology should replace properties");
        let segments = properties["subpaths"][0]["segments"].as_array().expect("segments");
        assert_eq!(segments.len(), 4);
        assert_eq!(segments[1]["to"], serde_json::json!({ "x": 20.0, "y": 0.0 }));
    }

    #[test]
    fn reconciliation_combines_transformed_paths_and_deletes_the_other_inputs() {
        let mut snapshot = nested_snapshot();
        let path_id = ShapeId::from("shape:child");
        let parent_id = ShapeId::from("shape:group");
        let path_properties = BTreeMap::from([
            (
                "subpaths".into(),
                serde_json::json!([{
                    "segments": [
                        { "type": "move", "to": { "x": 0.0, "y": 0.0 } },
                        { "type": "line", "to": { "x": 30.0, "y": 0.0 } },
                        { "type": "line", "to": { "x": 30.0, "y": 30.0 } },
                        { "type": "line", "to": { "x": 0.0, "y": 30.0 } }
                    ],
                    "closed": true
                }]),
            ),
            ("fill_rule".into(), serde_json::json!("evenodd")),
        ]);
        snapshot.document.shapes.get_mut(&path_id).unwrap().kind = ShapeKind::from(crate::PATH_KIND);
        snapshot.document.shapes.get_mut(&path_id).unwrap().properties = path_properties;
        let second_id = ShapeId::from("shape:second-path");
        let mut second = snapshot.document.shapes[&path_id].clone();
        second.id = second_id.clone();
        second.parent = ShapeParent::Shape(parent_id.clone());
        second.transform.translation.x += 12.0;
        second.version = RecordVersion(1);
        snapshot.document.shapes.insert(second_id.clone(), second);
        snapshot
            .document
            .shapes
            .get_mut(&parent_id)
            .unwrap()
            .child_ids
            .push(second_id.clone());
        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![EditorPatch::BooleanPaths {
                shape_ids: vec![path_id, second_id],
                operation: BooleanPathOperation::Union,
            }]),
        )
        .expect("boolean paths should reconcile");

        assert_eq!(transaction.operations.len(), 2);
        assert!(matches!(transaction.operations[0], Operation::PatchShape { .. }));
        assert!(matches!(transaction.operations[1], Operation::DeleteShape { .. }));
    }

    #[test]
    fn reconciliation_reparents_without_changing_a_world_transform() {
        let snapshot = nested_snapshot();
        let child_id = ShapeId::from("shape:child");
        let root_id = ShapeId::from("shape:root");
        let before = world_transform(&snapshot.document, &snapshot.document.shapes[&child_id]);
        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![EditorPatch::Shape {
                shape_id: child_id,
                transform: None,
                properties: None,
                metadata: None,
                style: None,
                parent: Some(ShapeParent::Shape(root_id.clone())),
                anchor: Some(SiblingAnchor::Last),
            }]),
        )
        .expect("reparent should reconcile");

        assert_eq!(transaction.operations.len(), 1);
        assert!(matches!(transaction.operations[0], Operation::ReparentShape { .. }));
        let Operation::ReparentShape { parent, .. } = &transaction.operations[0] else {
            panic!("expected reparent operation")
        };
        assert_eq!(parent, &ShapeParent::Shape(root_id.clone()));
        let local = crate::engine::geometry::local_transform_from_world(&snapshot.document, parent, before)
            .expect("target parent should represent the world transform");
        let target_world = world_transform(&snapshot.document, &snapshot.document.shapes[&root_id]);
        assert!(same_affine(
            target_world.then(crate::engine::geometry::Affine::from_transform(local)),
            before
        ));
    }

    #[test]
    fn reconciliation_omits_no_op_changes() {
        let snapshot = nested_snapshot();
        let projection = project_editor(&snapshot);
        let child = &projection.shapes[&ShapeId::from("shape:child")];
        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![EditorPatch::Shape {
                shape_id: child.id.clone(),
                transform: Some(child.transform),
                properties: Some(child.props.clone()),
                metadata: None,
                style: Some(style()),
                parent: None,
                anchor: None,
            }]),
        )
        .expect("no-op should reconcile");
        assert!(transaction.operations.is_empty());
    }

    #[test]
    fn reconciliation_accepts_shapes_in_new_layers() {
        let snapshot = nested_snapshot();
        let page_id = snapshot.document.page_ids[0].clone();
        let layer_id = LayerId::from("layer:new");
        let shape_id = ShapeId::from("shape:new");
        let layer = LayerRecord {
            id: layer_id.clone(),
            page_id,
            name: "New layer".into(),
            shape_ids: Vec::new(),
            visible: true,
            locked: false,
            opacity: Opacity::OPAQUE,
            version: RecordVersion(1),
        };
        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![
                EditorPatch::CreateLayer { layer, anchor: SiblingAnchor::Last },
                EditorPatch::CreateShape {
                    shape: EditorShapeDraft {
                        id: shape_id,
                        kind: ShapeKind::from("rect"),
                        properties: BTreeMap::from([
                            ("width".into(), Value::from(20.0)),
                            ("height".into(), Value::from(10.0)),
                        ]),
                        metadata: None,
                        style: style(),
                        layout: None,
                    },
                    parent: ShapeParent::Layer(layer_id),
                    transform: EditorTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 25.0, f: 30.0 },
                    anchor: SiblingAnchor::Last,
                },
            ]),
        )
        .expect("a new layer can receive a shape in the same editor change");

        assert_eq!(transaction.operations.len(), 2);
        assert!(matches!(transaction.operations[0], Operation::CreateLayer { .. }));
        assert!(matches!(transaction.operations[1], Operation::CreateShape { .. }));
    }

    #[test]
    fn reconciliation_accepts_children_created_with_their_container() {
        let snapshot = nested_snapshot();
        let page_id = snapshot.document.page_ids[0].clone();
        let layer_id = snapshot.document.pages[&page_id].layer_ids[0].clone();
        let container_id = ShapeId::from("shape:card");
        let child_id = ShapeId::from("shape:card-title");
        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![
                EditorPatch::CreateShape {
                    shape: EditorShapeDraft {
                        id: container_id.clone(),
                        kind: ShapeKind::from(CONTAINER_KIND),
                        properties: BTreeMap::from([
                            ("w".into(), Value::from(320.0)),
                            ("h".into(), Value::from(220.0)),
                        ]),
                        metadata: Some(metadata()),
                        style: style(),
                        layout: Some(ContainerLayout::Free),
                    },
                    parent: ShapeParent::Layer(layer_id),
                    transform: EditorTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 10.0, f: 20.0 },
                    anchor: SiblingAnchor::Last,
                },
                EditorPatch::CreateShape {
                    shape: EditorShapeDraft {
                        id: child_id,
                        kind: ShapeKind::from("text"),
                        properties: BTreeMap::from([
                            ("text".into(), Value::from("Card")),
                            ("fontSize".into(), Value::from(18.0)),
                            ("fontFamily".into(), Value::from("sans-serif")),
                            ("color".into(), Value::from("#111827")),
                            ("w".into(), Value::from(288.0)),
                        ]),
                        metadata: None,
                        style: style(),
                        layout: None,
                    },
                    parent: ShapeParent::Shape(container_id),
                    transform: EditorTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 26.0, f: 36.0 },
                    anchor: SiblingAnchor::Last,
                },
            ]),
        )
        .expect("a card child can be created with its new container");

        assert_eq!(transaction.operations.len(), 2);
        assert!(matches!(transaction.operations[0], Operation::CreateShape { .. }));
        assert!(matches!(transaction.operations[1], Operation::CreateShape { .. }));
    }

    #[test]
    fn reconciliation_allows_layer_patch_and_reorder_in_one_change() {
        let mut snapshot = nested_snapshot();
        let page_id = snapshot.document.page_ids[0].clone();
        let layer_id = LayerId::from("layer:second");
        snapshot
            .document
            .pages
            .get_mut(&page_id)
            .unwrap()
            .layer_ids
            .push(layer_id.clone());
        snapshot.document.layers.insert(
            layer_id.clone(),
            LayerRecord {
                id: layer_id.clone(),
                page_id: page_id.clone(),
                name: "Second".into(),
                shape_ids: Vec::new(),
                visible: true,
                locked: false,
                opacity: Opacity::OPAQUE,
                version: RecordVersion(1),
            },
        );

        let transaction = reconcile_editor_patches(
            &snapshot,
            request(vec![
                EditorPatch::PatchLayer {
                    layer_id: layer_id.clone(),
                    patch: LayerPatch { name: Some("Renamed".into()), visible: None, locked: None, opacity: None },
                },
                EditorPatch::ReorderLayer { layer_id: layer_id.clone(), anchor: SiblingAnchor::First },
                EditorPatch::RenamePage { page_id, name: "Renamed page".into() },
            ]),
        )
        .expect("layer fields and order should reconcile together");

        assert_eq!(transaction.operations.len(), 3);
        let Operation::PatchLayer { expected_version, .. } = &transaction.operations[0] else {
            panic!("expected a layer patch")
        };
        assert_eq!(*expected_version, Some(RecordVersion(1)));
        let Operation::ReorderLayer { layer_id: reordered, expected_version, .. } = &transaction.operations[1] else {
            panic!("expected a layer reorder")
        };
        assert_eq!(reordered, &layer_id);
        assert_eq!(*expected_version, None);
        let Operation::RenamePage { expected_version, .. } = &transaction.operations[2] else {
            panic!("expected a page rename")
        };
        assert_eq!(*expected_version, None);
    }

    #[test]
    fn projection_preserves_bindings_and_order() {
        let mut snapshot = nested_snapshot();
        let binding = BindingRecord {
            id: BindingId::from("binding:one"),
            kind: crate::BindingKind::from("arrow-end"),
            source_shape_id: ShapeId::from("shape:child"),
            target_shape_id: ShapeId::from("shape:child"),
            source_handle: "end".into(),
            anchor: BindingAnchor::Center,
            relation_type: Some("depends_on".into()),
            version: RecordVersion(1),
        };
        snapshot.document.bindings.insert(binding.id.clone(), binding);
        let projection = project_editor(&snapshot);
        assert_eq!(projection.order.page_ids, snapshot.document.page_ids);
        assert_eq!(projection.bindings[&BindingId::from("binding:one")].handle, "end");
        assert_eq!(
            projection.bindings[&BindingId::from("binding:one")]
                .relation_type
                .as_deref(),
            Some("depends_on")
        );
    }
}
