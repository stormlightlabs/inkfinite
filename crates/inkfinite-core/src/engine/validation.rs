use super::{BTreeSet, ContainerLayout, Document, EngineError, ShapeId, ShapeParent, ShapeRecord};

/// Validates normalized document ownership, references, geometry, and layout.
///
/// # Errors
///
/// Returns [`EngineError::Invariant`] or [`EngineError::Schema`] with the first
/// invalid ownership, reference, geometry, or layout condition.
pub fn validate_document(document: &Document) -> Result<(), EngineError> {
    if document.pages.is_empty() || document.page_ids.is_empty() {
        return Err(EngineError::Invariant("document must contain at least one page".into()));
    }
    ensure_unique_and_complete(&document.page_ids, document.pages.keys().cloned(), "page")?;
    let mut listed_layers = BTreeSet::new();
    for page in document.pages.values() {
        if page.name.trim().is_empty() || page.layer_ids.is_empty() {
            return Err(EngineError::Invariant(format!(
                "page {} needs a name and at least one layer",
                page.id
            )));
        }
        for layer_id in &page.layer_ids {
            if !listed_layers.insert(layer_id.clone()) {
                return Err(EngineError::Invariant(format!(
                    "layer {layer_id} is listed more than once"
                )));
            }
            let layer = document.layers.get(layer_id).ok_or_else(|| {
                EngineError::Invariant(format!("page {} refers to missing layer {layer_id}", page.id))
            })?;
            if layer.page_id != page.id {
                return Err(EngineError::Invariant(format!(
                    "layer {layer_id} has inconsistent page ownership"
                )));
            }
        }
    }
    if listed_layers.len() != document.layers.len() {
        return Err(EngineError::Invariant("one or more layers are unlisted".into()));
    }
    let mut listed_shapes = BTreeSet::new();
    for layer in document.layers.values() {
        if layer.name.trim().is_empty() {
            return Err(EngineError::Invariant(format!("layer {} has an empty name", layer.id)));
        }
        for shape_id in &layer.shape_ids {
            validate_child(
                document,
                &mut listed_shapes,
                shape_id,
                &ShapeParent::Layer(layer.id.clone()),
            )?;
        }
    }
    for shape in document.shapes.values() {
        validate_shape_schema(shape)?;
        for child_id in &shape.child_ids {
            validate_child(
                document,
                &mut listed_shapes,
                child_id,
                &ShapeParent::Shape(shape.id.clone()),
            )?;
        }
        ensure_acyclic(document, &shape.id)?;
    }
    if listed_shapes.len() != document.shapes.len() {
        return Err(EngineError::Invariant("one or more shapes are unlisted".into()));
    }
    for binding in document.bindings.values() {
        ensure_binding_endpoints(document, binding)?;
    }
    Ok(())
}

pub fn validate_shape_schema(shape: &ShapeRecord) -> Result<(), EngineError> {
    crate::validate_shape_properties(shape.kind.as_str(), &shape.properties)
        .map_err(|error| EngineError::Schema(format!("shape {}: {error}", shape.id)))?;
    if shape.kind.as_str() != crate::CONTAINER_KIND && (!shape.child_ids.is_empty() || shape.layout.is_some()) {
        return Err(EngineError::Schema(format!(
            "non-container shape {} owns children or layout",
            shape.id
        )));
    }
    let transform = shape.transform;
    if ![
        transform.translation.x,
        transform.translation.y,
        transform.rotation,
        transform.scale_x,
        transform.scale_y,
    ]
    .into_iter()
    .all(f64::is_finite)
        || transform.scale_x == 0.0
        || transform.scale_y == 0.0
    {
        return Err(EngineError::Schema(format!(
            "shape {} has an invalid transform",
            shape.id
        )));
    }
    if let Some(layout) = &shape.layout {
        match layout {
            ContainerLayout::Free => {}
            ContainerLayout::Stack { gap, padding, .. } => {
                validate_layout_numbers(shape, *gap, padding)?;
            }
            ContainerLayout::Grid { columns, column_gap, row_gap, padding, .. } => {
                if *columns == 0 {
                    return Err(EngineError::Schema(format!("shape {} grid has no columns", shape.id)));
                }
                validate_layout_numbers(shape, *column_gap, padding)?;
                if !row_gap.is_finite() || *row_gap < 0.0 {
                    return Err(EngineError::Schema(format!("shape {} has invalid row gap", shape.id)));
                }
            }
        }
    }
    Ok(())
}

