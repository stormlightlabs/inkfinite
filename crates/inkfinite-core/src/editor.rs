//! Projection and reconciliation between native documents and editor state.
//!
//! The editor works with a flat list of drawable shapes, while the canonical
//! document stores containers and parent-relative transforms. This module is
//! the shared boundary between those representations: projections expose
//! world-space transforms, and editor patches are converted back into minimal
//! native operations.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::engine::geometry::{Affine, world_transform};
use crate::proto::{LayerPatch, Operation, ShapePatch as NativeShapePatch, TransactionDraft, TransactionId};
use crate::{
    ActorId, BindingAnchor, BindingRecord, CONTAINER_KIND, ContainerLayout, Document, DocumentSnapshot, LayerId,
    Opacity, Origin, PageId, Provenance, RecordVersion, SemanticMetadata, ShapeId, ShapeKind, ShapeParent,
    ShapeProperties, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform, Vec2,
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

/// One drawable shape projected into the editor's flat shape collection.
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
    /// Agent editability retained for editor policy surfaces.
    pub agent_editable: bool,
    /// Kind-specific properties using editor property names.
    #[ts(type = "ShapeProperties")]
    pub props: ShapeProperties,
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
    /// Drawable shape IDs in depth-first draw order.
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
    /// Drawable shape IDs in depth-first draw order.
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
}

/// Ordering information accompanying an editor projection.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorOrder {
    /// Page IDs in document order.
    pub page_ids: Vec<PageId>,
    /// Flattened drawable shape order by page.
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
    /// Drawable shapes with composed world transforms.
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
    if shape.kind.as_str() != CONTAINER_KIND {
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
                agent_editable: shape.metadata.agent_editable,
                props: properties,
            },
        );
    }
    let child_group = if shape.kind.as_str() == CONTAINER_KIND { Some(shape.id.clone()) } else { group_id };
    for child_id in &shape.child_ids {
        append_projected_shape(document, page, layer, child_id, child_group.clone(), flattened, shapes);
    }
}

/// Converts editor properties back to canonical property names.
#[must_use]
pub fn native_properties(properties: &ShapeProperties) -> ShapeProperties {
    let mut result = properties.clone();
    if let Some(width) = result.remove("w") {
        result.insert("width".into(), width);
    }
    if let Some(height) = result.remove("h") {
        result.insert("height".into(), height);
    }
    result
}

