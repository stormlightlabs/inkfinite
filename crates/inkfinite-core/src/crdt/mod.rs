#![forbid(unsafe_code)]

//! Inkfinite-owned Automerge boundary.

use std::str::FromStr;

use crate::{
    ActorId, ChangeHash, Document, DocumentId, DocumentSnapshot, FormatId, INKFINITE_FORMAT_ID,
    INKFINITE_FORMAT_VERSION,
};
use automerge::sync::{State as AutomergeSyncState, SyncDoc};
use automerge::transaction::{CommitOptions, Transactable};
use automerge::{
    ActorId as AutomergeActorId, AutoCommit, AutoSerde, Change, ObjId, ObjType, ROOT, ReadDoc, ScalarValue,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

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

/// Result of one local CRDT change.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChangeOutcome {
    /// Heads after the change.
    pub heads: Vec<ChangeHash>,
    /// Hash of the committed change.
    pub change: ChangeHash,
    /// Number of incremental Automerge patches produced by the change.
    pub patch_count: usize,
}

/// Result of adopting one or more validated remote changes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MergeOutcome {
    /// Heads after the changes were adopted.
    pub heads: Vec<ChangeHash>,
    /// Hashes of newly adopted changes.
    pub adopted_changes: Vec<ChangeHash>,
}

