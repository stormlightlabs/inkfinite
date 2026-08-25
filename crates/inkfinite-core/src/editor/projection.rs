//! Canonical-to-editor projection and property-name conversion.

use std::collections::BTreeMap;

use crate::connector::resolve_arrow_geometry_for_shape;
use crate::engine::geometry::world_transform;
use crate::{CONTAINER_KIND, Document, DocumentSnapshot, ShapeId, ShapeProperties};

use super::{EditorBinding, EditorLayer, EditorOrder, EditorPage, EditorProjection, EditorShape};

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
