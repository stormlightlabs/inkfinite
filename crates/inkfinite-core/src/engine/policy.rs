use super::hierarchy::{
    containing_layer, descendant_ids_for_layer, descendant_ids_for_shape, operation_layer_id, operation_shape_ids,
};
use super::{Document, EngineError, Operation, Origin, TransactionDraft};

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

pub fn validate_permissions(document: &Document, operation: &Operation, origin: &Origin) -> Result<(), EngineError> {
    let mut shape_ids = operation_shape_ids(operation);
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
        let Some(shape) = document.shapes.get(&shape_id) else {
            continue;
        };
        if shape.metadata.locked {
            return Err(EngineError::Permission(format!("shape {shape_id} is locked")));
        }
        if matches!(origin, Origin::Agent) && !shape.metadata.agent_editable {
            return Err(EngineError::Permission(format!(
                "shape {shape_id} is not agent-editable"
            )));
        }
        if matches!(origin, Origin::Agent) && containing_layer(document, shape).is_some_and(|layer| !layer.visible) {
            return Err(EngineError::Permission(format!(
                "shape {shape_id} is hidden from agents"
            )));
        }
        if let Some(layer) = containing_layer(document, shape)
            && layer.locked
        {
            return Err(EngineError::Permission(format!("layer {} is locked", layer.id)));
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
    use crate::ActorId;
    use crate::proto::TransactionId;

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
