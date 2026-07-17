//! Inkfinite-owned boundary around the selected CRDT implementation.

use std::error::Error;

use inkfinite_model::{ActorId, ChangeHash, Document, DocumentId, DocumentSnapshot};
use serde::{Deserialize, Serialize};

/// Opaque encoded CRDT change suitable for persistence or transport.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EncodedChange(Vec<u8>);

impl EncodedChange {
    /// Wraps bytes received from a trusted persistence or sync boundary.
    #[must_use]
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    /// Returns the encoded bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Consumes the change and returns its encoded bytes.
    #[must_use]
    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }
}

/// Result of adopting one or more validated remote changes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MergeOutcome {
    /// Heads after the changes were adopted.
    pub heads: Vec<ChangeHash>,
    /// Hashes of newly adopted changes.
    pub adopted_changes: Vec<ChangeHash>,
}

/// CRDT capabilities required by the document engine and sync layer.
///
/// Implementations may use Automerge internally, but no Automerge type crosses
/// this contract. Merge callers operate on a fork and validate its materialized
/// snapshot before replacing live state.
pub trait CrdtDocument: Clone + Sized {
    /// Recoverable implementation error.
    type Error: Error + Send + Sync + 'static;

    /// Creates CRDT state from a normalized document.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the document cannot be encoded.
    fn create(
        document_id: DocumentId,
        actor_id: ActorId,
        document: Document,
    ) -> Result<Self, Self::Error>;

    /// Loads compact CRDT state.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the bytes are invalid or unsupported.
    fn load(bytes: &[u8], actor_id: ActorId) -> Result<Self, Self::Error>;

    /// Serializes compact CRDT state.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the current state cannot be encoded.
    fn save(&self) -> Result<Vec<u8>, Self::Error>;

    /// Materializes the current normalized snapshot.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when CRDT values cannot be materialized.
    fn snapshot(&self) -> Result<DocumentSnapshot, Self::Error>;

    /// Returns current causal heads.
    fn heads(&self) -> Vec<ChangeHash>;

    /// Returns encoded changes not covered by `heads`.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when a head is unknown or changes cannot be encoded.
    fn changes_since(&self, heads: &[ChangeHash]) -> Result<Vec<EncodedChange>, Self::Error>;

    /// Applies encoded changes to this candidate state.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when a change is malformed or cannot be merged.
    fn apply_changes(&mut self, changes: &[EncodedChange]) -> Result<MergeOutcome, Self::Error>;

    /// Produces a compact copy without changing the materialized snapshot.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the state cannot be compacted.
    fn compact(&self) -> Result<Vec<u8>, Self::Error>;
}

/// Transport-independent state machine for peer synchronization.
pub trait SyncSession<D: CrdtDocument> {
    /// Recoverable synchronization error.
    type Error: Error + Send + Sync + 'static;

    /// Produces the next message for a peer, if one is currently needed.
    ///
    /// # Errors
    ///
    /// Returns a synchronization error when the session cannot inspect or encode state.
    fn generate_message(&mut self, document: &D) -> Result<Option<Vec<u8>>, Self::Error>;

    /// Receives one peer message into candidate document state.
    ///
    /// # Errors
    ///
    /// Returns a synchronization error when the message is invalid or cannot be applied.
    fn receive_message(&mut self, document: &mut D, message: &[u8]) -> Result<(), Self::Error>;
}
