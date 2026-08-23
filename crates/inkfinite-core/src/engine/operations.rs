use super::geometry::{
    bottom, center_x, center_y, count_as_f64, decompose_transform, parent_world_transform, right, world_shape_bounds,
    world_transform,
};
use super::hierarchy::{
    anchor_for, asset, asset_is_referenced, asset_mut, binding, bindings_touching, containing_layer,
    descendant_ids_for_layer, descendant_ids_for_shape, ensure_absent, ensure_version_one, insert_anchored,
    insert_shape_child, is_descendant, layer, layer_mut, move_anchored, next_version, page, page_mut,
    remove_shape_child, shape, shape_mut, shape_siblings,
};
use super::validation::{ensure_binding_endpoints, ensure_relationship_reference};
use super::{
    AssetId, AssetPatch, BTreeMap, BTreeSet, Bounds, Document, EngineError, LayerContentsDisposition, LayerId,
    LayerPatch, LayoutAxis, Operation, PageId, RecordVersion, ShapeAlignment, ShapeId, ShapeParent, ShapePatch,
    ShapeProperties, SiblingAnchor, normalize_shape_properties,
};
use crate::ARROW_KIND;
use crate::graph_layout::GraphLayoutOptions;
use crate::graph_layout::{GraphLayoutEdge, GraphLayoutGraph, GraphLayoutNode, layout_graph};

#[allow(clippy::too_many_lines)]
pub fn apply_operation(document: &mut Document, operation: &Operation) -> Result<Vec<Operation>, EngineError> {
    match operation {
        Operation::CreatePage { page, anchor } => {
            ensure_absent(document.pages.contains_key(&page.id), "page", &page.id)?;
            ensure_version_one(page.version, "new page")?;
            if !page.layer_ids.is_empty() {
                return Err(EngineError::Schema(
                    "new page layer_ids must be empty; create layers separately".into(),
                ));
            }
            insert_anchored(&mut document.page_ids, page.id.clone(), anchor)?;
            document.pages.insert(page.id.clone(), page.clone());
            Ok(vec![Operation::DeletePage {
                page_id: page.id.clone(),
                expected_version: Some(page.version),
            }])
        }
        Operation::RenamePage { page_id, name, expected_version } => {
            if name.trim().is_empty() {
                return Err(EngineError::Schema("page name is empty".into()));
            }
            let page = page_mut(document, page_id, *expected_version)?;
            let old = page.name.clone();
            page.name.clone_from(name);
            page.version = next_version(page.version)?;
            Ok(vec![Operation::RenamePage {
                page_id: page_id.clone(),
                name: old,
                expected_version: Some(page.version),
            }])
        }
        Operation::DeletePage { page_id, expected_version } => delete_page(document, page_id, *expected_version),
        Operation::CreateLayer { layer, anchor } => {
            ensure_absent(document.layers.contains_key(&layer.id), "layer", &layer.id)?;
            ensure_version_one(layer.version, "new layer")?;
            if !layer.shape_ids.is_empty() {
                return Err(EngineError::Schema(
                    "new layer shape_ids must be empty; create or reparent shapes separately".into(),
                ));
            }
            let page = page_mut(document, &layer.page_id, None)?;
            insert_anchored(&mut page.layer_ids, layer.id.clone(), anchor)?;
            page.version = next_version(page.version)?;
            document.layers.insert(layer.id.clone(), layer.clone());
            Ok(vec![Operation::DeleteLayer {
                layer_id: layer.id.clone(),
                contents: LayerContentsDisposition::Delete,
                expected_version: Some(layer.version),
            }])
        }
        Operation::PatchLayer { layer_id, patch, expected_version } => {
            patch_layer(document, layer_id, patch, *expected_version)
        }
        Operation::ReorderLayer { layer_id, anchor, expected_version } => {
            reorder_layer(document, layer_id, anchor, *expected_version)
        }
        Operation::DeleteLayer { layer_id, contents, expected_version } => {
            delete_layer(document, layer_id, contents, *expected_version)
        }
        Operation::CreateShape { shape, anchor } => {
            ensure_absent(document.shapes.contains_key(&shape.id), "shape", &shape.id)?;
            ensure_version_one(shape.version, "new shape")?;
            if !shape.child_ids.is_empty() {
                return Err(EngineError::Schema(
                    "new shape child_ids must be empty; create children separately".into(),
                ));
            }
            let mut canonical_shape = shape.clone();
            canonical_shape.properties = normalize_shape_properties(shape.kind.as_str(), &shape.properties)
                .map_err(|error| EngineError::Schema(format!("shape {}: {error}", shape.id)))?;
            insert_shape_child(document, &canonical_shape.parent, canonical_shape.id.clone(), anchor)?;
            document.shapes.insert(canonical_shape.id.clone(), canonical_shape);
            Ok(vec![Operation::DeleteShape {
                shape_id: shape.id.clone(),
                expected_version: Some(shape.version),
            }])
        }
        Operation::PatchShape { shape_id, patch, expected_version } => {
            patch_shape(document, shape_id, patch, *expected_version)
        }
        Operation::ConvertShape { shape_id, kind, properties, style, expected_version } => {
            convert_shape(document, shape_id, kind, properties, *style, *expected_version)
        }
        Operation::ReparentShape { shape_id, parent, anchor, expected_version } => {
            reparent_shape(document, shape_id, parent, anchor, *expected_version)
        }
        Operation::DeleteShape { shape_id, expected_version } => delete_shape(document, shape_id, *expected_version),
        Operation::CreateBinding { binding } => {
            ensure_absent(document.bindings.contains_key(&binding.id), "binding", &binding.id)?;
            ensure_version_one(binding.version, "new binding")?;
            ensure_relationship_reference(document, binding)?;
            ensure_binding_endpoints(document, binding)?;
            document.bindings.insert(binding.id.clone(), binding.clone());
            Ok(vec![Operation::DeleteBinding {
                binding_id: binding.id.clone(),
                expected_version: Some(binding.version),
            }])
        }
        Operation::DeleteBinding { binding_id, expected_version } => {
            let binding = crate::BindingRecord {
                version: RecordVersion(1),
                ..binding(document, binding_id, *expected_version)?.clone()
            };
            document.bindings.remove(binding_id);
            Ok(vec![Operation::CreateBinding { binding }])
        }
        Operation::CreateAsset { asset } => {
            ensure_absent(document.assets.contains_key(&asset.id), "asset", &asset.id)?;
            ensure_version_one(asset.version, "new asset")?;
            document.assets.insert(asset.id.clone(), asset.clone());
            Ok(vec![Operation::DeleteAsset {
                asset_id: asset.id.clone(),
                expected_version: Some(asset.version),
            }])
        }
        Operation::PatchAsset { asset_id, patch, expected_version } => {
            patch_asset(document, asset_id, patch, *expected_version)
        }
        Operation::DeleteAsset { asset_id, expected_version } => {
            let asset = crate::AssetRecord {
                version: RecordVersion(1),
                ..asset(document, asset_id, *expected_version)?.clone()
            };
            if asset_is_referenced(document, asset_id) {
                return Err(EngineError::Invariant(format!("asset {asset_id} is still referenced")));
            }
            document.assets.remove(asset_id);
            Ok(vec![Operation::CreateAsset { asset }])
        }
        Operation::AlignShapes { shape_ids, alignment, expected_versions } => {
            align_shapes(document, shape_ids, *alignment, expected_versions)
        }
        Operation::DistributeShapes { shape_ids, axis, expected_versions } => {
            distribute_shapes(document, shape_ids, *axis, expected_versions)
        }
        Operation::StackShapes { shape_ids, axis, gap, expected_versions } => {
            stack_shapes(document, shape_ids, *axis, *gap, expected_versions)
        }
        Operation::GridShapes { shape_ids, columns, column_gap, row_gap, expected_versions } => {
            grid_shapes(document, shape_ids, *columns, *column_gap, *row_gap, expected_versions)
        }
        Operation::TidyShapes { shape_ids, gap, expected_versions } => {
            tidy_shapes(document, shape_ids, *gap, expected_versions)
        }
        Operation::GraphLayout { shape_ids, layout, expected_versions } => {
            graph_layout_shapes(document, shape_ids, *layout, expected_versions)
        }
    }
}

