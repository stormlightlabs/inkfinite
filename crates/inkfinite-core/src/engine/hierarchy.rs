use super::{
    AssetId, BTreeSet, BindingId, ChangeHash, Document, EngineError, LayerId, Operation, PageId, RecordId,
    RecordVersion, ShapeId, ShapeParent, ShapeRecord, SiblingAnchor, Warning,
};

pub fn ensure_absent<Id: std::fmt::Display>(exists: bool, name: &str, id: &Id) -> Result<(), EngineError> {
    if exists { Err(EngineError::Precondition(format!("{name} {id} already exists"))) } else { Ok(()) }
}

pub fn ensure_version_one(version: RecordVersion, context: &str) -> Result<(), EngineError> {
    if version == RecordVersion(1) {
        Ok(())
    } else {
        Err(EngineError::Schema(format!("{context} must start at record version 1")))
    }
}

pub fn next_version(version: RecordVersion) -> Result<RecordVersion, EngineError> {
    version
        .0
        .checked_add(1)
        .map(RecordVersion)
        .ok_or_else(|| EngineError::Invariant("record version overflow".into()))
}

pub fn check_version(actual: RecordVersion, expected: Option<RecordVersion>, name: &str) -> Result<(), EngineError> {
    if expected.is_some_and(|value| value != actual) {
        Err(EngineError::Precondition(format!("{name} version is stale")))
    } else {
        Ok(())
    }
}

pub fn page<'a>(
    document: &'a Document, id: &PageId, expected: Option<RecordVersion>,
) -> Result<&'a crate::PageRecord, EngineError> {
    let value = document
        .pages
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("page {id} is missing")))?;
    check_version(value.version, expected, "page")?;
    Ok(value)
}

pub fn page_mut<'a>(
    document: &'a mut Document, id: &PageId, expected: Option<RecordVersion>,
) -> Result<&'a mut crate::PageRecord, EngineError> {
    let value = document
        .pages
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("page {id} is missing")))?;
    check_version(value.version, expected, "page")?;
    Ok(value)
}

pub fn layer<'a>(
    document: &'a Document, id: &LayerId, expected: Option<RecordVersion>,
) -> Result<&'a crate::LayerRecord, EngineError> {
    let value = document
        .layers
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("layer {id} is missing")))?;
    check_version(value.version, expected, "layer")?;
    Ok(value)
}

pub fn layer_mut<'a>(
    document: &'a mut Document, id: &LayerId, expected: Option<RecordVersion>,
) -> Result<&'a mut crate::LayerRecord, EngineError> {
    let value = document
        .layers
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("layer {id} is missing")))?;
    check_version(value.version, expected, "layer")?;
    Ok(value)
}

pub fn shape<'a>(
    document: &'a Document, id: &ShapeId, expected: Option<RecordVersion>,
) -> Result<&'a ShapeRecord, EngineError> {
    let value = document
        .shapes
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))?;
    check_version(value.version, expected, "shape")?;
    Ok(value)
}

pub fn shape_mut<'a>(
    document: &'a mut Document, id: &ShapeId, expected: Option<RecordVersion>,
) -> Result<&'a mut ShapeRecord, EngineError> {
    let value = document
        .shapes
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("shape {id} is missing")))?;
    check_version(value.version, expected, "shape")?;
    Ok(value)
}

pub fn binding<'a>(
    document: &'a Document, id: &BindingId, expected: Option<RecordVersion>,
) -> Result<&'a crate::BindingRecord, EngineError> {
    let value = document
        .bindings
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("binding {id} is missing")))?;
    check_version(value.version, expected, "binding")?;
    Ok(value)
}

pub fn asset<'a>(
    document: &'a Document, id: &AssetId, expected: Option<RecordVersion>,
) -> Result<&'a crate::AssetRecord, EngineError> {
    let value = document
        .assets
        .get(id)
        .ok_or_else(|| EngineError::Precondition(format!("asset {id} is missing")))?;
    check_version(value.version, expected, "asset")?;
    Ok(value)
}

pub fn asset_mut<'a>(
    document: &'a mut Document, id: &AssetId, expected: Option<RecordVersion>,
) -> Result<&'a mut crate::AssetRecord, EngineError> {
    let value = document
        .assets
        .get_mut(id)
        .ok_or_else(|| EngineError::Precondition(format!("asset {id} is missing")))?;
    check_version(value.version, expected, "asset")?;
    Ok(value)
}