fn editor_properties(properties: &ShapeProperties) -> ShapeProperties {
    let mut result = properties.clone();
    if let Some(width) = result.remove("width") {
        result.insert("w".into(), width);
    }
    if let Some(height) = result.remove("height") {
        result.insert("h".into(), height);
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
    let default_metadata = default_metadata(&request);

    for patch in request.patches {
        match patch {
            EditorPatch::Shape { shape_id, transform, properties, metadata, style, parent, anchor } => {
                reconcile_shape(
                    document,
                    shape_id,
                    transform,
                    properties,
                    metadata,
                    style,
                    parent.as_ref(),
                    anchor,
                    &mut operations,
                )?;
            }
            EditorPatch::CreateShape { shape, parent, transform, anchor } => {
                let local_transform = local_transform(document, &shape.id, &parent, transform)?;
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
                    operations.push(Operation::RenamePage { page_id, name, expected_version: Some(page.version) });
                }
            }
            EditorPatch::PatchLayer { layer_id, patch } => {
                let layer = document
                    .layers
                    .get(&layer_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownLayer(layer_id.clone()))?;
                if layer_patch_changes(layer, &patch) {
                    operations.push(Operation::PatchLayer { layer_id, patch, expected_version: Some(layer.version) });
                }
            }
            EditorPatch::ReorderLayer { layer_id, anchor } => {
                let layer = document
                    .layers
                    .get(&layer_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownLayer(layer_id.clone()))?;
                operations.push(Operation::ReorderLayer { layer_id, anchor, expected_version: Some(layer.version) });
            }
            EditorPatch::CreateBinding { binding } => operations.push(Operation::CreateBinding { binding }),
            EditorPatch::DeleteBinding { binding_id } => {
                let binding = document
                    .bindings
                    .get(&binding_id)
                    .ok_or_else(|| EditorReconciliationError::UnknownBinding(binding_id.clone()))?;
                operations.push(Operation::DeleteBinding { binding_id, expected_version: Some(binding.version) });
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

#[allow(clippy::too_many_arguments)]
fn reconcile_shape(
    document: &Document, shape_id: ShapeId, transform: Option<EditorTransform>, properties: Option<ShapeProperties>,
    metadata: Option<SemanticMetadata>, style: Option<ShapeStyle>, parent: Option<&ShapeParent>,
    anchor: Option<SiblingAnchor<ShapeId>>, operations: &mut Vec<Operation>,
) -> Result<(), EditorReconciliationError> {
    let shape = document
        .shapes
        .get(&shape_id)
        .ok_or_else(|| EditorReconciliationError::UnknownShape(shape_id.clone()))?;
    let target_parent = parent.cloned().unwrap_or_else(|| shape.parent.clone());
    let parent_changed = parent.is_some_and(|value| value != &shape.parent);
    let reorder = anchor.is_some();
    let mut shape_patch = NativeShapePatch::default();

    if let Some(world) = transform {
        let local = local_transform(document, &shape_id, &target_parent, world)?;
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
) -> Result<Transform, EditorReconciliationError> {
    let parent_world = match parent {
        ShapeParent::Layer(layer_id) => {
            if !document.layers.contains_key(layer_id) {
                return Err(EditorReconciliationError::UnknownLayer(layer_id.clone()));
            }
            Affine::IDENTITY
        }
        ShapeParent::Shape(parent_id) => {
            let parent_shape = document
                .shapes
                .get(parent_id)
                .ok_or_else(|| EditorReconciliationError::UnknownParent(parent_id.clone()))?;
            world_transform(document, parent_shape)
        }
    };
    let Some(inverse) = parent_world.inverse() else {
        return Err(EditorReconciliationError::SingularParent { shape_id: shape_id.clone() });
    };
    decompose_native_transform(inverse.then(world.into()), shape_id)
}

fn decompose_native_transform(matrix: Affine, shape_id: &ShapeId) -> Result<Transform, EditorReconciliationError> {
    let scale_x = matrix.a.hypot(matrix.b);
    if scale_x <= f64::EPSILON {
        return Err(EditorReconciliationError::UnsupportedShear { shape_id: shape_id.clone() });
    }
    let rotation = matrix.b.atan2(matrix.a);
    let scale_y = (matrix.a * matrix.d - matrix.b * matrix.c) / scale_x;
    let transform = Transform { translation: Vec2 { x: matrix.e, y: matrix.f }, rotation, scale_x, scale_y };
    let reconstructed = Affine::from_transform(transform);
    if !same_affine(reconstructed, matrix) {
        return Err(EditorReconciliationError::UnsupportedShear { shape_id: shape_id.clone() });
    }
    Ok(transform)
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
        role: None,
        description: None,
        tags: Vec::new(),
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
    use crate::{BindingId, BindingRecord, ChangeHash, DocumentId, RecordVersion, ShapeParent, blank_document};
    use serde_json::Value;

    fn metadata() -> SemanticMetadata {
        SemanticMetadata {
            name: None,
            role: None,
            description: None,
            tags: Vec::new(),
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
        assert_eq!(projection.shapes.len(), 1);
        assert_eq!(child.props["w"], Value::from(20.0));
        assert!(!child.props.contains_key("width"));
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
    fn projection_preserves_bindings_and_order() {
        let mut snapshot = nested_snapshot();
        let binding = BindingRecord {
            id: BindingId::from("binding:one"),
            kind: crate::BindingKind::from("arrow-end"),
            source_shape_id: ShapeId::from("shape:child"),
            target_shape_id: ShapeId::from("shape:child"),
            source_handle: "end".into(),
            anchor: BindingAnchor::Center,
            version: RecordVersion(1),
        };
        snapshot.document.bindings.insert(binding.id.clone(), binding);
        let projection = project_editor(&snapshot);
        assert_eq!(projection.order.page_ids, snapshot.document.page_ids);
        assert_eq!(projection.bindings[&BindingId::from("binding:one")].handle, "end");
    }
}