pub fn patch_layer(
    document: &mut Document, layer_id: &LayerId, patch: &LayerPatch, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let layer = layer_mut(document, layer_id, expected)?;
    let inverse = LayerPatch {
        name: patch.name.as_ref().map(|_| layer.name.clone()),
        visible: patch.visible.map(|_| layer.visible),
        locked: patch.locked.map(|_| layer.locked),
        opacity: patch.opacity.map(|_| layer.opacity),
    };
    if let Some(value) = &patch.name {
        if value.trim().is_empty() {
            return Err(EngineError::Schema("layer name is empty".into()));
        }
        layer.name.clone_from(value);
    }
    if let Some(value) = patch.visible {
        layer.visible = value;
    }
    if let Some(value) = patch.locked {
        layer.locked = value;
    }
    if let Some(value) = patch.opacity {
        layer.opacity = value;
    }
    layer.version = next_version(layer.version)?;
    Ok(vec![Operation::PatchLayer {
        layer_id: layer_id.clone(),
        patch: inverse,
        expected_version: Some(layer.version),
    }])
}

pub fn patch_shape(
    document: &mut Document, shape_id: &ShapeId, patch: &ShapePatch, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let normalized_properties = patch
        .properties
        .as_ref()
        .map(|properties| {
            let kind = shape(document, shape_id, expected)?.kind.clone();
            normalize_shape_properties(kind.as_str(), properties)
                .map_err(|error| EngineError::Schema(format!("shape {shape_id}: {error}")))
        })
        .transpose()?;
    let shape = shape_mut(document, shape_id, expected)?;
    let inverse = ShapePatch {
        transform: patch.transform.map(|_| shape.transform),
        properties: patch.properties.as_ref().map(|_| shape.properties.clone()),
        metadata: patch.metadata.as_ref().map(|_| shape.metadata.clone()),
        style: patch.style.map(|_| shape.style),
        layout: patch.layout.as_ref().map(|_| shape.layout.clone()),
    };
    if let Some(value) = patch.transform {
        shape.transform = value;
    }
    if let Some(value) = normalized_properties {
        shape.properties = value;
    }
    if let Some(value) = &patch.metadata {
        shape.metadata.clone_from(value);
    }
    if let Some(value) = patch.style {
        shape.style = value;
    }
    if let Some(value) = &patch.layout {
        shape.layout.clone_from(value);
    }
    shape.version = next_version(shape.version)?;
    Ok(vec![Operation::PatchShape {
        shape_id: shape_id.clone(),
        patch: inverse,
        expected_version: Some(shape.version),
    }])
}