pub fn insert_anchored<Id: Clone + Eq + std::fmt::Display>(
    items: &mut Vec<Id>, id: Id, anchor: &SiblingAnchor<Id>,
) -> Result<(), EngineError> {
    if items.contains(&id) {
        return Err(EngineError::Precondition(format!("ordered item {id} already exists")));
    }
    let index = anchor_index(items, anchor)?;
    items.insert(index, id);
    Ok(())
}

pub fn move_anchored<Id: Clone + Eq + std::fmt::Display>(
    items: &mut Vec<Id>, id: &Id, anchor: &SiblingAnchor<Id>,
) -> Result<(), EngineError> {
    let position = items
        .iter()
        .position(|item| item == id)
        .ok_or_else(|| EngineError::Invariant(format!("ordered item {id} is missing")))?;
    let item = items.remove(position);
    let index = anchor_index(items, anchor)?;
    items.insert(index, item);
    Ok(())
}

pub fn anchor_index<Id: Eq + std::fmt::Display>(
    items: &[Id], anchor: &SiblingAnchor<Id>,
) -> Result<usize, EngineError> {
    match anchor {
        SiblingAnchor::First => Ok(0),
        SiblingAnchor::Last => Ok(items.len()),
        SiblingAnchor::Before(id) => items
            .iter()
            .position(|item| item == id)
            .ok_or_else(|| EngineError::Precondition(format!("anchor sibling {id} is missing"))),
        SiblingAnchor::After(id) => items
            .iter()
            .position(|item| item == id)
            .map(|index| index + 1)
            .ok_or_else(|| EngineError::Precondition(format!("anchor sibling {id} is missing"))),
    }
}

pub fn anchor_for<Id: Clone + Eq + std::fmt::Display>(items: &[Id], id: &Id) -> Result<SiblingAnchor<Id>, EngineError> {
    let index = items
        .iter()
        .position(|item| item == id)
        .ok_or_else(|| EngineError::Invariant(format!("ordered item {id} is missing")))?;
    Ok(if index == 0 { SiblingAnchor::First } else { SiblingAnchor::After(items[index - 1].clone()) })
}

pub fn shape_siblings<'a>(document: &'a Document, parent: &ShapeParent) -> Result<&'a Vec<ShapeId>, EngineError> {
    match parent {
        ShapeParent::Layer(id) => document
            .layers
            .get(id)
            .map(|layer| &layer.shape_ids)
            .ok_or_else(|| EngineError::Precondition(format!("parent layer {id} is missing"))),
        ShapeParent::Shape(id) => document
            .shapes
            .get(id)
            .map(|shape| &shape.child_ids)
            .ok_or_else(|| EngineError::Precondition(format!("parent shape {id} is missing"))),
    }
}

pub fn insert_shape_child(
    document: &mut Document, parent: &ShapeParent, id: ShapeId, anchor: &SiblingAnchor<ShapeId>,
) -> Result<(), EngineError> {
    match parent {
        ShapeParent::Layer(parent_id) => {
            let layer = document
                .layers
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Precondition(format!("parent layer {parent_id} is missing")))?;
            insert_anchored(&mut layer.shape_ids, id, anchor)?;
            layer.version = next_version(layer.version)?;
        }
        ShapeParent::Shape(parent_id) => {
            let shape = document
                .shapes
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Precondition(format!("parent shape {parent_id} is missing")))?;
            insert_anchored(&mut shape.child_ids, id, anchor)?;
            shape.version = next_version(shape.version)?;
        }
    }
    Ok(())
}

pub fn remove_shape_child(document: &mut Document, parent: &ShapeParent, id: &ShapeId) -> Result<(), EngineError> {
    match parent {
        ShapeParent::Layer(parent_id) => {
            let layer = document
                .layers
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Invariant(format!("parent layer {parent_id} is missing")))?;
            layer.shape_ids.retain(|child| child != id);
            layer.version = next_version(layer.version)?;
        }
        ShapeParent::Shape(parent_id) => {
            let shape = document
                .shapes
                .get_mut(parent_id)
                .ok_or_else(|| EngineError::Invariant(format!("parent shape {parent_id} is missing")))?;
            shape.child_ids.retain(|child| child != id);
            shape.version = next_version(shape.version)?;
        }
    }
    Ok(())
}

