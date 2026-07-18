use super::{ActorId, CrdtError, Error};

/// Recoverable rejection from transaction, merge, validation, or query processing.
#[derive(Debug, Error)]
pub enum EngineError {
    /// The CRDT adapter could not complete an operation.
    #[error(transparent)]
    Crdt(#[from] CrdtError),
    /// The transaction's serialized contract is structurally invalid.
    #[error("schema validation failed: {0}")]
    Schema(String),
    /// The caller inspected different causal heads than the current document.
    #[error("stale document heads")]
    StaleHeads,
    /// A record-version or existence precondition failed.
    #[error("precondition failed: {0}")]
    Precondition(String),
    /// The actor is not allowed to perform the operation.
    #[error("permission denied: {0}")]
    Permission(String),
    /// Applying the operation would violate the document model.
    #[error("document invariant failed: {0}")]
    Invariant(String),
    /// No eligible actor-scoped history entry exists.
    #[error("no {action} history exists for actor {actor_id}")]
    EmptyHistory {
        /// Requested history action.
        action: &'static str,
        /// Actor whose history was inspected.
        actor_id: ActorId,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_retain_actionable_context() {
        let error = EngineError::Precondition("layer layer:one is missing".into());
        assert_eq!(error.to_string(), "precondition failed: layer layer:one is missing");
    }
}