pub fn convert_shape(
    document: &mut Document, shape_id: &ShapeId, kind: &str, properties: &ShapeProperties,
    style: Option<crate::ShapeStyle>, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let normalized_properties = normalize_shape_properties(kind, properties)
        .map_err(|error| EngineError::Schema(format!("shape {shape_id}: {error}")))?;
    let shape = shape_mut(document, shape_id, expected)?;
    if shape.kind.as_str() == crate::CONTAINER_KIND || kind == crate::CONTAINER_KIND {
        return Err(EngineError::Schema("container shapes cannot be converted".into()));
    }
    let mut inverse = Operation::ConvertShape {
        shape_id: shape_id.clone(),
        kind: shape.kind.to_string(),
        properties: shape.properties.clone(),
        style: style.map(|_| shape.style),
        expected_version: None,
    };
    shape.kind = kind.into();
    shape.properties = normalized_properties;
    if let Some(value) = style {
        shape.style = value;
    }
    shape.version = next_version(shape.version)?;
    if let Operation::ConvertShape { expected_version, .. } = &mut inverse {
        *expected_version = Some(shape.version);
    }
    Ok(vec![inverse])
}

pub fn patch_asset(
    document: &mut Document, asset_id: &AssetId, patch: &AssetPatch, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let asset = asset_mut(document, asset_id, expected)?;
    let inverse = AssetPatch {
        name: patch.name.as_ref().map(|_| asset.name.clone()),
        provenance_source: patch
            .provenance_source
            .as_ref()
            .map(|_| asset.provenance.source.clone()),
    };
    if let Some(value) = &patch.name {
        if value.trim().is_empty() {
            return Err(EngineError::Schema("asset name is empty".into()));
        }
        asset.name.clone_from(value);
    }
    if let Some(value) = &patch.provenance_source {
        asset.provenance.source.clone_from(value);
    }
    asset.version = next_version(asset.version)?;
    Ok(vec![Operation::PatchAsset {
        asset_id: asset_id.clone(),
        patch: inverse,
        expected_version: Some(asset.version),
    }])
}

pub fn reorder_layer(
    document: &mut Document, layer_id: &LayerId, anchor: &SiblingAnchor<LayerId>, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let layer = layer(document, layer_id, expected)?.clone();
    let page = document
        .pages
        .get_mut(&layer.page_id)
        .ok_or_else(|| EngineError::Invariant(format!("missing page {}", layer.page_id)))?;
    let old_anchor = anchor_for(&page.layer_ids, layer_id)?;
    move_anchored(&mut page.layer_ids, layer_id, anchor)?;
    page.version = next_version(page.version)?;
    let layer = document
        .layers
        .get_mut(layer_id)
        .ok_or_else(|| EngineError::Invariant(format!("layer {layer_id} disappeared during reorder")))?;
    layer.version = next_version(layer.version)?;
    Ok(vec![Operation::ReorderLayer {
        layer_id: layer_id.clone(),
        anchor: old_anchor,
        expected_version: Some(layer.version),
    }])
}

