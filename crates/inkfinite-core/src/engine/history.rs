use super::{
    AssetId, BTreeMap, BTreeSet, BindingId, Document, EngineError, LayerId, Operation, PageId, ShapeId, ShapePatch,
    ShapeProperties, ShapeRecord,
};

#[derive(Clone)]
pub struct HistoryEntry {
    pub operations: Vec<Operation>,
    pub expected: ExpectedRecords,
}

#[derive(Clone, Default)]
pub struct ExpectedRecords {
    pages: BTreeMap<PageId, crate::PageRecord>,
    layers: BTreeMap<LayerId, crate::LayerRecord>,
    shapes: BTreeMap<ShapeId, ShapeRecord>,
    bindings: BTreeMap<BindingId, crate::BindingRecord>,
    assets: BTreeMap<AssetId, crate::AssetRecord>,
}

pub fn refresh_inverse_preconditions(operations: &mut [Operation], document: &Document) {
    for operation in operations {
        match operation {
            Operation::RenamePage { page_id, expected_version, .. }
            | Operation::DeletePage { page_id, expected_version } => {
                *expected_version = document.pages.get(page_id).map(|record| record.version);
            }
            Operation::PatchLayer { layer_id, expected_version, .. }
            | Operation::ReorderLayer { layer_id, expected_version, .. }
            | Operation::DeleteLayer { layer_id, expected_version, .. } => {
                *expected_version = document.layers.get(layer_id).map(|record| record.version);
            }
            Operation::PatchShape { shape_id, expected_version, .. }
            | Operation::ConvertShape { shape_id, expected_version, .. }
            | Operation::ReparentShape { shape_id, expected_version, .. }
            | Operation::DeleteShape { shape_id, expected_version } => {
                *expected_version = document.shapes.get(shape_id).map(|record| record.version);
            }
            Operation::DeleteBinding { binding_id, expected_version } => {
                *expected_version = document.bindings.get(binding_id).map(|record| record.version);
            }
            Operation::PatchAsset { asset_id, expected_version, .. }
            | Operation::DeleteAsset { asset_id, expected_version } => {
                *expected_version = document.assets.get(asset_id).map(|record| record.version);
            }
            Operation::AlignShapes { shape_ids, expected_versions, .. }
            | Operation::DistributeShapes { shape_ids, expected_versions, .. } => {
                expected_versions.clear();
                expected_versions.extend(shape_ids.iter().filter_map(|shape_id| {
                    document
                        .shapes
                        .get(shape_id)
                        .map(|record| (shape_id.clone(), record.version))
                }));
            }
            Operation::CreatePage { .. }
            | Operation::CreateLayer { .. }
            | Operation::CreateShape { .. }
            | Operation::CreateBinding { .. }
            | Operation::CreateAsset { .. } => {}
        }
    }
}

pub fn capture_expected_records(operations: &[Operation], document: &Document) -> ExpectedRecords {
    let mut expected = ExpectedRecords::default();
    for operation in operations {
        match operation {
            Operation::RenamePage { page_id, .. } | Operation::DeletePage { page_id, .. } => {
                if let Some(record) = document.pages.get(page_id) {
                    expected.pages.insert(page_id.clone(), record.clone());
                }
            }
            Operation::PatchLayer { layer_id, .. }
            | Operation::ReorderLayer { layer_id, .. }
            | Operation::DeleteLayer { layer_id, .. } => {
                if let Some(record) = document.layers.get(layer_id) {
                    expected.layers.insert(layer_id.clone(), record.clone());
                }
            }
            Operation::PatchShape { shape_id, .. }
            | Operation::ConvertShape { shape_id, .. }
            | Operation::ReparentShape { shape_id, .. }
            | Operation::DeleteShape { shape_id, .. } => {
                if let Some(record) = document.shapes.get(shape_id) {
                    expected.shapes.insert(shape_id.clone(), record.clone());
                }
            }
            Operation::DeleteBinding { binding_id, .. } => {
                if let Some(record) = document.bindings.get(binding_id) {
                    expected.bindings.insert(binding_id.clone(), record.clone());
                }
            }
            Operation::PatchAsset { asset_id, .. } | Operation::DeleteAsset { asset_id, .. } => {
                if let Some(record) = document.assets.get(asset_id) {
                    expected.assets.insert(asset_id.clone(), record.clone());
                }
            }
            Operation::AlignShapes { shape_ids, .. } | Operation::DistributeShapes { shape_ids, .. } => {
                for shape_id in shape_ids {
                    if let Some(record) = document.shapes.get(shape_id) {
                        expected.shapes.insert(shape_id.clone(), record.clone());
                    }
                }
            }
            Operation::CreatePage { .. }
            | Operation::CreateLayer { .. }
            | Operation::CreateShape { .. }
            | Operation::CreateBinding { .. }
            | Operation::CreateAsset { .. } => {}
        }
    }
    expected
}