/// Recoverable error from the production Automerge adapter.
#[derive(Debug, Error)]
pub enum CrdtError {
    /// Automerge rejected a document operation or encoded change.
    #[error("Automerge operation failed: {0}")]
    Automerge(#[source] Box<automerge::AutomergeError>),
    /// A typed snapshot could not be converted to or from its CRDT projection.
    #[error("document projection failed: {0}")]
    Projection(#[from] serde_json::Error),
    /// A caller supplied a causal head that this document cannot parse or find.
    #[error("unknown or invalid causal head: {0}")]
    InvalidHead(String),
    /// A change or sync message was malformed.
    #[error("invalid CRDT payload: {0}")]
    InvalidPayload(String),
    /// A requested local change did not alter the document.
    #[error("change contained no document operations")]
    EmptyChange,
}

impl From<automerge::AutomergeError> for CrdtError {
    fn from(error: automerge::AutomergeError) -> Self {
        Self::Automerge(Box::new(error))
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredSnapshot {
    format: FormatId,
    format_version: u32,
    document_id: DocumentId,
    document: Document,
}

/// Production CRDT document backed by Automerge.
pub struct AutomergeDocument {
    document: AutoCommit,
    actor_id: ActorId,
    // Invalidated whenever Automerge adopts or commits a change.
    cached_snapshot: Option<StoredSnapshot>,
}

impl Clone for AutomergeDocument {
    fn clone(&self) -> Self {
        Self {
            document: self.document.clone(),
            actor_id: self.actor_id.clone(),
            cached_snapshot: self.cached_snapshot.clone(),
        }
    }
}

impl AutomergeDocument {
    /// Returns the local actor assigned to future changes.
    #[must_use]
    pub fn actor_id(&self) -> ActorId {
        self.actor_id.clone()
    }

    /// Assigns the actor used for future local changes.
    pub fn set_actor(&mut self, actor_id: &ActorId) {
        self.document.set_actor(automerge_actor(actor_id));
        self.actor_id.clone_from(actor_id);
    }

    /// Reconciles a normalized document as exactly one named Automerge change.
    ///
    /// # Errors
    ///
    /// Returns an error when the document cannot be projected or Automerge
    /// rejects the change.
    pub fn commit_document(&mut self, document: &Document, message: &str) -> Result<ChangeOutcome, CrdtError> {
        let current = self.stored_snapshot()?;
        let stored = StoredSnapshot {
            format: current.format,
            format_version: current.format_version,
            document_id: current.document_id,
            document: document.clone(),
        };
        let value = serde_json::to_value(&stored)?;
        self.cached_snapshot = None;
        reconcile_root(&mut self.document, &value)?;
        let hash = self
            .document
            .commit_with(CommitOptions::default().with_message(message))
            .ok_or(CrdtError::EmptyChange)?;
        let patch_count = self.document.diff_incremental().len();
        self.cached_snapshot = Some(stored);
        Ok(ChangeOutcome {
            heads: hashes(self.document.get_heads()),
            change: ChangeHash::new(hash.to_string()),
            patch_count,
        })
    }

    fn stored_snapshot(&mut self) -> Result<StoredSnapshot, CrdtError> {
        if let Some(snapshot) = &self.cached_snapshot {
            return Ok(snapshot.clone());
        }
        let value = serde_json::to_value(AutoSerde::from(&self.document))?;
        let snapshot: StoredSnapshot = serde_json::from_value(value)?;
        self.cached_snapshot = Some(snapshot.clone());
        Ok(snapshot)
    }
}

/// CRDT capabilities required by the document engine and sync layer.
///
/// Automerge types stay private to this crate. Callers merge into a clone and
/// adopt it only after validating the materialized snapshot.
pub trait CrdtDocument: Clone + Sized {
    /// Recoverable implementation error.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Creates CRDT state from a normalized document.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the document cannot be encoded.
    fn create(document_id: DocumentId, actor_id: ActorId, document: Document) -> Result<Self, Self::Error>;

    /// Loads compact CRDT state and assigns the actor for future local changes.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the bytes are invalid or unsupported.
    fn load(bytes: &[u8], actor_id: ActorId) -> Result<Self, Self::Error>;

    /// Serializes compact CRDT state.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the state cannot be encoded.
    fn save(&mut self) -> Result<Vec<u8>, Self::Error>;

    /// Materializes the current normalized snapshot.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when CRDT values cannot be materialized.
    fn snapshot(&mut self) -> Result<DocumentSnapshot, Self::Error>;

    /// Returns current causal heads.
    fn heads(&mut self) -> Vec<ChangeHash>;

    /// Returns encoded changes not covered by `heads`.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when a head is unknown or a change
    /// cannot be encoded.
    fn changes_since(&mut self, heads: &[ChangeHash]) -> Result<Vec<EncodedChange>, Self::Error>;

    /// Applies encoded changes to this candidate state.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when a change is malformed or cannot be
    /// merged.
    fn apply_changes(&mut self, changes: &[EncodedChange]) -> Result<MergeOutcome, Self::Error>;

    /// Produces a compact copy without changing the materialized snapshot.
    ///
    /// # Errors
    ///
    /// Returns an implementation error when the state cannot be compacted.
    fn compact(&mut self) -> Result<Vec<u8>, Self::Error>;
}

impl CrdtDocument for AutomergeDocument {
    type Error = CrdtError;

    fn create(document_id: DocumentId, actor_id: ActorId, document: Document) -> Result<Self, Self::Error> {
        let mut automerge = AutoCommit::new().with_actor(automerge_actor(&actor_id));
        let stored = StoredSnapshot {
            format: FormatId::new(INKFINITE_FORMAT_ID),
            format_version: INKFINITE_FORMAT_VERSION,
            document_id,
            document,
        };
        insert_root(&mut automerge, &serde_json::to_value(&stored)?)?;
        automerge.commit_with(CommitOptions::default().with_message("create document"));
        automerge.update_diff_cursor();
        Ok(Self { document: automerge, actor_id, cached_snapshot: Some(stored) })
    }

    fn load(bytes: &[u8], actor_id: ActorId) -> Result<Self, Self::Error> {
        let mut document = AutoCommit::load(bytes)?.with_actor(automerge_actor(&actor_id));
        document.update_diff_cursor();
        let mut loaded = Self { document, actor_id, cached_snapshot: None };
        loaded.stored_snapshot()?;
        Ok(loaded)
    }

    fn save(&mut self) -> Result<Vec<u8>, Self::Error> {
        Ok(self.document.save())
    }

    fn snapshot(&mut self) -> Result<DocumentSnapshot, Self::Error> {
        if self.document.commit().is_some() {
            self.cached_snapshot = None;
        }
        let stored = self.stored_snapshot()?;
        Ok(DocumentSnapshot {
            format: stored.format,
            format_version: stored.format_version,
            document_id: stored.document_id,
            heads: self.heads(),
            document: stored.document,
        })
    }

    fn heads(&mut self) -> Vec<ChangeHash> {
        hashes(self.document.get_heads())
    }

    fn changes_since(&mut self, heads: &[ChangeHash]) -> Result<Vec<EncodedChange>, Self::Error> {
        let parsed = parse_heads(heads)?;
        Ok(self
            .document
            .get_changes(&parsed)
            .iter()
            .map(|change| EncodedChange::new(change.raw_bytes().to_vec()))
            .collect())
    }

    fn apply_changes(&mut self, changes: &[EncodedChange]) -> Result<MergeOutcome, Self::Error> {
        let decoded = changes
            .iter()
            .map(|change| {
                Change::from_bytes(change.as_bytes().to_vec())
                    .map_err(|error| CrdtError::InvalidPayload(error.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let adopted_changes = decoded
            .iter()
            .filter(|change| self.document.get_change_by_hash(&change.hash()).is_none())
            .map(|change| ChangeHash::new(change.hash().to_string()))
            .collect();
        self.document.apply_changes(decoded)?;
        self.cached_snapshot = None;
        let heads = self.heads();
        Ok(MergeOutcome { heads, adopted_changes })
    }

    fn compact(&mut self) -> Result<Vec<u8>, Self::Error> {
        Ok(self.document.save())
    }
}

/// Transport-independent state machine for peer synchronization.
pub trait SyncSession<D: CrdtDocument> {
    /// Recoverable synchronization error.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Produces the next message for a peer, if one is currently needed.
    ///
    /// # Errors
    ///
    /// Returns a synchronization error when state cannot be inspected or
    /// encoded.
    fn generate_message(&mut self, document: &mut D) -> Result<Option<Vec<u8>>, Self::Error>;

    /// Receives one peer message into candidate document state.
    ///
    /// # Errors
    ///
    /// Returns a synchronization error when the message is invalid or cannot be
    /// applied.
    fn receive_message(&mut self, document: &mut D, message: &[u8]) -> Result<(), Self::Error>;
}

/// Per-peer Automerge synchronization state.
#[derive(Clone)]
pub struct AutomergeSyncSession {
    state: AutomergeSyncState,
}

impl AutomergeSyncSession {
    /// Creates empty synchronization state for one peer.
    #[must_use]
    pub fn new() -> Self {
        Self { state: AutomergeSyncState::new() }
    }

    /// Restores the compact state that Automerge documents for a peer.
    ///
    /// The encoded form intentionally contains only durable shared heads;
    /// in-flight message bookkeeping is rebuilt on the next connection.
    ///
    /// # Errors
    ///
    /// Returns [`CrdtError::InvalidPayload`] when the checkpoint is malformed.
    pub fn from_encoded_state(bytes: &[u8]) -> Result<Self, CrdtError> {
        let state = AutomergeSyncState::decode(bytes).map_err(|error| CrdtError::InvalidPayload(error.to_string()))?;
        Ok(Self { state })
    }

    /// Returns the bounded durable checkpoint for this peer.
    #[must_use]
    pub fn encoded_state(&self) -> Vec<u8> {
        self.state.encode()
    }

    /// Returns the causal heads known to be shared with the peer.
    #[must_use]
    pub fn shared_heads(&self) -> Vec<ChangeHash> {
        hashes(self.state.shared_heads.clone())
    }

    /// Receives a sync payload and reports whether its newly advertised
    /// changes became materialized rather than remaining as Automerge orphans.
    pub(crate) fn receive_message_with_status(
        &mut self, document: &mut AutomergeDocument, bytes: &[u8],
    ) -> Result<bool, CrdtError> {
        let message =
            automerge::sync::Message::decode(bytes).map_err(|error| CrdtError::InvalidPayload(error.to_string()))?;
        let before_heads = document.document.get_heads();
        let has_unavailable_head =
            !message.changes.is_empty() && message.heads.iter().any(|head| !before_heads.contains(head));
        document
            .document
            .sync()
            .receive_sync_message(&mut self.state, message)?;
        document.cached_snapshot = None;
        let after_heads = document.document.get_heads();
        let document_advanced = after_heads.iter().any(|head| !before_heads.contains(head));
        Ok(!has_unavailable_head || document_advanced)
    }
}

impl Default for AutomergeSyncSession {
    fn default() -> Self {
        Self::new()
    }
}

impl SyncSession<AutomergeDocument> for AutomergeSyncSession {
    type Error = CrdtError;

    fn generate_message(&mut self, document: &mut AutomergeDocument) -> Result<Option<Vec<u8>>, Self::Error> {
        Ok(document
            .document
            .sync()
            .generate_sync_message(&mut self.state)
            .map(automerge::sync::Message::encode))
    }

    fn receive_message(&mut self, document: &mut AutomergeDocument, message: &[u8]) -> Result<(), Self::Error> {
        self.receive_message_with_status(document, message)?;
        Ok(())
    }
}

fn automerge_actor(actor_id: &ActorId) -> AutomergeActorId {
    AutomergeActorId::from(actor_id.as_str().as_bytes().to_vec())
}

fn hashes(values: Vec<automerge::ChangeHash>) -> Vec<ChangeHash> {
    values
        .into_iter()
        .map(|value| ChangeHash::new(value.to_string()))
        .collect()
}

fn parse_heads(values: &[ChangeHash]) -> Result<Vec<automerge::ChangeHash>, CrdtError> {
    values
        .iter()
        .map(|value| {
            automerge::ChangeHash::from_str(value.as_str()).map_err(|_| CrdtError::InvalidHead(value.to_string()))
        })
        .collect()
}

fn reconcile_root(document: &mut AutoCommit, value: &Value) -> Result<(), CrdtError> {
    let values = value
        .as_object()
        .ok_or_else(|| CrdtError::InvalidPayload("snapshot root must be a map".into()))?;
    reconcile_map(document, &ROOT, values)
}

fn reconcile_map(document: &mut AutoCommit, parent: &ObjId, values: &Map<String, Value>) -> Result<(), CrdtError> {
    let existing: Vec<String> = document.keys(parent).collect();
    for key in existing {
        if !values.contains_key(&key) {
            document.delete(parent, key)?;
        }
    }
    for (key, value) in values {
        reconcile_map_value(document, parent, key, value)?;
    }
    Ok(())
}

fn reconcile_map_value(document: &mut AutoCommit, parent: &ObjId, key: &str, value: &Value) -> Result<(), CrdtError> {
    let existing = document.get(parent, key)?;
    let existing_object = if let Some((value, object)) = existing.as_ref() {
        if value.is_object() { Some((object.clone(), document.object_type(object)?)) } else { None }
    } else {
        None
    };
    let existing_scalar = existing.as_ref().and_then(|(value, _)| value.to_scalar()).cloned();
    match value {
        Value::Object(values) => {
            let child = object_or_replace(document, parent, key, existing_object, ObjType::Map)?;
            reconcile_map(document, &child, values)?;
        }
        Value::Array(values) => {
            let child = object_or_replace(document, parent, key, existing_object, ObjType::List)?;
            reconcile_list(document, &child, values)?;
        }
        Value::String(text) if is_text_key(key) => {
            let child = object_or_replace(document, parent, key, existing_object, ObjType::Text)?;
            let current = document.text(&child)?;
            if current != *text {
                let length = isize::try_from(current.chars().count())
                    .map_err(|_| CrdtError::InvalidPayload("text is too large to reconcile".into()))?;
                document.splice_text(&child, 0, length, text)?;
            }
        }
        scalar_value => {
            let desired = scalar(scalar_value)?;
            let matches = existing_scalar.as_ref() == Some(&desired);
            if !matches {
                document.put(parent, key, desired)?;
            }
        }
    }
    Ok(())
}

fn object_or_replace(
    document: &mut AutoCommit, parent: &ObjId, key: &str, existing: Option<(ObjId, ObjType)>, expected: ObjType,
) -> Result<ObjId, CrdtError> {
    if let Some((object, object_type)) = existing {
        if object_type == expected {
            return Ok(object);
        }
        document.delete(parent, key)?;
    }
    Ok(document.put_object(parent, key, expected)?)
}

fn reconcile_list(document: &mut AutoCommit, parent: &ObjId, values: &[Value]) -> Result<(), CrdtError> {
    let current: Vec<Value> = (0..document.length(parent))
        .map(|index| value_at_index(document, parent, index))
        .collect::<Result<_, _>>()?;
    if current == values {
        return Ok(());
    }
    for index in (0..document.length(parent)).rev() {
        document.delete(parent, index)?;
    }
    for (index, value) in values.iter().enumerate() {
        insert_list_value(document, parent, index, value)?;
    }
    Ok(())
}

fn value_at_index(document: &AutoCommit, parent: &ObjId, index: usize) -> Result<Value, CrdtError> {
    let Some((value, object)) = document.get(parent, index)? else {
        return Err(CrdtError::InvalidPayload("list item disappeared".into()));
    };
    if value.is_object() {
        return object_to_json(document, &object);
    }
    scalar_to_json(
        value
            .to_scalar()
            .ok_or_else(|| CrdtError::InvalidPayload("invalid list scalar".into()))?,
    )
}

fn object_to_json(document: &AutoCommit, object: &ObjId) -> Result<Value, CrdtError> {
    match document.object_type(object)? {
        ObjType::Map | ObjType::Table => {
            let mut result = Map::new();
            for key in document.keys(object) {
                let Some((value, child)) = document.get(object, key.as_str())? else {
                    continue;
                };
                let value = if value.is_object() {
                    object_to_json(document, &child)?
                } else {
                    scalar_to_json(
                        value
                            .to_scalar()
                            .ok_or_else(|| CrdtError::InvalidPayload("invalid map scalar".into()))?,
                    )?
                };
                result.insert(key, value);
            }
            Ok(Value::Object(result))
        }
        ObjType::List => (0..document.length(object))
            .map(|index| value_at_index(document, object, index))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ObjType::Text => Ok(Value::String(document.text(object)?)),
    }
}

fn insert_root(document: &mut AutoCommit, value: &Value) -> Result<(), CrdtError> {
    let values = value
        .as_object()
        .ok_or_else(|| CrdtError::InvalidPayload("snapshot root must be a map".into()))?;
    for (key, value) in values {
        insert_map_value(document, &ROOT, key, value)?;
    }
    Ok(())
}

fn insert_map_value<T: Transactable>(
    document: &mut T, parent: &ObjId, key: &str, value: &Value,
) -> Result<(), CrdtError> {
    match value {
        Value::Object(values) => {
            let child = document.put_object(parent, key, ObjType::Map)?;
            for (child_key, child_value) in values {
                insert_map_value(document, &child, child_key, child_value)?;
            }
        }
        Value::Array(values) => {
            let child = document.put_object(parent, key, ObjType::List)?;
            for (index, child_value) in values.iter().enumerate() {
                insert_list_value(document, &child, index, child_value)?;
            }
        }
        Value::String(text) if is_text_key(key) => {
            let child = document.put_object(parent, key, ObjType::Text)?;
            document.splice_text(&child, 0, 0, text)?;
        }
        scalar_value => document.put(parent, key, scalar(scalar_value)?)?,
    }
    Ok(())
}

fn insert_list_value<T: Transactable>(
    document: &mut T, parent: &ObjId, index: usize, value: &Value,
) -> Result<(), CrdtError> {
    match value {
        Value::Object(values) => {
            let child = document.insert_object(parent, index, ObjType::Map)?;
            for (key, child_value) in values {
                insert_map_value(document, &child, key, child_value)?;
            }
        }
        Value::Array(values) => {
            let child = document.insert_object(parent, index, ObjType::List)?;
            for (child_index, child_value) in values.iter().enumerate() {
                insert_list_value(document, &child, child_index, child_value)?;
            }
        }
        scalar_value => document.insert(parent, index, scalar(scalar_value)?)?,
    }
    Ok(())
}

fn scalar(value: &Value) -> Result<ScalarValue, CrdtError> {
    match value {
        Value::Null => Ok(ScalarValue::Null),
        Value::Bool(value) => Ok(ScalarValue::Boolean(*value)),
        Value::Number(value) => value
            .as_i64()
            .map(ScalarValue::Int)
            .or_else(|| value.as_u64().map(ScalarValue::Uint))
            .or_else(|| value.as_f64().map(ScalarValue::F64))
            .ok_or_else(|| CrdtError::InvalidPayload("number is outside CRDT range".into())),
        Value::String(value) => Ok(ScalarValue::Str(value.clone().into())),
        Value::Array(_) | Value::Object(_) => Err(CrdtError::InvalidPayload("expected a JSON scalar".into())),
    }
}

fn scalar_to_json(value: &ScalarValue) -> Result<Value, CrdtError> {
    match value {
        ScalarValue::Null => Ok(Value::Null),
        ScalarValue::Boolean(value) => Ok(Value::Bool(*value)),
        ScalarValue::Int(value) => Ok(Value::from(*value)),
        ScalarValue::Uint(value) => Ok(Value::from(*value)),
        ScalarValue::F64(value) => Ok(Value::from(*value)),
        ScalarValue::Str(value) => Ok(Value::String(value.to_string())),
        _ => Err(CrdtError::InvalidPayload("document contains a non-JSON scalar".into())),
    }
}

fn is_text_key(key: &str) -> bool {
    matches!(key, "content" | "markdown" | "text")
}

#[cfg(test)]
mod tests;