pub fn reparent_shape(
    document: &mut Document, shape_id: &ShapeId, parent: &ShapeParent, anchor: &SiblingAnchor<ShapeId>,
    expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let shape = shape(document, shape_id, expected)?.clone();
    if parent == &ShapeParent::Shape(shape_id.clone()) || is_descendant(document, shape_id, parent) {
        return Err(EngineError::Invariant(format!(
            "reparenting {shape_id} would create a cycle"
        )));
    }
    if let ShapeParent::Shape(parent_id) = parent {
        let parent_shape = document
            .shapes
            .get(parent_id)
            .ok_or_else(|| EngineError::Precondition(format!("parent shape {parent_id} is missing")))?;
        if parent_shape.kind.as_str() != crate::CONTAINER_KIND {
            return Err(EngineError::Schema(format!(
                "parent shape {parent_id} is not a container"
            )));
        }
    }
    let source_layer = containing_layer(document, &shape)
        .ok_or_else(|| EngineError::Invariant(format!("shape {shape_id} has no containing layer")))?;
    let target_layer = match parent {
        ShapeParent::Layer(layer_id) => document
            .layers
            .get(layer_id)
            .ok_or_else(|| EngineError::Precondition(format!("parent layer {layer_id} is missing")))?,
        ShapeParent::Shape(parent_id) => {
            let parent_shape = document
                .shapes
                .get(parent_id)
                .ok_or_else(|| EngineError::Precondition(format!("parent shape {parent_id} is missing")))?;
            containing_layer(document, parent_shape)
                .ok_or_else(|| EngineError::Invariant(format!("parent shape {parent_id} has no containing layer")))?
        }
    };
    if source_layer.page_id != target_layer.page_id {
        return Err(EngineError::Invariant("shape hierarchy cannot cross pages".into()));
    }
    let world = world_transform(document, &shape);
    let local = parent_world_transform(document, parent)
        .and_then(|parent_world| parent_world.inverse())
        .and_then(|inverse| decompose_transform(inverse.then(world)))
        .ok_or_else(|| {
            EngineError::Invariant(format!(
                "reparenting {shape_id} cannot preserve its world-space transform"
            ))
        })?;
    let old_siblings = shape_siblings(document, &shape.parent)?;
    let old_anchor = anchor_for(old_siblings, shape_id)?;
    remove_shape_child(document, &shape.parent, shape_id)?;
    insert_shape_child(document, parent, shape_id.clone(), anchor)?;
    let changed = document
        .shapes
        .get_mut(shape_id)
        .ok_or_else(|| EngineError::Invariant(format!("shape {shape_id} disappeared during reparent")))?;
    changed.parent = parent.clone();
    changed.transform = local;
    changed.version = next_version(changed.version)?;
    Ok(vec![Operation::ReparentShape {
        shape_id: shape_id.clone(),
        parent: shape.parent,
        anchor: old_anchor,
        expected_version: Some(changed.version),
    }])
}

pub fn delete_page(
    document: &mut Document, page_id: &PageId, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let page = page(document, page_id, expected)?.clone();
    let anchor = anchor_for(&document.page_ids, page_id)?;
    let layer_ids = page.layer_ids.clone();
    let shape_ids: BTreeSet<_> = layer_ids
        .iter()
        .flat_map(|layer_id| descendant_ids_for_layer(document, layer_id))
        .collect();
    let mut inverse = vec![Operation::CreatePage {
        page: crate::PageRecord { layer_ids: Vec::new(), version: RecordVersion(1), ..page },
        anchor,
    }];
    for layer_id in &layer_ids {
        let mut layer = document
            .layers
            .get(layer_id)
            .cloned()
            .ok_or_else(|| EngineError::Invariant(format!("page {page_id} owns missing layer {layer_id}")))?;
        layer.shape_ids.clear();
        layer.version = RecordVersion(1);
        inverse.push(Operation::CreateLayer { layer, anchor: SiblingAnchor::Last });
    }
    append_shape_restoration(document, &shape_ids, &mut inverse);
    append_binding_restoration(document, &shape_ids, &mut inverse);
    document.page_ids.retain(|id| id != page_id);
    for binding_id in bindings_touching(document, &shape_ids) {
        document.bindings.remove(&binding_id);
    }
    for shape_id in &shape_ids {
        document.shapes.remove(shape_id);
    }
    for layer_id in layer_ids {
        document.layers.remove(&layer_id);
    }
    document.pages.remove(page_id);
    Ok(inverse)
}

pub fn delete_layer(
    document: &mut Document, layer_id: &LayerId, contents: &LayerContentsDisposition, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let layer = layer(document, layer_id, expected)?.clone();
    let page = document
        .pages
        .get(&layer.page_id)
        .ok_or_else(|| EngineError::Invariant(format!("layer {layer_id} owns missing page {}", layer.page_id)))?;
    let anchor = anchor_for(&page.layer_ids, layer_id)?;
    let shape_ids: BTreeSet<_> = descendant_ids_for_layer(document, layer_id).collect();
    match contents {
        LayerContentsDisposition::MoveTo(destination) => {
            if destination == layer_id {
                return Err(EngineError::Precondition(
                    "layer contents destination is the deleted layer".into(),
                ));
            }
            let destination_layer = document
                .layers
                .get(destination)
                .ok_or_else(|| EngineError::Precondition(format!("destination layer {destination} is missing")))?;
            if destination_layer.page_id != layer.page_id {
                return Err(EngineError::Invariant(
                    "layer contents must stay on the same page".into(),
                ));
            }
            let root_ids = layer.shape_ids.clone();
            let mut inverse = vec![Operation::CreateLayer {
                layer: crate::LayerRecord { shape_ids: Vec::new(), version: RecordVersion(1), ..layer.clone() },
                anchor,
            }];
            for shape_id in root_ids {
                let restoration = reparent_shape(
                    document,
                    &shape_id,
                    &ShapeParent::Layer(destination.clone()),
                    &SiblingAnchor::Last,
                    None,
                )?;
                inverse.extend(restoration);
            }
            remove_layer_record(document, &layer)?;
            Ok(inverse)
        }
        LayerContentsDisposition::Delete => {
            let mut inverse = vec![Operation::CreateLayer {
                layer: crate::LayerRecord { shape_ids: Vec::new(), version: RecordVersion(1), ..layer.clone() },
                anchor,
            }];
            append_shape_restoration(document, &shape_ids, &mut inverse);
            append_binding_restoration(document, &shape_ids, &mut inverse);
            for binding_id in bindings_touching(document, &shape_ids) {
                document.bindings.remove(&binding_id);
            }
            for shape_id in shape_ids {
                document.shapes.remove(&shape_id);
            }
            remove_layer_record(document, &layer)?;
            Ok(inverse)
        }
    }
}