pub fn containing_layer<'a>(document: &'a Document, shape: &ShapeRecord) -> Option<&'a crate::LayerRecord> {
    let mut parent = shape.parent.clone();
    loop {
        match parent {
            ShapeParent::Layer(id) => return document.layers.get(&id),
            ShapeParent::Shape(id) => parent = document.shapes.get(&id)?.parent.clone(),
        }
    }
}

pub fn is_descendant(document: &Document, shape_id: &ShapeId, parent: &ShapeParent) -> bool {
    let ShapeParent::Shape(mut current) = parent.clone() else {
        return false;
    };
    loop {
        if &current == shape_id {
            return true;
        }
        let Some(shape) = document.shapes.get(&current) else {
            return false;
        };
        match &shape.parent {
            ShapeParent::Shape(next) => current = next.clone(),
            ShapeParent::Layer(_) => return false,
        }
    }
}

pub fn descendant_ids_for_layer<'a>(
    document: &'a Document, layer_id: &'a LayerId,
) -> impl Iterator<Item = ShapeId> + 'a {
    document
        .layers
        .get(layer_id)
        .into_iter()
        .flat_map(|layer| layer.shape_ids.iter())
        .flat_map(|id| std::iter::once(id.clone()).chain(descendant_ids_for_shape(document, id)))
}

pub fn descendant_ids_for_shape<'a>(
    document: &'a Document, shape_id: &'a ShapeId,
) -> Box<dyn Iterator<Item = ShapeId> + 'a> {
    Box::new(
        document
            .shapes
            .get(shape_id)
            .into_iter()
            .flat_map(|shape| shape.child_ids.iter())
            .flat_map(|id| std::iter::once(id.clone()).chain(descendant_ids_for_shape(document, id))),
    )
}

pub fn bindings_touching(document: &Document, shapes: &BTreeSet<ShapeId>) -> Vec<BindingId> {
    document
        .bindings
        .values()
        .filter(|binding| shapes.contains(&binding.source_shape_id) || shapes.contains(&binding.target_shape_id))
        .map(|binding| binding.id.clone())
        .collect()
}

pub fn asset_is_referenced(document: &Document, asset_id: &AssetId) -> bool {
    document.shapes.values().any(|shape| {
        shape
            .properties
            .values()
            .any(|value| value.as_str() == Some(asset_id.as_str()))
    })
}

pub fn operation_shape_ids(operation: &Operation) -> Vec<ShapeId> {
    match operation {
        Operation::PatchShape { shape_id, .. }
        | Operation::ReparentShape { shape_id, .. }
        | Operation::DeleteShape { shape_id, .. } => vec![shape_id.clone()],
        Operation::CreateBinding { binding } => vec![binding.source_shape_id.clone(), binding.target_shape_id.clone()],
        Operation::AlignShapes { shape_ids, .. } | Operation::DistributeShapes { shape_ids, .. } => shape_ids.clone(),
        _ => Vec::new(),
    }
}

pub fn operation_layer_id(operation: &Operation) -> Option<LayerId> {
    match operation {
        Operation::PatchLayer { layer_id, .. }
        | Operation::ReorderLayer { layer_id, .. }
        | Operation::DeleteLayer { layer_id, .. } => Some(layer_id.clone()),
        Operation::CreateShape { shape, .. } => match &shape.parent {
            ShapeParent::Layer(id) => Some(id.clone()),
            ShapeParent::Shape(_) => None,
        },
        Operation::ReparentShape { parent: ShapeParent::Layer(id), .. } => Some(id.clone()),
        _ => None,
    }
}

pub fn canonical_heads(heads: &[ChangeHash]) -> BTreeSet<ChangeHash> {
    heads.iter().cloned().collect()
}

pub fn warning(code: &str, message: String, record_ids: Vec<RecordId>) -> Warning {
    Warning { code: code.into(), message, record_ids }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sibling_anchors_resolve_without_numeric_positions_in_the_contract() {
        let ids = vec![ShapeId::from("a"), ShapeId::from("b")];
        assert_eq!(
            anchor_index(&ids, &SiblingAnchor::Before(ShapeId::from("b"))).unwrap(),
            1
        );
        assert_eq!(anchor_index(&ids, &SiblingAnchor::Last).unwrap(), 2);
    }
}
