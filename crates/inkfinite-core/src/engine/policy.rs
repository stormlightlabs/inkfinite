use super::hierarchy::{
    containing_layer, descendant_ids_for_layer, descendant_ids_for_shape, operation_layer_id, operation_shape_ids,
};
use super::{Document, EngineError, LayerContentsDisposition, Operation, TransactionDraft};

pub fn validate_transaction_schema(transaction: &TransactionDraft) -> Result<(), EngineError> {
    if transaction.id.0.trim().is_empty() {
        return Err(EngineError::Schema("transaction ID is empty".into()));
    }
    if transaction.actor_id.as_str().trim().is_empty() {
        return Err(EngineError::Schema("actor ID is empty".into()));
    }
    if transaction.description.trim().is_empty() {
        return Err(EngineError::Schema("description is empty".into()));
    }
    if transaction.operations.is_empty() {
        return Err(EngineError::Schema("operations are empty".into()));
    }
    Ok(())
}

pub fn validate_locks(document: &Document, operation: &Operation) -> Result<(), EngineError> {
    // Layout treats locked records as fixed anchors and skips their transforms;
    // the operation itself must therefore be allowed to inspect them.
    if matches!(
        operation,
        Operation::AlignShapes { .. }
            | Operation::DistributeShapes { .. }
            | Operation::StackShapes { .. }
            | Operation::GridShapes { .. }
            | Operation::TidyShapes { .. }
            | Operation::GraphLayout { .. }
    ) {
        return Ok(());
    }
    let mut shape_ids = operation_shape_ids(operation);
    if let Operation::ReparentShape { parent: crate::ShapeParent::Shape(parent_id), .. } = operation {
        shape_ids.push(parent_id.clone());
    }
    if let Operation::DeleteLayer { contents: LayerContentsDisposition::MoveTo(destination), .. } = operation
        && document.layers.get(destination).is_some_and(|layer| layer.locked)
    {
        return Err(EngineError::Permission("destination layer is locked".into()));
    }
    match operation {
        Operation::DeletePage { page_id, .. } => {
            if let Some(page) = document.pages.get(page_id) {
                shape_ids.extend(
                    page.layer_ids
                        .iter()
                        .flat_map(|layer_id| descendant_ids_for_layer(document, layer_id)),
                );
            }
        }
        Operation::DeleteLayer { layer_id, .. } => {
            shape_ids.extend(descendant_ids_for_layer(document, layer_id));
        }
        Operation::DeleteShape { shape_id, .. } => {
            shape_ids.extend(descendant_ids_for_shape(document, shape_id));
        }
        _ => {}
    }
    shape_ids.sort();
    shape_ids.dedup();
    for shape_id in shape_ids {
        let mut current_id = Some(shape_id.clone());
        while let Some(current) = current_id {
            let Some(shape) = document.shapes.get(&current) else {
                break;
            };
            if shape.metadata.locked {
                return Err(EngineError::Permission(format!("shape {current} is locked")));
            }
            current_id = match &shape.parent {
                crate::ShapeParent::Shape(parent_id) => Some(parent_id.clone()),
                crate::ShapeParent::Layer(_) => None,
            };
        }
        if let Some(shape) = document.shapes.get(&shape_id)
            && let Some(layer) = containing_layer(document, shape)
            && layer.locked
        {
            return Err(EngineError::Permission(format!("layer {} is locked", layer.id)));
        }
        if let Operation::ReparentShape { parent, .. } = operation {
            let destination_layer = match parent {
                crate::ShapeParent::Layer(layer_id) => document.layers.get(layer_id),
                crate::ShapeParent::Shape(parent_id) => document
                    .shapes
                    .get(parent_id)
                    .and_then(|parent| containing_layer(document, parent)),
            };
            if destination_layer.is_some_and(|layer| layer.locked) {
                return Err(EngineError::Permission("destination layer is locked".into()));
            }
        }
    }
    if let Some(layer_id) = operation_layer_id(operation)
        && document.layers.get(&layer_id).is_some_and(|layer| layer.locked)
    {
        let unlock_only = matches!(operation,
            Operation::PatchLayer { patch, .. }
            if patch.locked == Some(false)
                && patch.name.is_none()
                && patch.visible.is_none()
                && patch.opacity.is_none()
        );
        if !unlock_only {
            return Err(EngineError::Permission(format!("layer {layer_id} is locked")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::TransactionId;
    use crate::{ActorId, Origin};

    #[test]
    fn an_empty_transaction_is_rejected_by_schema_policy() {
        let transaction = TransactionDraft {
            id: TransactionId("transaction".into()),
            actor_id: ActorId::from("actor"),
            origin: Origin::Human,
            base_heads: Vec::new(),
            description: "empty".into(),
            operations: Vec::new(),
            timestamp: crate::Timestamp(0),
        };
        assert!(matches!(
            validate_transaction_schema(&transaction),
            Err(EngineError::Schema(message)) if message == "operations are empty"
        ));
    }
}