pub fn remove_layer_record(document: &mut Document, layer: &crate::LayerRecord) -> Result<(), EngineError> {
    let page = document
        .pages
        .get_mut(&layer.page_id)
        .ok_or_else(|| EngineError::Invariant(format!("missing page {}", layer.page_id)))?;
    page.layer_ids.retain(|id| id != &layer.id);
    page.version = next_version(page.version)?;
    document.layers.remove(&layer.id);
    Ok(())
}

pub fn delete_shape(
    document: &mut Document, shape_id: &ShapeId, expected: Option<RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let root = shape(document, shape_id, expected)?.clone();
    let shape_ids: BTreeSet<_> = std::iter::once(shape_id.clone())
        .chain(descendant_ids_for_shape(document, shape_id))
        .collect();
    let mut inverse = Vec::new();
    append_shape_restoration(document, &shape_ids, &mut inverse);
    append_binding_restoration(document, &shape_ids, &mut inverse);
    remove_shape_child(document, &root.parent, shape_id)?;
    for binding_id in bindings_touching(document, &shape_ids) {
        document.bindings.remove(&binding_id);
    }
    for id in shape_ids {
        document.shapes.remove(&id);
    }
    Ok(inverse)
}

pub fn append_shape_restoration(document: &Document, shape_ids: &BTreeSet<ShapeId>, operations: &mut Vec<Operation>) {
    let mut remaining = shape_ids.clone();
    while !remaining.is_empty() {
        let ready: Vec<_> = remaining
            .iter()
            .filter(|id| {
                document.shapes.get(*id).is_some_and(|shape| match &shape.parent {
                    ShapeParent::Layer(_) => true,
                    ShapeParent::Shape(parent_id) => !remaining.contains(parent_id),
                })
            })
            .cloned()
            .collect();
        if ready.is_empty() {
            break;
        }
        for id in ready {
            if let Some(shape) = document.shapes.get(&id) {
                let mut shape = shape.clone();
                shape.child_ids.clear();
                shape.version = RecordVersion(1);
                operations.push(Operation::CreateShape { shape, anchor: SiblingAnchor::Last });
            }
            remaining.remove(&id);
        }
    }
}

pub fn append_binding_restoration(document: &Document, shape_ids: &BTreeSet<ShapeId>, operations: &mut Vec<Operation>) {
    for binding in document.bindings.values() {
        if shape_ids.contains(&binding.source_shape_id) || shape_ids.contains(&binding.target_shape_id) {
            operations.push(Operation::CreateBinding {
                binding: crate::BindingRecord { version: RecordVersion(1), ..binding.clone() },
            });
        }
    }
}

#[derive(Clone, Debug)]
struct LayoutItem {
    id: ShapeId,
    bounds: Bounds,
    locked: bool,
}

pub fn align_shapes(
    document: &mut Document, shape_ids: &[ShapeId], alignment: ShapeAlignment,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let items = layout_items(document, shape_ids, 2, expected_versions)?;
    let target = match alignment {
        ShapeAlignment::Left => items.iter().map(|item| item.bounds.x).fold(f64::INFINITY, f64::min),
        ShapeAlignment::Center => {
            items.iter().map(|item| center_x(&item.bounds)).sum::<f64>() / count_as_f64(items.len())?
        }
        ShapeAlignment::Right => items
            .iter()
            .map(|item| right(&item.bounds))
            .fold(f64::NEG_INFINITY, f64::max),
        ShapeAlignment::Top => items.iter().map(|item| item.bounds.y).fold(f64::INFINITY, f64::min),
        ShapeAlignment::Middle => {
            items.iter().map(|item| center_y(&item.bounds)).sum::<f64>() / count_as_f64(items.len())?
        }
        ShapeAlignment::Bottom => items
            .iter()
            .map(|item| bottom(&item.bounds))
            .fold(f64::NEG_INFINITY, f64::max),
    };
    let deltas = items
        .iter()
        .map(|item| {
            let delta = match alignment {
                ShapeAlignment::Left => (target - item.bounds.x, 0.0),
                ShapeAlignment::Center => (target - center_x(&item.bounds), 0.0),
                ShapeAlignment::Right => (target - right(&item.bounds), 0.0),
                ShapeAlignment::Top => (0.0, target - item.bounds.y),
                ShapeAlignment::Middle => (0.0, target - center_y(&item.bounds)),
                ShapeAlignment::Bottom => (0.0, target - bottom(&item.bounds)),
            };
            (item.id.clone(), delta)
        })
        .collect();
    apply_layout_translations(document, &items, &deltas)
}