#[allow(clippy::too_many_lines)]
pub fn prepare_compensation(entry: &HistoryEntry, current: &Document) -> Result<Vec<Operation>, EngineError> {
    let mut operations = entry.operations.clone();
    for operation in &mut operations {
        match operation {
            Operation::RenamePage { page_id, name, expected_version } => {
                let expected = entry
                    .expected
                    .pages
                    .get(page_id)
                    .ok_or_else(|| history_conflict(format!("page {page_id} no longer has the expected state")))?;
                let current = current
                    .pages
                    .get(page_id)
                    .ok_or_else(|| history_conflict(format!("page {page_id} was removed concurrently")))?;
                *name = merge_history_value(name, &expected.name, &current.name, "page name")?;
                *expected_version = None;
            }
            Operation::PatchLayer { layer_id, patch, expected_version } => {
                let expected =
                    entry.expected.layers.get(layer_id).ok_or_else(|| {
                        history_conflict(format!("layer {layer_id} no longer has the expected state"))
                    })?;
                let current = current
                    .layers
                    .get(layer_id)
                    .ok_or_else(|| history_conflict(format!("layer {layer_id} was removed concurrently")))?;
                if let Some(before) = &patch.name {
                    patch.name = Some(merge_history_value(
                        before,
                        &expected.name,
                        &current.name,
                        "layer name",
                    )?);
                }
                if let Some(before) = patch.visible {
                    patch.visible = Some(merge_history_value(
                        &before,
                        &expected.visible,
                        &current.visible,
                        "layer visibility",
                    )?);
                }
                if let Some(before) = patch.locked {
                    patch.locked = Some(merge_history_value(
                        &before,
                        &expected.locked,
                        &current.locked,
                        "layer lock",
                    )?);
                }
                if let Some(before) = patch.opacity {
                    patch.opacity = Some(merge_history_value(
                        &before,
                        &expected.opacity,
                        &current.opacity,
                        "layer opacity",
                    )?);
                }
                *expected_version = None;
            }
            Operation::PatchShape { shape_id, patch, expected_version } => {
                let expected =
                    entry.expected.shapes.get(shape_id).ok_or_else(|| {
                        history_conflict(format!("shape {shape_id} no longer has the expected state"))
                    })?;
                let current = current
                    .shapes
                    .get(shape_id)
                    .ok_or_else(|| history_conflict(format!("shape {shape_id} was removed concurrently")))?;
                merge_shape_compensation(patch, expected, current)?;
                *expected_version = None;
            }
            Operation::ConvertShape { shape_id, style, expected_version, .. } => {
                let expected =
                    entry.expected.shapes.get(shape_id).ok_or_else(|| {
                        history_conflict(format!("shape {shape_id} no longer has the expected state"))
                    })?;
                let current = current
                    .shapes
                    .get(shape_id)
                    .ok_or_else(|| history_conflict(format!("shape {shape_id} was removed concurrently")))?;
                if current.kind != expected.kind
                    || current.properties != expected.properties
                    || (style.is_some() && current.style != expected.style)
                {
                    return Err(history_conflict(format!("shape {shape_id} changed since conversion")));
                }
                *expected_version = None;
            }
            Operation::ReparentShape { shape_id, parent, expected_version, .. } => {
                let expected =
                    entry.expected.shapes.get(shape_id).ok_or_else(|| {
                        history_conflict(format!("shape {shape_id} no longer has the expected state"))
                    })?;
                let current = current
                    .shapes
                    .get(shape_id)
                    .ok_or_else(|| history_conflict(format!("shape {shape_id} was removed concurrently")))?;
                *parent = merge_history_value(parent, &expected.parent, &current.parent, "shape parent")?;
                *expected_version = None;
            }
            Operation::PatchAsset { asset_id, patch, expected_version } => {
                let expected =
                    entry.expected.assets.get(asset_id).ok_or_else(|| {
                        history_conflict(format!("asset {asset_id} no longer has the expected state"))
                    })?;
                let current = current
                    .assets
                    .get(asset_id)
                    .ok_or_else(|| history_conflict(format!("asset {asset_id} was removed concurrently")))?;
                if let Some(before) = &patch.name {
                    patch.name = Some(merge_history_value(
                        before,
                        &expected.name,
                        &current.name,
                        "asset name",
                    )?);
                }
                if let Some(before) = &patch.provenance_source {
                    patch.provenance_source = Some(merge_history_value(
                        before,
                        &expected.provenance.source,
                        &current.provenance.source,
                        "asset provenance source",
                    )?);
                }
                *expected_version = None;
            }
            Operation::DeletePage { page_id, expected_version } => {
                guard_existing_record(
                    entry.expected.pages.get(page_id),
                    current.pages.get(page_id),
                    "page",
                    page_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteLayer { layer_id, expected_version, .. }
            | Operation::ReorderLayer { layer_id, expected_version, .. } => {
                guard_existing_record(
                    entry.expected.layers.get(layer_id),
                    current.layers.get(layer_id),
                    "layer",
                    layer_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteShape { shape_id, expected_version } => {
                guard_existing_record(
                    entry.expected.shapes.get(shape_id),
                    current.shapes.get(shape_id),
                    "shape",
                    shape_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteBinding { binding_id, expected_version } => {
                guard_existing_record(
                    entry.expected.bindings.get(binding_id),
                    current.bindings.get(binding_id),
                    "binding",
                    binding_id,
                )?;
                *expected_version = None;
            }
            Operation::DeleteAsset { asset_id, expected_version } => {
                guard_existing_record(
                    entry.expected.assets.get(asset_id),
                    current.assets.get(asset_id),
                    "asset",
                    asset_id,
                )?;
                *expected_version = None;
            }
            Operation::CreatePage { page, .. } => {
                guard_absent_record(&entry.expected.pages, &current.pages, &page.id, "page")?;
            }
            Operation::CreateLayer { layer, .. } => {
                guard_absent_record(&entry.expected.layers, &current.layers, &layer.id, "layer")?;
            }
            Operation::CreateShape { shape, .. } => {
                guard_absent_record(&entry.expected.shapes, &current.shapes, &shape.id, "shape")?;
            }
            Operation::CreateBinding { binding } => {
                guard_absent_record(&entry.expected.bindings, &current.bindings, &binding.id, "binding")?;
            }
            Operation::CreateAsset { asset } => {
                guard_absent_record(&entry.expected.assets, &current.assets, &asset.id, "asset")?;
            }
            Operation::AlignShapes { .. } | Operation::DistributeShapes { .. } => {
                return Err(history_conflict(
                    "history contains an unsupported aggregate layout operation",
                ));
            }
        }
    }
    Ok(operations)
}

#[allow(clippy::too_many_lines)]
pub fn merge_shape_compensation(
    patch: &mut ShapePatch, expected: &ShapeRecord, current: &ShapeRecord,
) -> Result<(), EngineError> {
    if let Some(before) = patch.transform {
        patch.transform = Some(crate::Transform {
            translation: crate::Vec2 {
                x: merge_history_value(
                    &before.translation.x,
                    &expected.transform.translation.x,
                    &current.transform.translation.x,
                    "shape translation x",
                )?,
                y: merge_history_value(
                    &before.translation.y,
                    &expected.transform.translation.y,
                    &current.transform.translation.y,
                    "shape translation y",
                )?,
            },
            rotation: merge_history_value(
                &before.rotation,
                &expected.transform.rotation,
                &current.transform.rotation,
                "shape rotation",
            )?,
            scale_x: merge_history_value(
                &before.scale_x,
                &expected.transform.scale_x,
                &current.transform.scale_x,
                "shape horizontal scale",
            )?,
            scale_y: merge_history_value(
                &before.scale_y,
                &expected.transform.scale_y,
                &current.transform.scale_y,
                "shape vertical scale",
            )?,
        });
    }
    if let Some(before) = &patch.properties {
        patch.properties = Some(merge_history_map(
            before,
            &expected.properties,
            &current.properties,
            "shape property",
        )?);
    }
    if let Some(before) = &patch.metadata {
        let mut merged = current.metadata.clone();
        merged.name = merge_history_value(
            &before.name,
            &expected.metadata.name,
            &current.metadata.name,
            "shape name",
        )?;
        merged.title = merge_history_value(
            &before.title,
            &expected.metadata.title,
            &current.metadata.title,
            "card title",
        )?;
        merged.role = merge_history_value(
            &before.role,
            &expected.metadata.role,
            &current.metadata.role,
            "shape role",
        )?;
        merged.description = merge_history_value(
            &before.description,
            &expected.metadata.description,
            &current.metadata.description,
            "shape description",
        )?;
        merged.body = merge_history_value(
            &before.body,
            &expected.metadata.body,
            &current.metadata.body,
            "card body",
        )?;
        merged.tags = merge_history_value(
            &before.tags,
            &expected.metadata.tags,
            &current.metadata.tags,
            "shape tags",
        )?;
        merged.source = merge_history_value(
            &before.source,
            &expected.metadata.source,
            &current.metadata.source,
            "card source",
        )?;
        merged.link = merge_history_value(
            &before.link,
            &expected.metadata.link,
            &current.metadata.link,
            "card link",
        )?;
        merged.custom_metadata = merge_history_map(
            &before.custom_metadata,
            &expected.metadata.custom_metadata,
            &current.metadata.custom_metadata,
            "card metadata",
        )?;
        merged.locked = merge_history_value(
            &before.locked,
            &expected.metadata.locked,
            &current.metadata.locked,
            "shape lock",
        )?;
        merged.agent_editable = merge_history_value(
            &before.agent_editable,
            &expected.metadata.agent_editable,
            &current.metadata.agent_editable,
            "shape agent permission",
        )?;
        merged.provenance = merge_history_value(
            &before.provenance,
            &expected.metadata.provenance,
            &current.metadata.provenance,
            "shape provenance",
        )?;
        patch.metadata = Some(merged);
    }
    if let Some(before) = patch.style {
        patch.style = Some(crate::ShapeStyle {
            opacity: merge_history_value(
                &before.opacity,
                &expected.style.opacity,
                &current.style.opacity,
                "shape opacity",
            )?,
            fill_opacity: merge_history_value(
                &before.fill_opacity,
                &expected.style.fill_opacity,
                &current.style.fill_opacity,
                "shape fill opacity",
            )?,
            stroke_opacity: merge_history_value(
                &before.stroke_opacity,
                &expected.style.stroke_opacity,
                &current.style.stroke_opacity,
                "shape stroke opacity",
            )?,
        });
    }
    if let Some(before) = &patch.layout {
        patch.layout = Some(merge_history_value(
            before,
            &expected.layout,
            &current.layout,
            "shape layout",
        )?);
    }
    Ok(())
}

pub fn merge_history_map(
    before: &ShapeProperties, expected: &ShapeProperties, current: &ShapeProperties, label: &str,
) -> Result<ShapeProperties, EngineError> {
    let keys: BTreeSet<_> = before
        .keys()
        .chain(expected.keys())
        .chain(current.keys())
        .cloned()
        .collect();
    let mut merged = current.clone();
    for key in keys {
        if before.get(&key) == expected.get(&key) {
            continue;
        }
        if current.get(&key) != expected.get(&key) {
            return Err(history_conflict(format!("{label} {key} changed concurrently")));
        }
        if let Some(value) = before.get(&key) {
            merged.insert(key, value.clone());
        } else {
            merged.remove(&key);
        }
    }
    Ok(merged)
}

pub fn merge_history_value<T: Clone + PartialEq>(
    before: &T, expected: &T, current: &T, label: &str,
) -> Result<T, EngineError> {
    if before == expected {
        return Ok(current.clone());
    }
    if current == expected {
        return Ok(before.clone());
    }
    Err(history_conflict(format!("{label} changed concurrently")))
}

pub fn guard_existing_record<T: PartialEq, Id: std::fmt::Display>(
    expected: Option<&T>, current: Option<&T>, kind: &str, id: &Id,
) -> Result<(), EngineError> {
    if expected.is_some() && expected == current {
        Ok(())
    } else {
        Err(history_conflict(format!("{kind} {id} changed concurrently")))
    }
}

pub fn guard_absent_record<Id: Ord + std::fmt::Display, T>(
    expected: &BTreeMap<Id, T>, current: &BTreeMap<Id, T>, id: &Id, kind: &str,
) -> Result<(), EngineError> {
    if !expected.contains_key(id) && !current.contains_key(id) {
        Ok(())
    } else {
        Err(history_conflict(format!("{kind} {id} was recreated concurrently")))
    }
}

pub fn history_conflict(message: impl Into<String>) -> EngineError {
    EngineError::Precondition(format!("history conflict: {}", message.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compensation_keeps_an_unrelated_current_value() {
        assert_eq!(merge_history_value(&1, &1, &2, "value").unwrap(), 2);
    }

    #[test]
    fn compensation_rejects_two_edits_to_the_same_value() {
        assert!(matches!(
            merge_history_value(&1, &2, &3, "value"),
            Err(EngineError::Precondition(message)) if message.contains("history conflict")
        ));
    }
}