pub fn validate_layout_numbers(shape: &ShapeRecord, gap: f64, padding: &crate::Insets) -> Result<(), EngineError> {
    if ![gap, padding.top, padding.right, padding.bottom, padding.left]
        .into_iter()
        .all(|value| value.is_finite() && value >= 0.0)
    {
        return Err(EngineError::Schema(format!(
            "shape {} has invalid layout spacing",
            shape.id
        )));
    }
    Ok(())
}

/// Repairs merge-created hierarchy damage using stable IDs and sorted order.
///
/// # Errors
///
/// Returns an error when the document has no page or when deterministic repair
/// cannot produce a valid normalized document.
#[allow(clippy::too_many_lines)]
pub fn ensure_unique_and_complete<'a, I>(listed: &[I::Item], keys: I, name: &str) -> Result<(), EngineError>
where
    I: Iterator,
    I::Item: Ord + Clone + std::fmt::Display + 'a,
{
    let listed_set: BTreeSet<_> = listed.iter().cloned().collect();
    if listed_set.len() != listed.len() {
        return Err(EngineError::Invariant(format!("duplicate {name} ordering entry")));
    }
    let keys_set: BTreeSet<_> = keys.collect();
    if listed_set != keys_set {
        return Err(EngineError::Invariant(format!(
            "{name} ordering does not match records"
        )));
    }
    Ok(())
}

pub fn validate_child(
    document: &Document, seen: &mut BTreeSet<ShapeId>, child_id: &ShapeId, expected_parent: &ShapeParent,
) -> Result<(), EngineError> {
    if !seen.insert(child_id.clone()) {
        return Err(EngineError::Invariant(format!(
            "shape {child_id} is listed more than once"
        )));
    }
    let child = document
        .shapes
        .get(child_id)
        .ok_or_else(|| EngineError::Invariant(format!("missing child shape {child_id}")))?;
    if &child.parent != expected_parent {
        return Err(EngineError::Invariant(format!(
            "shape {child_id} has inconsistent parent"
        )));
    }
    Ok(())
}

pub fn ensure_acyclic(document: &Document, start: &ShapeId) -> Result<(), EngineError> {
    let mut seen = BTreeSet::new();
    let mut current = start.clone();
    while let Some(shape) = document.shapes.get(&current) {
        if !seen.insert(current.clone()) {
            return Err(EngineError::Invariant(format!(
                "shape hierarchy contains a cycle at {current}"
            )));
        }
        match &shape.parent {
            ShapeParent::Shape(parent) => current = parent.clone(),
            ShapeParent::Layer(_) => return Ok(()),
        }
    }
    Ok(())
}

pub fn ensure_binding_endpoints(document: &Document, binding: &crate::BindingRecord) -> Result<(), EngineError> {
    if !document.shapes.contains_key(&binding.source_shape_id)
        || !document.shapes.contains_key(&binding.target_shape_id)
    {
        return Err(EngineError::Invariant(format!(
            "binding {} has a missing endpoint",
            binding.id
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PageId;

    #[test]
    fn a_page_without_a_layer_is_invalid() {
        let mut document = crate::engine::tests::document();
        document
            .pages
            .get_mut(&PageId::from("page:one"))
            .unwrap()
            .layer_ids
            .clear();
        assert!(matches!(validate_document(&document), Err(EngineError::Invariant(_))));
    }
}