pub fn distribute_shapes(
    document: &mut Document, shape_ids: &[ShapeId], axis: LayoutAxis,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let items = layout_items(document, shape_ids, 3, expected_versions)?;
    let mut ordered = items.clone();
    ordered.sort_by(|left, right| layout_order(left, right, axis));
    let first = ordered.first().expect("layout selection has at least three items");
    let last = ordered.last().expect("layout selection has at least three items");
    let start = axis_position(&first.bounds, axis);
    let end = axis_end(&last.bounds, axis);
    let total_size: f64 = ordered.iter().map(|item| axis_size(&item.bounds, axis)).sum();
    let gap = (end - start - total_size) / count_as_f64(ordered.len() - 1)?;
    let mut cursor = start;
    let mut deltas = BTreeMap::new();
    for item in &ordered {
        let delta = cursor - axis_position(&item.bounds, axis);
        deltas.insert(item.id.clone(), axis_delta(axis, delta));
        cursor += axis_size(&item.bounds, axis) + gap;
    }
    apply_layout_translations(document, &items, &deltas)
}

/// Places selected shapes in reading order along one axis and centers them on the other.
pub fn stack_shapes(
    document: &mut Document, shape_ids: &[ShapeId], axis: LayoutAxis, gap: f64,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    ensure_non_negative_spacing(gap, "stack gap")?;
    let items = layout_items(document, shape_ids, 2, expected_versions)?;
    let mut ordered = items.clone();
    ordered.sort_by(|left, right| layout_order(left, right, axis));
    let axis_start = ordered
        .iter()
        .map(|item| axis_position(&item.bounds, axis))
        .fold(f64::INFINITY, f64::min);
    let cross_center = ordered
        .iter()
        .map(|item| cross_center_position(&item.bounds, axis))
        .sum::<f64>()
        / count_as_f64(ordered.len())?;
    let mut cursor = axis_start;
    let mut deltas = BTreeMap::new();
    for item in &ordered {
        let axis_delta = cursor - axis_position(&item.bounds, axis);
        let cross_delta = cross_center - cross_center_position(&item.bounds, axis);
        deltas.insert(item.id.clone(), combine_axis_delta(axis, axis_delta, cross_delta));
        cursor += axis_size(&item.bounds, axis) + gap;
    }
    apply_layout_translations(document, &items, &deltas)
}

/// Places selected shapes in a deterministic row-major grid.
pub fn grid_shapes(
    document: &mut Document, shape_ids: &[ShapeId], columns: u32, column_gap: f64, row_gap: f64,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    ensure_non_negative_spacing(column_gap, "grid column gap")?;
    ensure_non_negative_spacing(row_gap, "grid row gap")?;
    let items = layout_items(document, shape_ids, 2, expected_versions)?;
    let columns = usize::try_from(columns).map_err(|_| EngineError::Schema("grid columns are too large".into()))?;
    if columns == 0 {
        return Err(EngineError::Schema("grid columns must be positive".into()));
    }
    let columns = columns.min(items.len());
    let mut ordered = items.clone();
    ordered.sort_by(|left, right| {
        left.bounds
            .y
            .total_cmp(&right.bounds.y)
            .then_with(|| left.bounds.x.total_cmp(&right.bounds.x))
            .then_with(|| left.id.cmp(&right.id))
    });
    let cell_width = ordered.iter().map(|item| item.bounds.width).fold(0.0, f64::max);
    let cell_height = ordered.iter().map(|item| item.bounds.height).fold(0.0, f64::max);
    let row_count = ordered.len().div_ceil(columns);
    let origin_x = ordered.iter().map(|item| item.bounds.x).fold(f64::INFINITY, f64::min);
    let origin_y = ordered.iter().map(|item| item.bounds.y).fold(f64::INFINITY, f64::min);
    let mut column_x = vec![origin_x; columns];
    for column in 1..columns {
        column_x[column] = column_x[column - 1] + cell_width + column_gap;
    }
    let mut row_y = vec![origin_y; row_count];
    for row in 1..row_count {
        row_y[row] = row_y[row - 1] + cell_height + row_gap;
    }
    let deltas = ordered
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let column = index % columns;
            let row = index / columns;
            (
                item.id.clone(),
                (column_x[column] - item.bounds.x, row_y[row] - item.bounds.y),
            )
        })
        .collect();
    apply_layout_translations(document, &items, &deltas)
}

/// Tidies a selection into a balanced row-major grid using its current extent.
pub fn tidy_shapes(
    document: &mut Document, shape_ids: &[ShapeId], gap: f64, expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let count = shape_ids.iter().collect::<BTreeSet<_>>().len();
    let columns = (count as f64).sqrt().ceil().max(1.0) as u32;
    grid_shapes(document, shape_ids, columns, gap, gap, expected_versions)
}

