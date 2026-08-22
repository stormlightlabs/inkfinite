use super::geometry::{
    bottom, center_x, center_y, count_as_f64, decompose_transform, local_shape_bounds, parent_world_transform, right,
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
    AssetId, AssetPatch, BTreeMap, BTreeSet, Document, EngineError, LayerContentsDisposition, LayerId, LayerPatch,
    LayoutAxis, Operation, PageId, RecordVersion, ShapeAlignment, ShapeId, ShapeParent, ShapePatch, ShapeProperties,
    SiblingAnchor, normalize_shape_properties,
};

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

pub fn align_shapes(
    document: &mut Document, shape_ids: &[ShapeId], alignment: ShapeAlignment,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    require_distinct_shapes(document, shape_ids, 2, expected_versions)?;
    require_common_parent(document, shape_ids)?;
    let bounds: Vec<_> = shape_ids
        .iter()
        .map(|id| {
            document
                .shapes
                .get(id)
                .map(local_shape_bounds)
                .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))
        })
        .collect::<Result<_, _>>()?;
    let target = match alignment {
        ShapeAlignment::Left => bounds.iter().map(|bounds| bounds.x).fold(f64::INFINITY, f64::min),
        ShapeAlignment::Center => bounds.iter().map(center_x).sum::<f64>() / count_as_f64(bounds.len())?,
        ShapeAlignment::Right => bounds.iter().map(right).fold(f64::NEG_INFINITY, f64::max),
        ShapeAlignment::Top => bounds.iter().map(|bounds| bounds.y).fold(f64::INFINITY, f64::min),
        ShapeAlignment::Middle => bounds.iter().map(center_y).sum::<f64>() / count_as_f64(bounds.len())?,
        ShapeAlignment::Bottom => bounds.iter().map(bottom).fold(f64::NEG_INFINITY, f64::max),
    };
    let deltas = shape_ids
        .iter()
        .zip(&bounds)
        .map(|(id, bounds)| {
            let delta = match alignment {
                ShapeAlignment::Left => (target - bounds.x, 0.0),
                ShapeAlignment::Center => (target - center_x(bounds), 0.0),
                ShapeAlignment::Right => (target - right(bounds), 0.0),
                ShapeAlignment::Top => (0.0, target - bounds.y),
                ShapeAlignment::Middle => (0.0, target - center_y(bounds)),
                ShapeAlignment::Bottom => (0.0, target - bottom(bounds)),
            };
            (id.clone(), delta)
        })
        .collect();
    apply_layout_translations(document, shape_ids, &deltas)
}

pub fn distribute_shapes(
    document: &mut Document, shape_ids: &[ShapeId], axis: LayoutAxis,
    expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<Vec<Operation>, EngineError> {
    require_distinct_shapes(document, shape_ids, 3, expected_versions)?;
    require_common_parent(document, shape_ids)?;
    let mut ordered: Vec<_> = shape_ids
        .iter()
        .map(|id| {
            document
                .shapes
                .get(id)
                .map(|shape| (id.clone(), local_shape_bounds(shape)))
                .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))
        })
        .collect::<Result<_, _>>()?;
    ordered.sort_by(|left, right| {
        let left_position = match axis {
            LayoutAxis::Horizontal => left.1.x,
            LayoutAxis::Vertical => left.1.y,
        };
        let right_position = match axis {
            LayoutAxis::Horizontal => right.1.x,
            LayoutAxis::Vertical => right.1.y,
        };
        left_position
            .total_cmp(&right_position)
            .then_with(|| left.0.cmp(&right.0))
    });
    let first = ordered
        .first()
        .ok_or_else(|| EngineError::Schema("distribution selection is empty".into()))?;
    let last = ordered
        .last()
        .ok_or_else(|| EngineError::Schema("distribution selection is empty".into()))?;
    let start = match axis {
        LayoutAxis::Horizontal => first.1.x,
        LayoutAxis::Vertical => first.1.y,
    };
    let end = match axis {
        LayoutAxis::Horizontal => right(&last.1),
        LayoutAxis::Vertical => bottom(&last.1),
    };
    let total_size: f64 = ordered
        .iter()
        .map(|(_, bounds)| match axis {
            LayoutAxis::Horizontal => bounds.width,
            LayoutAxis::Vertical => bounds.height,
        })
        .sum();
    let gap = (end - start - total_size) / count_as_f64(ordered.len() - 1)?;
    let mut cursor = start;
    let mut deltas = BTreeMap::new();
    for (id, bounds) in &ordered {
        let position = match axis {
            LayoutAxis::Horizontal => bounds.x,
            LayoutAxis::Vertical => bounds.y,
        };
        let delta = cursor - position;
        deltas.insert(
            id.clone(),
            match axis {
                LayoutAxis::Horizontal => (delta, 0.0),
                LayoutAxis::Vertical => (0.0, delta),
            },
        );
        cursor += match axis {
            LayoutAxis::Horizontal => bounds.width,
            LayoutAxis::Vertical => bounds.height,
        } + gap;
    }
    apply_layout_translations(document, shape_ids, &deltas)
}

pub fn apply_layout_translations(
    document: &mut Document, shape_ids: &[ShapeId], deltas: &BTreeMap<ShapeId, (f64, f64)>,
) -> Result<Vec<Operation>, EngineError> {
    let mut inverse = Vec::new();
    for shape_id in shape_ids {
        let shape = document
            .shapes
            .get_mut(shape_id)
            .ok_or_else(|| EngineError::Precondition(format!("shape {shape_id} is missing")))?;
        let old_transform = shape.transform;
        let (x, y) = deltas
            .get(shape_id)
            .copied()
            .ok_or_else(|| EngineError::Invariant(format!("shape {shape_id} has no layout delta")))?;
        shape.transform.translation.x += x;
        shape.transform.translation.y += y;
        shape.version = next_version(shape.version)?;
        inverse.push(Operation::PatchShape {
            shape_id: shape_id.clone(),
            patch: ShapePatch { transform: Some(old_transform), ..ShapePatch::default() },
            expected_version: Some(shape.version),
        });
    }
    Ok(inverse)
}

pub fn require_distinct_shapes(
    document: &Document, shape_ids: &[ShapeId], minimum: usize, expected_versions: &BTreeMap<ShapeId, RecordVersion>,
) -> Result<(), EngineError> {
    let unique: BTreeSet<_> = shape_ids.iter().collect();
    if unique.len() != shape_ids.len() || shape_ids.len() < minimum {
        return Err(EngineError::Schema(format!(
            "layout operation requires at least {minimum} distinct shapes"
        )));
    }
    for shape_id in shape_ids {
        shape(document, shape_id, expected_versions.get(shape_id).copied())?;
    }
    Ok(())
}

pub fn require_common_parent(document: &Document, shape_ids: &[ShapeId]) -> Result<(), EngineError> {
    let first = &document
        .shapes
        .get(
            shape_ids
                .first()
                .ok_or_else(|| EngineError::Schema("layout operation selection is empty".into()))?,
        )
        .ok_or_else(|| EngineError::Precondition("layout shape is missing".into()))?
        .parent;
    for id in shape_ids.iter().skip(1) {
        let shape = document
            .shapes
            .get(id)
            .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))?;
        if &shape.parent != first {
            return Err(EngineError::Invariant(
                "alignment and distribution require a common parent".into(),
            ));
        }
    }
    Ok(())
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
