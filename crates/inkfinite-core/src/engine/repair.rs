use super::hierarchy::{next_version, warning};
use super::{
    BTreeSet, Document, EngineError, LayerId, RecordId, RecordVersion, ShapeParent, Warning, validate_document,
};

/// Repairs deterministic hierarchy damage after concurrent CRDT merges.
///
/// # Errors
///
/// Returns an invariant error when the document has no page to own recovered
/// records or when a repaired record version overflows.
#[allow(clippy::too_many_lines)]
pub fn repair_document(document: &mut Document) -> Result<Vec<Warning>, EngineError> {
    let original = document.clone();
    let mut warnings = Vec::new();
    if document.pages.is_empty() {
        return Err(EngineError::Invariant("cannot repair a document with no pages".into()));
    }
    document.page_ids.retain(|id| document.pages.contains_key(id));
    document.page_ids.sort();
    document.page_ids.dedup();
    for page_id in document.pages.keys() {
        if !document.page_ids.contains(page_id) {
            document.page_ids.push(page_id.clone());
        }
    }
    document.page_ids.sort();

    let page_ids: Vec<_> = document.page_ids.clone();
    for page_id in page_ids {
        let page = document
            .pages
            .get(&page_id)
            .ok_or_else(|| EngineError::Invariant(format!("page {page_id} disappeared")))?;
        let valid_layers: Vec<_> = page
            .layer_ids
            .iter()
            .filter(|layer_id| {
                document
                    .layers
                    .get(*layer_id)
                    .is_some_and(|layer| layer.page_id == page_id)
            })
            .cloned()
            .collect();
        let mut layers = valid_layers;
        layers.sort();
        layers.dedup();
        if layers.is_empty() {
            let layer_id = LayerId::new(format!("layer:recovered:{}", page_id.as_str()));
            document
                .layers
                .entry(layer_id.clone())
                .or_insert_with(|| crate::LayerRecord {
                    id: layer_id.clone(),
                    page_id: page_id.clone(),
                    name: "Recovered".into(),
                    shape_ids: Vec::new(),
                    visible: true,
                    locked: false,
                    opacity: crate::Opacity::OPAQUE,
                    version: RecordVersion(1),
                });
            layers.push(layer_id.clone());
            warnings.push(warning(
                "recovered_layer",
                format!("created {layer_id}"),
                vec![RecordId::Layer(layer_id)],
            ));
        }
        let page = document
            .pages
            .get_mut(&page_id)
            .ok_or_else(|| EngineError::Invariant(format!("page {page_id} disappeared")))?;
        page.layer_ids = layers;
    }
    let owned_layers: BTreeSet<_> = document
        .pages
        .values()
        .flat_map(|page| page.layer_ids.iter().cloned())
        .collect();
    document.layers.retain(|id, _| owned_layers.contains(id));
    let fallback = document
        .pages
        .values()
        .flat_map(|page| page.layer_ids.iter())
        .min()
        .cloned()
        .ok_or_else(|| EngineError::Invariant("repair produced no recovery layer".into()))?;

    let valid_shapes: BTreeSet<_> = document.shapes.keys().cloned().collect();
    for shape in document.shapes.values_mut() {
        let valid_parent = match &shape.parent {
            ShapeParent::Layer(id) => document.layers.contains_key(id),
            ShapeParent::Shape(id) => valid_shapes.contains(id) && id != &shape.id,
        };
        if !valid_parent {
            shape.parent = ShapeParent::Layer(fallback.clone());
            warnings.push(warning(
                "recovered_parent",
                format!("moved {} to {fallback}", shape.id),
                vec![RecordId::Shape(shape.id.clone())],
            ));
        }
        shape.child_ids.clear();
    }
    for layer in document.layers.values_mut() {
        layer.shape_ids.clear();
    }
    break_parent_cycles(document, &fallback, &mut warnings);
    let parents: Vec<_> = document
        .shapes
        .values()
        .map(|shape| (shape.id.clone(), shape.parent.clone()))
        .collect();
    for (shape_id, parent) in parents {
        match parent {
            ShapeParent::Layer(layer_id) => {
                let layer = document
                    .layers
                    .get_mut(&layer_id)
                    .ok_or_else(|| EngineError::Invariant(format!("repair lost parent layer {layer_id}")))?;
                layer.shape_ids.push(shape_id);
            }
            ShapeParent::Shape(parent_id) => {
                let shape = document
                    .shapes
                    .get_mut(&parent_id)
                    .ok_or_else(|| EngineError::Invariant(format!("repair lost parent shape {parent_id}")))?;
                shape.child_ids.push(shape_id);
            }
        }
    }
    for layer in document.layers.values_mut() {
        layer.shape_ids.sort();
        layer.shape_ids.dedup();
    }
    for shape in document.shapes.values_mut() {
        shape.child_ids.sort();
        shape.child_ids.dedup();
    }
    let before_bindings = document.bindings.len();
    document.bindings.retain(|_, binding| {
        valid_shapes.contains(&binding.source_shape_id) && valid_shapes.contains(&binding.target_shape_id)
    });
    if document.bindings.len() != before_bindings {
        warnings.push(warning(
            "removed_dangling_binding",
            "removed bindings with missing endpoints".into(),
            Vec::new(),
        ));
    }
    let changed_before_versions = document != &original;
    for (id, page) in &mut document.pages {
        if let Some(before) = original.pages.get(id)
            && page != before
        {
            page.version = next_version(before.version)?;
        }
    }
    for (id, layer) in &mut document.layers {
        if let Some(before) = original.layers.get(id)
            && layer != before
        {
            layer.version = next_version(before.version)?;
        }
    }
    for (id, shape) in &mut document.shapes {
        if let Some(before) = original.shapes.get(id)
            && shape != before
        {
            shape.version = next_version(before.version)?;
        }
    }
    if changed_before_versions && warnings.is_empty() {
        warnings.push(warning(
            "normalized_hierarchy",
            "normalized hierarchy after merge".into(),
            Vec::new(),
        ));
    }
    validate_document(document)?;
    Ok(warnings)
}

pub fn break_parent_cycles(document: &mut Document, fallback: &LayerId, warnings: &mut Vec<Warning>) {
    let shape_ids: Vec<_> = document.shapes.keys().cloned().collect();
    for start in shape_ids {
        let mut path = Vec::new();
        let mut current = start.clone();
        while let Some(shape) = document.shapes.get(&current) {
            if let Some(position) = path.iter().position(|id| id == &current) {
                let cycle = &path[position..];
                if let Some(chosen) = cycle.iter().max().cloned() {
                    if let Some(shape) = document.shapes.get_mut(&chosen) {
                        shape.parent = ShapeParent::Layer(fallback.clone());
                    }
                    warnings.push(warning(
                        "recovered_cycle",
                        format!("moved {chosen} to {fallback}"),
                        vec![RecordId::Shape(chosen)],
                    ));
                }
                break;
            }
            path.push(current.clone());
            match &shape.parent {
                ShapeParent::Shape(parent) => current = parent.clone(),
                ShapeParent::Layer(_) => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PageId;

    #[test]
    fn hierarchy_repair_is_idempotent() {
        let mut document = crate::engine::tests::document();
        document
            .pages
            .get_mut(&PageId::from("page:one"))
            .unwrap()
            .layer_ids
            .clear();
        document.layers.clear();
        repair_document(&mut document).unwrap();
        let repaired = document.clone();
        assert!(repair_document(&mut document).unwrap().is_empty());
        assert_eq!(document, repaired);
    }
}