/// Applies a graph layout while keeping the graph itself out of document state.
pub fn graph_layout_shapes(
    document: &mut Document, shape_ids: &[ShapeId], options: GraphLayoutOptions,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    let items = layout_items(document, shape_ids, 2, expected_versions)?;
    let node_ids = items.iter().map(|item| item.id.clone()).collect::<BTreeSet<_>>();
    let nodes = items
        .iter()
        .map(|item| GraphLayoutNode {
            id: item.id.clone(),
            width: item.bounds.width,
            height: item.bounds.height,
            locked: item.locked,
        })
        .collect::<Vec<_>>();
    let mut edges = BTreeSet::new();
    let mut arrow_endpoints: BTreeMap<ShapeId, BTreeMap<String, ShapeId>> = BTreeMap::new();
    for binding in document.bindings.values() {
        let is_relation = binding.kind.as_str() == "relation" || binding.relation_type.is_some();
        if is_relation
            && node_ids.contains(&binding.source_shape_id)
            && node_ids.contains(&binding.target_shape_id)
            && binding.source_shape_id != binding.target_shape_id
        {
            edges.insert(GraphLayoutEdge {
                source: binding.source_shape_id.clone(),
                target: binding.target_shape_id.clone(),
            });
        }
        if binding.kind.as_str() == "arrow-end"
            && document
                .shapes
                .get(&binding.source_shape_id)
                .is_some_and(|shape| shape.kind.as_str() == ARROW_KIND)
            && node_ids.contains(&binding.target_shape_id)
        {
            arrow_endpoints
                .entry(binding.source_shape_id.clone())
                .or_default()
                .insert(binding.source_handle.clone(), binding.target_shape_id.clone());
        }
    }
    for endpoints in arrow_endpoints.values() {
        let (Some(source), Some(target)) = (endpoints.get("start"), endpoints.get("end")) else {
            continue;
        };
        if source != target {
            edges.insert(GraphLayoutEdge { source: source.clone(), target: target.clone() });
        }
    }
    let graph = GraphLayoutGraph { nodes, edges: edges.into_iter().collect() };
    let result = layout_graph(&graph, options).map_err(EngineError::Schema)?;
    let origin_x = items.iter().map(|item| item.bounds.x).fold(f64::INFINITY, f64::min);
    let origin_y = items.iter().map(|item| item.bounds.y).fold(f64::INFINITY, f64::min);
    let deltas = items
        .iter()
        .map(|item| {
            let position = result
                .positions
                .get(&item.id)
                .ok_or_else(|| EngineError::Invariant(format!("graph layout returned no position for {}", item.id)))?;
            Ok((
                item.id.clone(),
                (
                    origin_x + position.x - item.bounds.x,
                    origin_y + position.y - item.bounds.y,
                ),
            ))
        })
        .collect::<Result<BTreeMap<_, _>, EngineError>>()?;
    apply_layout_translations(document, &items, &deltas)
}

fn layout_items(
    document: &Document, shape_ids: &[ShapeId], minimum: usize, expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<LayoutItem>, EngineError> {
    let selected: BTreeSet<_> = shape_ids.iter().collect();
    if selected.len() != shape_ids.len() {
        return Err(EngineError::Schema("layout operation requires distinct shapes".into()));
    }
    for shape_id in shape_ids {
        shape(document, shape_id, expected_versions.get(shape_id).copied())?;
    }
    let mut roots = shape_ids
        .iter()
        .filter(|shape_id| !has_selected_ancestor(document, shape_id, &selected))
        .cloned()
        .collect::<Vec<_>>();
    roots.sort();
    if roots.len() < minimum {
        return Err(EngineError::Schema(format!(
            "layout operation requires at least {minimum} independent shapes"
        )));
    }
    let page_id = containing_layer(document, &document.shapes[&roots[0]])
        .ok_or_else(|| EngineError::Invariant(format!("shape {} has no containing layer", roots[0])))?
        .page_id
        .clone();
    let items = roots
        .into_iter()
        .map(|id| {
            let shape = document.shapes.get(&id).expect("layout shape was validated");
            let layer = containing_layer(document, shape)
                .ok_or_else(|| EngineError::Invariant(format!("shape {id} has no containing layer")))?;
            if layer.page_id != page_id {
                return Err(EngineError::Invariant("layout selection must stay on one page".into()));
            }
            Ok(LayoutItem { bounds: world_shape_bounds(document, &id), locked: shape_is_locked(document, &id), id })
        })
        .collect::<Result<Vec<_>, EngineError>>()?;
    if items.iter().all(|item| item.locked) {
        return Err(EngineError::Permission(
            "layout selection has no editable shapes".into(),
        ));
    }
    Ok(items)
}

fn has_selected_ancestor(document: &Document, shape_id: &ShapeId, selected: &BTreeSet<&ShapeId>) -> bool {
    let mut parent = document.shapes[shape_id].parent.clone();
    while let ShapeParent::Shape(parent_id) = parent {
        if selected.contains(&parent_id) {
            return true;
        }
        let Some(shape) = document.shapes.get(&parent_id) else { break };
        parent = shape.parent.clone();
    }
    false
}

fn shape_is_locked(document: &Document, shape_id: &ShapeId) -> bool {
    let mut current = Some(shape_id.clone());
    while let Some(id) = current {
        let Some(shape) = document.shapes.get(&id) else { return true };
        if shape.metadata.locked {
            return true;
        }
        current = match &shape.parent {
            ShapeParent::Layer(layer_id) => {
                return document.layers.get(layer_id).is_none_or(|layer| layer.locked);
            }
            ShapeParent::Shape(parent_id) => Some(parent_id.clone()),
        };
    }
    true
}

fn layout_order(left: &LayoutItem, right: &LayoutItem, axis: LayoutAxis) -> std::cmp::Ordering {
    axis_position(&left.bounds, axis)
        .total_cmp(&axis_position(&right.bounds, axis))
        .then_with(|| cross_start(&left.bounds, axis).total_cmp(&cross_start(&right.bounds, axis)))
        .then_with(|| left.id.cmp(&right.id))
}

fn axis_position(bounds: &Bounds, axis: LayoutAxis) -> f64 {
    match axis {
        LayoutAxis::Horizontal => bounds.x,
        LayoutAxis::Vertical => bounds.y,
    }
}

fn axis_end(bounds: &Bounds, axis: LayoutAxis) -> f64 {
    axis_position(bounds, axis) + axis_size(bounds, axis)
}

fn axis_size(bounds: &Bounds, axis: LayoutAxis) -> f64 {
    match axis {
        LayoutAxis::Horizontal => bounds.width,
        LayoutAxis::Vertical => bounds.height,
    }
}

fn cross_start(bounds: &Bounds, axis: LayoutAxis) -> f64 {
    match axis {
        LayoutAxis::Horizontal => bounds.y,
        LayoutAxis::Vertical => bounds.x,
    }
}

fn cross_center_position(bounds: &Bounds, axis: LayoutAxis) -> f64 {
    cross_start(bounds, axis) + axis_size(bounds, cross_axis(axis)) / 2.0
}

fn cross_axis(axis: LayoutAxis) -> LayoutAxis {
    match axis {
        LayoutAxis::Horizontal => LayoutAxis::Vertical,
        LayoutAxis::Vertical => LayoutAxis::Horizontal,
    }
}

fn axis_delta(axis: LayoutAxis, delta: f64) -> (f64, f64) {
    match axis {
        LayoutAxis::Horizontal => (delta, 0.0),
        LayoutAxis::Vertical => (0.0, delta),
    }
}

fn combine_axis_delta(axis: LayoutAxis, axis_delta: f64, cross_delta: f64) -> (f64, f64) {
    match axis {
        LayoutAxis::Horizontal => (axis_delta, cross_delta),
        LayoutAxis::Vertical => (cross_delta, axis_delta),
    }
}

fn ensure_non_negative_spacing(value: f64, name: &str) -> Result<(), EngineError> {
    if value.is_finite() && value >= 0.0 {
        Ok(())
    } else {
        Err(EngineError::Schema(format!("{name} must be finite and non-negative")))
    }
}

fn apply_layout_translations(
    document: &mut Document, items: &[LayoutItem], deltas: &BTreeMap<ShapeId, (f64, f64)>,
) -> Result<Vec<Operation>, EngineError> {
    let mut inverse = Vec::new();
    for item in items {
        if item.locked {
            continue;
        }
        let Some((world_x, world_y)) = deltas.get(&item.id).copied() else {
            return Err(EngineError::Invariant(format!("shape {} has no layout delta", item.id)));
        };
        let parent_shape_parent = document
            .shapes
            .get(&item.id)
            .ok_or_else(|| EngineError::Precondition(format!("shape {} is missing", item.id)))?
            .parent
            .clone();
        let parent = parent_world_transform(document, &parent_shape_parent)
            .and_then(|transform| transform.inverse())
            .ok_or_else(|| EngineError::Invariant(format!("shape {} has a singular parent transform", item.id)))?;
        let shape = document
            .shapes
            .get_mut(&item.id)
            .ok_or_else(|| EngineError::Precondition(format!("shape {} is missing", item.id)))?;
        let old_transform = shape.transform;
        shape.transform.translation.x += parent.a * world_x + parent.c * world_y;
        shape.transform.translation.y += parent.b * world_x + parent.d * world_y;
        shape.version = next_version(shape.version)?;
        inverse.push(Operation::PatchShape {
            shape_id: item.id.clone(),
            patch: ShapePatch { transform: Some(old_transform), ..ShapePatch::default() },
            expected_version: Some(shape.version),
        });
    }
    Ok(inverse)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_page_returns_the_inverse_operation() {
        let mut document = crate::engine::tests::document();
        let inverse = apply_operation(
            &mut document,
            &Operation::RenamePage {
                page_id: PageId::from("page:one"),
                name: "Renamed".into(),
                expected_version: Some(RecordVersion(1)),
            },
        )
        .unwrap();
        assert_eq!(document.pages[&PageId::from("page:one")].name, "Renamed");
        assert!(matches!(
            &inverse[0],
            Operation::RenamePage { name, .. } if name == "Page"
        ));
    }
}
